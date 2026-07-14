import {
  CursorSchema,
  SupportConversationClosedResultSchema,
  SupportConversationListPageSchema,
  SupportConversationReadResultSchema,
  SupportConversationSummarySchema,
  SupportConversationThreadSchema,
  SupportMessageSchema,
  type Cursor,
  type SupportConversationCreateRequest,
  type SupportConversationListQuery,
  type SupportConversationSummary,
  type SupportConversationThread,
  type SupportMessage,
  type SupportMessageListQuery,
} from "@smart-job/api-contracts";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { DatabaseQueryable } from "../database/runtime.js";
import { AppError } from "../http/errors.js";

const DEFAULT_PAGE_SIZE = 50;

const dateValueSchema = z.union([z.date(), z.iso.datetime({ offset: true })]);
const conversationRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  user_name: z.string(),
  public_company_id: z.union([z.string(), z.number().int().positive()]).nullable(),
  category: z.enum(["general", "bug", "opinion", "suggestion", "support", "freeChat"]),
  status: z.enum(["open", "closed"]),
  last_message_text: z.string().nullable(),
  last_message_at: dateValueSchema,
  cursor_last_message_at: z.iso.datetime({ offset: true }),
  unread_for_user_count: z.number().int().nonnegative(),
  unread_for_dev_count: z.number().int().nonnegative(),
  created_at: dateValueSchema,
  updated_at: dateValueSchema,
}).strict();

