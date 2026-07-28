import {
  JobAttachmentPurposeSchema,
  UploadAttachmentManifestSchema,
  type JobAttachmentUploadSessionRequest,
} from "@smart-job/api-contracts";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { DatabaseQueryable } from "../database/runtime.js";
import { AppError } from "../http/errors.js";
import type { StoredUploadAttachment } from "../storage/company-files.js";
import type { TenantContext } from "../tenancy/context.js";

const UPLOAD_SESSION_LIFETIME_MS = 119 * 60_000;
const UPLOAD_SESSION_RESPONSE_FLOOR_MS = 60_000;
const extensionByMimeType: Readonly<Record<string, string>> = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
});

const storedAttachmentSchema = UploadAttachmentManifestSchema.extend({
  objectPath: z.string().trim().min(1).max(1_024),
}).strict();

const uploadSessionRowSchema = z.object({
  id: z.uuid(),
  purpose: JobAttachmentPurposeSchema,
  target_job_id: z.uuid().nullable(),
  expected_manifest: z.array(storedAttachmentSchema).min(1).max(20),
  expires_at: z.union([z.date(), z.iso.datetime({ offset: true })]),
}).strict();

interface UploadSessionRow extends QueryResultRow {
  readonly id: string;
  readonly purpose: string;
  readonly target_job_id: string | null;
  readonly expected_manifest: unknown;
  readonly expires_at: Date | string;
}

const preparationRowSchema = z.object({
  outcome: z.enum([
    "created",
    "reused",
    "rate_limited",
    "quota_exceeded",
    "expired",
    "unavailable",
  ]),
  session_id: z.uuid(),
  session_expires_at: z.union([z.date(), z.iso.datetime({ offset: true })]).nullable(),
  session_signing_failures: z.number().int().min(0).max(3),
  rate_limit_reset_at: z.union([z.date(), z.iso.datetime({ offset: true })]).nullable(),
}).strict();

const signingFailureRowSchema = z.object({
  session_status: z.string().trim().min(1).max(32),
  failure_count: z.number().int().min(0).max(3),
}).strict();

interface UploadSessionPreparationRow extends QueryResultRow {
  readonly outcome: string;
  readonly session_id: string;
  readonly session_expires_at: Date | string | null;
  readonly session_signing_failures: number;
  readonly rate_limit_reset_at: Date | string | null;
}

interface UploadSigningFailureRow extends QueryResultRow {
  readonly session_status: string;
  readonly failure_count: number;
}

export interface PreparedUploadSession {
  readonly id: string;
  readonly purpose: "job.create_finished" | "job.complete_assigned";
  readonly targetJobId: string | null;
  readonly expiresAt: Date;
  readonly attachments: readonly StoredUploadAttachment[];
}

export type UploadSessionPreparation =
  | {
      readonly outcome: "ready";
      readonly created: boolean;
      readonly session: PreparedUploadSession;
    }
  | {
      readonly outcome: "rate_limited";
      readonly resetAt: Date;
    }
  | { readonly outcome: "quota_exceeded" }
  | { readonly outcome: "expired" | "unavailable" };

export interface UploadSigningFailureResult {
  readonly status: string;
  readonly failureCount: number;
}

function forbidden(message: string): AppError {
  return new AppError({
    statusCode: 403,
    code: "UPLOAD_SESSION_FORBIDDEN",
    message,
  });
}

async function assertPurposeAuthorization(
  transaction: DatabaseQueryable,
  input: {
    readonly tenant: TenantContext;
    readonly userId: string;
    readonly request: JobAttachmentUploadSessionRequest;
  },
): Promise<void> {
  if (!input.tenant.workspace.enabledModules.includes("solojob")) {
    throw forbidden("Job attachments are not enabled for this workspace.");
  }

  const role = input.tenant.workspace.role;
  if (input.request.purpose === "job.create_finished") {
    if (!(["manager", "user", "dev"] as const).includes(
      role as "manager" | "user" | "dev",
    )) {
      throw forbidden("This membership cannot create finished jobs.");
    }
    return;
  }

  if (role === "basic") {
    throw forbidden("This membership cannot complete jobs.");
  }
  const result = await transaction.query(
    `SELECT job.status::text AS status,
            viewer_membership.id AS viewer_membership_id,
            job.assigned_membership_id
     FROM public.jobs job
     LEFT JOIN public.company_memberships viewer_membership
       ON viewer_membership.company_id = job.company_id
      AND viewer_membership.user_id = $3
      AND viewer_membership.status = 'active'
     WHERE job.id = $1::uuid
       AND job.company_id = $2::uuid
     LIMIT 1`,
    [input.request.jobId, input.tenant.internalCompanyId, input.userId],
  );
  const row = result.rows[0] as {
    status?: unknown;
    viewer_membership_id?: unknown;
    assigned_membership_id?: unknown;
  } | undefined;
  if (!row) {
    throw new AppError({
      statusCode: 404,
      code: "JOB_NOT_FOUND",
      message: "The requested job was not found.",
    });
  }
  if (row.status !== "pending" && row.status !== "waiting") {
    throw new AppError({
      statusCode: 409,
      code: "JOB_NOT_COMPLETABLE",
      message: "The job can no longer be completed.",
    });
  }
  if (
    (role === "worker" || role === "user")
    && row.assigned_membership_id !== row.viewer_membership_id
  ) {
    throw forbidden("The job is not assigned to this membership.");
  }
}