interface ConversationRow extends QueryResultRow {
  readonly id: string;
  readonly user_id: string;
  readonly user_name: string;
  readonly public_company_id: string | number | null;
  readonly category: string;
  readonly status: string;
  readonly last_message_text: string | null;
  readonly last_message_at: Date | string;
  readonly cursor_last_message_at: string;
  readonly unread_for_user_count: number;
  readonly unread_for_dev_count: number;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

const messageRowSchema = z.object({
  id: z.uuid(),
  conversation_id: z.uuid(),
  sender_user_id: z.uuid(),
  sender_type: z.enum(["user", "dev"]),
  sender_name_snapshot: z.string().nullable(),
  text: z.string(),
  created_at: dateValueSchema,
  cursor_created_at: z.iso.datetime({ offset: true }),
}).strict();

interface MessageRow extends QueryResultRow {
  readonly id: string;
  readonly conversation_id: string;
  readonly sender_user_id: string;
  readonly sender_type: "user" | "dev";
  readonly sender_name_snapshot: string | null;
  readonly text: string;
  readonly created_at: Date | string;
  readonly cursor_created_at: string;
}

const conversationCursorPayloadSchema = z.object({
  version: z.literal(1),
  lastMessageAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
}).strict();

const messageCursorPayloadSchema = z.object({
  version: z.literal(1),
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
}).strict();

export const SUPPORT_CONVERSATION_SELECT = `
  SELECT
    conversation.id,
    conversation.user_id,
    COALESCE(
      NULLIF(BTRIM(app_user.display_name), ''),
      NULLIF(BTRIM(app_user.email), ''),
      conversation.user_id
    ) AS user_name,
    company.public_company_id::text AS public_company_id,
    conversation.category,
    conversation.status::text AS status,
    conversation.last_message_text,
    conversation.last_message_at,
    pg_catalog.to_char(
      conversation.last_message_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ) AS cursor_last_message_at,
    conversation.unread_for_user_count,
    conversation.unread_for_dev_count,
    conversation.created_at,
    conversation.updated_at
  FROM public.support_conversations AS conversation
  INNER JOIN public.app_users AS app_user
    ON app_user.id = conversation.user_id
  LEFT JOIN public.companies AS company
    ON company.id = conversation.company_id
`;

export const LIST_SUPPORT_CONVERSATIONS_SQL = `${SUPPORT_CONVERSATION_SELECT}
  WHERE (private.app_is_dev() OR conversation.user_id = $1::text)
    AND ($2::text IS NULL OR conversation.status::text = $2::text)
    AND ($3::text IS NULL OR conversation.category = $3::text)
    AND (
      $4::timestamptz IS NULL
      OR (conversation.last_message_at, conversation.id) < ($4::timestamptz, $5::uuid)
    )
  ORDER BY conversation.last_message_at DESC, conversation.id DESC
  LIMIT $6::integer
`;

export const READ_SUPPORT_CONVERSATION_SQL = `${SUPPORT_CONVERSATION_SELECT}
  WHERE conversation.id = $1::uuid
    AND (private.app_is_dev() OR conversation.user_id = $2::text)
  LIMIT 1
`;

export const LIST_SUPPORT_MESSAGES_SQL = `
  SELECT
    message.id,
    message.conversation_id,
    message.sender_user_id::uuid AS sender_user_id,
    message.sender_type::text AS sender_type,
    message.sender_name_snapshot,
    message.text,
    message.created_at,
    pg_catalog.to_char(
      message.created_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ) AS cursor_created_at
  FROM public.support_messages AS message
  WHERE message.conversation_id = $1::uuid
    AND (
      $2::timestamptz IS NULL
      OR (message.created_at, message.id) > ($2::timestamptz, $3::uuid)
    )
  ORDER BY message.created_at ASC, message.id ASC
  LIMIT $4::integer
`;

function invalidCursor(): AppError {
  return new AppError({
    statusCode: 400,
    code: "INVALID_CURSOR",
    message: "The pagination cursor is invalid.",
    fieldErrors: { afterCursor: ["Restart pagination from the first page."] },
  });
}

function missingConversation(): AppError {
  return new AppError({
    statusCode: 404,
    code: "SUPPORT_CONVERSATION_NOT_FOUND",
    message: "The support conversation was not found.",
  });
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function parsePublicCompanyId(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("Database returned an invalid public company id");
  }
  return parsed;
}

function mapConversation(unknownRow: unknown): SupportConversationSummary {
  const row = conversationRowSchema.parse(unknownRow);
  return SupportConversationSummarySchema.parse({
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    companyId: parsePublicCompanyId(row.public_company_id),
    category: row.category,
    status: row.status,
    lastMessage: row.last_message_text ?? "",
    lastMessageAt: toIso(row.last_message_at),
    unreadForUser: row.unread_for_user_count,
    unreadForDev: row.unread_for_dev_count,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

function mapMessage(unknownRow: unknown): SupportMessage {
  const row = messageRowSchema.parse(unknownRow);
  return SupportMessageSchema.parse({
    id: row.id,
    conversationId: row.conversation_id,
    senderUid: row.sender_type === "dev" ? "dev" : row.sender_user_id,
    senderRole: row.sender_type,
    senderName: row.sender_name_snapshot?.trim() || row.sender_user_id,
    text: row.text,
    createdAt: toIso(row.created_at),
  });
}

function decodeCursor<T>(cursor: Cursor | undefined, schema: z.ZodType<T>): T | null {
  if (cursor === undefined) return null;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    return schema.parse(JSON.parse(decoded));
  } catch {
    throw invalidCursor();
  }
}

function encodeCursor(value: unknown): Cursor {
  return CursorSchema.parse(
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url"),
  );
}

export async function readSupportConversation(
  transaction: DatabaseQueryable,
  userId: string,
  conversationId: string,
): Promise<SupportConversationSummary> {
  const result = await transaction.query<ConversationRow>(
    READ_SUPPORT_CONVERSATION_SQL,
    [conversationId, userId],
  );
  const row = result.rows[0];
  if (row === undefined) throw missingConversation();
  return mapConversation(row);
}

export async function listSupportConversations(
  transaction: DatabaseQueryable,
  userId: string,
  query: SupportConversationListQuery,
): Promise<z.infer<typeof SupportConversationListPageSchema>> {
  const cursor = decodeCursor(query.afterCursor, conversationCursorPayloadSchema);
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
  const result = await transaction.query<ConversationRow>(
    LIST_SUPPORT_CONVERSATIONS_SQL,
    [
      userId,
      query.status ?? null,
      query.category ?? null,
      cursor?.lastMessageAt ?? null,
      cursor?.id ?? null,
      pageSize + 1,
    ],
  );
  const hasMore = result.rows.length > pageSize;
  const pageRows = result.rows.slice(0, pageSize);
  const lastRow = pageRows.at(-1);
  return SupportConversationListPageSchema.parse({
    items: pageRows.map(mapConversation),
    nextCursor: hasMore && lastRow !== undefined
      ? encodeCursor({
          version: 1,
          lastMessageAt: lastRow.cursor_last_message_at,
          id: lastRow.id,
        })
      : null,
  });
}

export async function readSupportThread(
  transaction: DatabaseQueryable,
  input: {
    readonly userId: string;
    readonly conversationId: string;
    readonly query: SupportMessageListQuery;
  },
): Promise<SupportConversationThread> {
  const conversation = await readSupportConversation(
    transaction,
    input.userId,
    input.conversationId,
  );
  const cursor = decodeCursor(input.query.afterCursor, messageCursorPayloadSchema);
  const pageSize = input.query.pageSize ?? DEFAULT_PAGE_SIZE;
  const result = await transaction.query<MessageRow>(
    LIST_SUPPORT_MESSAGES_SQL,
    [
      input.conversationId,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      pageSize + 1,
    ],
  );
  const hasMore = result.rows.length > pageSize;
  const pageRows = result.rows.slice(0, pageSize);
  const lastRow = pageRows.at(-1);
  return SupportConversationThreadSchema.parse({
    conversation,
    messages: pageRows.map(mapMessage),
    nextCursor: hasMore && lastRow !== undefined
      ? encodeCursor({
          version: 1,
          createdAt: lastRow.cursor_created_at,
          id: lastRow.id,
        })
      : null,
  });
}

export async function createSupportConversation(
  transaction: DatabaseQueryable,
  input: {
    readonly userId: string;
    readonly internalCompanyId: string | null;
    readonly request: SupportConversationCreateRequest;
  },
): Promise<SupportConversationSummary> {
  const created = await transaction.query<{ conversation_id: string } & QueryResultRow>(
    `SELECT private.create_api_support_conversation($1::uuid, $2::text) AS conversation_id`,
    [input.internalCompanyId, input.request.category],
  );
  const conversationId = z.object({ conversation_id: z.uuid() }).strict().parse(
    created.rows[0],
  ).conversation_id;
  return readSupportConversation(transaction, input.userId, conversationId);
}

export async function appendSupportMessage(
  transaction: DatabaseQueryable,
  input: {
    readonly conversationId: string;
    readonly text: string;
  },
): Promise<SupportMessage> {
  const created = await transaction.query<{ message_id: string } & QueryResultRow>(
    `SELECT private.append_api_support_message($1::uuid, $2::text) AS message_id`,
    [input.conversationId, input.text],
  );
  const messageId = z.object({ message_id: z.uuid() }).strict().parse(
    created.rows[0],
  ).message_id;
  const result = await transaction.query<MessageRow>(
    `SELECT
       message.id,
       message.conversation_id,
       message.sender_user_id::uuid AS sender_user_id,
       message.sender_type::text AS sender_type,
       message.sender_name_snapshot,
       message.text,
       message.created_at,
       pg_catalog.to_char(
         message.created_at AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
       ) AS cursor_created_at
     FROM public.support_messages AS message
     WHERE message.id = $1::uuid
       AND message.conversation_id = $2::uuid
     LIMIT 1`,
    [messageId, input.conversationId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Created support message could not be read back");
  return mapMessage(row);
}

export async function markSupportConversationRead(
  transaction: DatabaseQueryable,
  conversationId: string,
): Promise<z.infer<typeof SupportConversationReadResultSchema>> {
  const result = await transaction.query(
    `SELECT * FROM private.mark_api_support_conversation_read($1::uuid)`,
    [conversationId],
  );
  const row = z.object({
    conversation_id: z.uuid(),
    unread_for_user: z.number().int().nonnegative(),
    unread_for_dev: z.number().int().nonnegative(),
    updated_at: dateValueSchema,
  }).strict().parse(result.rows[0]);
  return SupportConversationReadResultSchema.parse({
    conversationId: row.conversation_id,
    unreadForUser: row.unread_for_user,
    unreadForDev: row.unread_for_dev,
    updatedAt: toIso(row.updated_at),
  });
}

export async function closeSupportConversation(
  transaction: DatabaseQueryable,
  conversationId: string,
): Promise<z.infer<typeof SupportConversationClosedResultSchema>> {
  const result = await transaction.query(
    `SELECT private.close_api_support_conversation($1::uuid) AS closed_at`,
    [conversationId],
  );
  const row = z.object({ closed_at: dateValueSchema }).strict().parse(result.rows[0]);
  return SupportConversationClosedResultSchema.parse({
    conversationId,
    status: "closed",
    closedAt: toIso(row.closed_at),
  });
}