export async function prepareUploadSession(
  transaction: DatabaseQueryable,
  input: {
    readonly tenant: TenantContext;
    readonly userId: string;
    readonly sessionId: string;
    readonly request: JobAttachmentUploadSessionRequest;
    readonly bucketId: string;
    readonly now?: Date;
  },
): Promise<UploadSessionPreparation> {
  await assertPurposeAuthorization(transaction, input);

  const sessionId = input.sessionId;
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + UPLOAD_SESSION_LIFETIME_MS);
  const objectPrefix = [
    input.tenant.internalCompanyId,
    input.userId,
    sessionId,
  ].join("/");
  const attachments: StoredUploadAttachment[] = input.request.attachments.map(
    (attachment) => ({
      ...attachment,
      sha256: attachment.sha256.toLowerCase(),
      objectPath: `${objectPrefix}/${attachment.attachmentId}.${
        extensionByMimeType[attachment.mimeType] ?? "bin"
      }`,
    }),
  );

  const result = await transaction.query<UploadSessionPreparationRow>(
    `SELECT
       outcome,
       session_id,
       session_expires_at,
       session_signing_failures,
       rate_limit_reset_at
     FROM private.prepare_api_file_upload_session(
       $1::uuid,
       $2::uuid,
       $3,
       $4::uuid,
       $5,
       $6,
       $7::jsonb,
       $8::timestamptz
     )`,
    [
      sessionId,
      input.tenant.internalCompanyId,
      input.request.purpose,
      input.request.jobId ?? null,
      input.bucketId,
      objectPrefix,
      JSON.stringify(attachments),
      expiresAt,
    ],
  );
  const row = preparationRowSchema.parse(result.rows[0]);

  if (row.outcome === "rate_limited") {
    if (row.rate_limit_reset_at === null) {
      throw new Error("Upload-session limiter omitted its reset time");
    }
    return {
      outcome: "rate_limited",
      resetAt: asDate(row.rate_limit_reset_at),
    };
  }
  if (row.outcome === "quota_exceeded") return { outcome: "quota_exceeded" };
  if (row.outcome === "expired" || row.outcome === "unavailable") {
    return { outcome: row.outcome };
  }
  if (row.session_expires_at === null) {
    throw new Error("Prepared upload session omitted its expiry");
  }

  return {
    outcome: "ready",
    created: row.outcome === "created",
    session: {
      id: row.session_id,
      purpose: input.request.purpose,
      targetJobId: input.request.jobId ?? null,
      expiresAt: asDate(row.session_expires_at),
      attachments,
    },
  };
}

export async function recordUploadSigningFailure(
  transaction: DatabaseQueryable,
  sessionId: string,
  errorCode = "signed_url_creation_failed",
): Promise<UploadSigningFailureResult> {
  const result = await transaction.query<UploadSigningFailureRow>(
    `SELECT session_status, failure_count
     FROM private.record_api_file_upload_signing_failure($1::uuid, $2)`,
    [sessionId, errorCode],
  );
  const row = signingFailureRowSchema.parse(result.rows[0]);
  return { status: row.session_status, failureCount: row.failure_count };
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export async function readPendingUploadSession(
  transaction: DatabaseQueryable,
  input: {
    readonly sessionId: string;
    readonly internalCompanyId: string;
    readonly userId: string;
    readonly purpose: "job.create_finished" | "job.complete_assigned";
    readonly targetJobId: string | null;
    readonly now?: Date;
  },
): Promise<PreparedUploadSession> {
  const result = await transaction.query<UploadSessionRow>(
    `SELECT id, purpose, target_job_id, expected_manifest, expires_at
     FROM private.file_upload_sessions
     WHERE id = $1::uuid
       AND company_id = $2::uuid
       AND user_id = $3::uuid
       AND purpose = $4
       AND target_job_id IS NOT DISTINCT FROM $5::uuid
       AND status = 'pending'
     LIMIT 1`,
    [
      input.sessionId,
      input.internalCompanyId,
      input.userId,
      input.purpose,
      input.targetJobId,
    ],
  );
  const unknownRow = result.rows[0];
  if (!unknownRow) {
    throw new AppError({
      statusCode: 404,
      code: "UPLOAD_SESSION_NOT_FOUND",
      message: "The upload session was not found.",
    });
  }
  const row = uploadSessionRowSchema.parse(unknownRow);
  const expiresAt = asDate(row.expires_at);
  if (
    expiresAt.getTime()
    <= (input.now ?? new Date()).getTime() + UPLOAD_SESSION_RESPONSE_FLOOR_MS
  ) {
    throw new AppError({
      statusCode: 409,
      code: "UPLOAD_SESSION_EXPIRED",
      message: "The upload session has expired.",
    });
  }
  return {
    id: row.id,
    purpose: row.purpose,
    targetJobId: row.target_job_id,
    expiresAt,
    attachments: row.expected_manifest,
  };
}
