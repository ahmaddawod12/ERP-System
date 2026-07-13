/**
 * Support Handler Module
 * Phase: 2 | Status: Implemented
 */
import {
  EdgeFunctionContext,
  createSupabaseClient,
  optionalTrimmedString,
  requireNonEmptyString,
} from "../shared-edge-helpers.ts";

type CreateSupportConversationPayload = {
  category?: string;
};

type AppendSupportMessagePayload = {
  conversationId: string;
  text: string;
};

type ConversationIdPayload = {
  conversationId: string;
};

type ListSupportConversationsPayload = {
  limit?: number;
  status?: string;
};

export async function createSupportConversationV1(payload: CreateSupportConversationPayload, ctx: EdgeFunctionContext): Promise<Record<string, unknown>> {
  if (!ctx.auth?.uid) {
    throw { code: "unauthenticated", message: "Authentication required", httpStatus: 401 };
  }

  const ALLOWED_SUPPORT_CATEGORIES = ["general", "bug", "opinion", "suggestion", "support", "freeChat"];

  const supabase = createSupabaseClient(ctx.env);
  const now = new Date().toISOString();
  const rawCategory = optionalTrimmedString(payload?.category, 64) || "general";
  const category = ALLOWED_SUPPORT_CATEGORIES.includes(rawCategory) ? rawCategory : "general";

  const { data: userRow, error: userError } = await supabase
    .from("app_users")
    .select("display_name, email")
    .eq("id", ctx.auth.uid)
    .single();
  if (userError || !userRow) {
    throw { code: "not-found", message: "User profile not found", httpStatus: 404 };
  }

  const { data: membership } = await supabase
    .from("company_memberships")
    .select("company_id")
    .eq("user_id", ctx.auth.uid)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  const { data: inserted, error: insertError } = await supabase
    .from("support_conversations")
    .insert({
      user_id: ctx.auth.uid,
      company_id: membership?.company_id ?? null,
      category,
      status: "open",
      last_message_text: "",
      last_message_at: now,
      unread_for_user_count: 0,
      unread_for_dev_count: 0,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    throw { code: "internal", message: "Failed to create support conversation", httpStatus: 500 };
  }

  return {
    conversationId: inserted.id,
    userId: ctx.auth.uid,
    userName: userRow.display_name || userRow.email || ctx.auth.uid,
    category,
    status: "open",
    createdAt: now,
  };
}

export async function appendSupportMessageV1(payload: AppendSupportMessagePayload, ctx: EdgeFunctionContext): Promise<Record<string, unknown>> {
  if (!ctx.auth?.uid) {
    throw { code: "unauthenticated", message: "Authentication required", httpStatus: 401 };
  }

  const conversationId = requireNonEmptyString(payload?.conversationId, "conversationId", 3, 128);
  const text = requireNonEmptyString(payload?.text, "text", 1, 4000);
  const supabase = createSupabaseClient(ctx.env);
  const now = new Date().toISOString();

  const [{ data: userRow }, { data: membership }, { data: conversation, error: conversationError }] = await Promise.all([
    supabase.from("app_users").select("display_name, email, system_role").eq("id", ctx.auth.uid).single(),
    supabase
      .from("company_memberships")
      .select("role")
      .eq("user_id", ctx.auth.uid)
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("support_conversations")
      .select("id, user_id, status, unread_for_user_count, unread_for_dev_count")
      .eq("id", conversationId)
      .single(),
  ]);

  if (conversationError || !conversation) {
    throw { code: "not-found", message: "Conversation not found", httpStatus: 404 };
  }

  if (!userRow) {
    throw { code: "not-found", message: "User profile not found", httpStatus: 404 };
  }

  const isDev = userRow?.system_role === "dev" || membership?.role === "dev";
  if (!isDev && conversation.user_id !== ctx.auth.uid) {
    throw { code: "permission-denied", message: "You can only access your own conversation", httpStatus: 403 };
  }
  if (String(conversation.status || "").toLowerCase() === "closed") {
    throw {
      code: "failed-precondition",
      message: "Conversation is closed. Start a new conversation to continue.",
      httpStatus: 400,
    };
  }

  const senderType = isDev ? "dev" : "user";
  const senderName = userRow?.display_name || userRow?.email || ctx.auth.uid;

  const { data: insertedMessage, error: messageError } = await supabase
    .from("support_messages")
    .insert({
      conversation_id: conversationId,
      sender_user_id: ctx.auth.uid,
      sender_type: senderType,
      sender_name_snapshot: senderName,
      text,
      created_at: now,
    })
    .select("id")
    .single();

  if (messageError || !insertedMessage) {
    throw { code: "internal", message: "Failed to append support message", httpStatus: 500 };
  }

  const unreadForDev = senderType === "dev"
    ? 0
    : Math.max(0, Number(conversation.unread_for_dev_count || 0)) + 1;
  const unreadForUser = senderType === "dev"
    ? Math.max(0, Number(conversation.unread_for_user_count || 0)) + 1
    : 0;

  await supabase
    .from("support_conversations")
    .update({
      last_message_text: text,
      last_message_at: now,
      unread_for_dev_count: unreadForDev,
      unread_for_user_count: unreadForUser,
      updated_at: now,
    })
    .eq("id", conversationId);

  return {
    messageId: insertedMessage.id,
    conversationId,
    senderUid: senderType === "dev" ? "dev" : ctx.auth.uid,
    senderRole: senderType,
    senderName,
    text,
    createdAt: now,
    source: "sql",
  };
}

export async function markSupportConversationReadV1(payload: ConversationIdPayload, ctx: EdgeFunctionContext): Promise<Record<string, unknown>> {
  if (!ctx.auth?.uid) {
    throw { code: "unauthenticated", message: "Authentication required", httpStatus: 401 };
  }

  const conversationId = requireNonEmptyString(payload?.conversationId, "conversationId", 3, 128);
  const supabase = createSupabaseClient(ctx.env);
  const now = new Date().toISOString();

  const [{ data: userRow }, { data: membership }, { data: conversation, error: conversationError }] = await Promise.all([
    supabase.from("app_users").select("system_role").eq("id", ctx.auth.uid).single(),
    supabase
      .from("company_memberships")
      .select("role")
      .eq("user_id", ctx.auth.uid)
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("support_conversations")
      .select("id, user_id")
      .eq("id", conversationId)
      .single(),
  ]);

  if (conversationError || !conversation) {
    throw { code: "not-found", message: "Conversation not found", httpStatus: 404 };
  }

  const isDev = userRow?.system_role === "dev" || membership?.role === "dev";
  if (!isDev && conversation.user_id !== ctx.auth.uid) {
    throw { code: "permission-denied", message: "You can only access your own conversation", httpStatus: 403 };
  }

  const patch = isDev
    ? { unread_for_dev_count: 0, updated_at: now }
    : { unread_for_user_count: 0, updated_at: now };

  const { error: updateError } = await supabase
    .from("support_conversations")
    .update(patch)
    .eq("id", conversationId);
  if (updateError) {
    throw { code: "internal", message: "Failed to mark support conversation read", httpStatus: 500 };
  }

  return { conversationId, updatedAt: now };
}

export async function closeSupportConversationV1(payload: ConversationIdPayload, ctx: EdgeFunctionContext): Promise<Record<string, unknown>> {
  if (!ctx.auth?.uid) {
    throw { code: "unauthenticated", message: "Authentication required", httpStatus: 401 };
  }

  const conversationId = requireNonEmptyString(payload?.conversationId, "conversationId", 3, 128);
  const supabase = createSupabaseClient(ctx.env);
  const now = new Date().toISOString();

  const [{ data: userRow }, { data: membership }, { data: conversation, error: conversationError }] = await Promise.all([
    supabase.from("app_users").select("system_role").eq("id", ctx.auth.uid).single(),
    supabase
      .from("company_memberships")
      .select("role")
      .eq("user_id", ctx.auth.uid)
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("support_conversations")
      .select("id, user_id")
      .eq("id", conversationId)
      .single(),
  ]);

  if (conversationError || !conversation) {
    throw { code: "not-found", message: "Conversation not found", httpStatus: 404 };
  }

  const isDev = userRow?.system_role === "dev" || membership?.role === "dev";
  if (!isDev && conversation.user_id !== ctx.auth.uid) {
    throw { code: "permission-denied", message: "You can only access your own conversation", httpStatus: 403 };
  }

  const { error: updateError } = await supabase
    .from("support_conversations")
    .update({ status: "closed", updated_at: now })
    .eq("id", conversationId);
  if (updateError) {
    throw { code: "internal", message: "Failed to close support conversation", httpStatus: 500 };
  }

  return { conversationId, status: "closed", closedAt: now };
}

export async function listSupportConversationsV1(payload: ListSupportConversationsPayload, ctx: EdgeFunctionContext): Promise<Record<string, unknown>> {
  if (!ctx.auth?.uid) {
    throw { code: "unauthenticated", message: "Authentication required", httpStatus: 401 };
  }

  const limit = Math.min(200, Math.max(1, Number(payload?.limit || 100) || 100));
  const status = optionalTrimmedString(payload?.status, 20)?.toLowerCase() || "all";
  const supabase = createSupabaseClient(ctx.env);

  const [{ data: userRow }, { data: membership }] = await Promise.all([
    supabase.from("app_users").select("system_role").eq("id", ctx.auth.uid).single(),
    supabase
      .from("company_memberships")
      .select("role")
      .eq("user_id", ctx.auth.uid)
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
  ]);
  const isDev = userRow?.system_role === "dev" || membership?.role === "dev";

  let query = supabase
    .from("support_conversations")
    .select("id, user_id, category, status, last_message_text, last_message_at, created_at, updated_at, unread_for_user_count, unread_for_dev_count")
    .order("last_message_at", { ascending: false })
    .limit(limit * 2);

  if (!isDev) {
    query = query.eq("user_id", ctx.auth.uid);
  }
  if (status !== "all") {
    query = query.eq("status", status);
  }

  const { data: rows, error } = await query;
  if (error) {
    throw { code: "internal", message: "Failed to list support conversations", httpStatus: 500 };
  }

  const items = (rows || []).slice(0, limit).map((row: any) => ({
    id: String(row.id),
    userId: String(row.user_id || ""),
    category: String(row.category || "general"),
    status: String(row.status || "open"),
    lastMessage: String(row.last_message_text || ""),
    lastMessageAt: row.last_message_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    unreadForUser: Number(row.unread_for_user_count || 0),
    unreadForDev: Number(row.unread_for_dev_count || 0),
  }));

  return { conversations: items, total: items.length, hasMore: (rows || []).length > items.length };
}

export async function getSupportConversationThreadV1(payload: ConversationIdPayload, ctx: EdgeFunctionContext): Promise<Record<string, unknown>> {
  if (!ctx.auth?.uid) {
    throw { code: "unauthenticated", message: "Authentication required", httpStatus: 401 };
  }

  const conversationId = requireNonEmptyString(payload?.conversationId, "conversationId", 3, 128);
  const supabase = createSupabaseClient(ctx.env);

  const [{ data: userRow }, { data: membership }, { data: conversation, error: convError }] = await Promise.all([
    supabase.from("app_users").select("system_role").eq("id", ctx.auth.uid).single(),
    supabase
      .from("company_memberships")
      .select("role")
      .eq("user_id", ctx.auth.uid)
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("support_conversations")
      .select("id, user_id, category, status")
      .eq("id", conversationId)
      .single(),
  ]);

  if (convError || !conversation) {
    throw { code: "not-found", message: "Conversation not found", httpStatus: 404 };
  }

  const isDev = userRow?.system_role === "dev" || membership?.role === "dev";
  if (!isDev && conversation.user_id !== ctx.auth.uid) {
    throw { code: "permission-denied", message: "You can only access your own conversation", httpStatus: 403 };
  }

  const { data: rows, error } = await supabase
    .from("support_messages")
    .select("id, sender_user_id, sender_type, sender_name_snapshot, text, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    throw { code: "internal", message: "Failed to load support conversation thread", httpStatus: 500 };
  }

  const messages = (rows || []).map((row: any) => ({
    id: String(row.id),
    senderUid: String(row.sender_type || "").toLowerCase() === "dev" ? "dev" : String(row.sender_user_id || ""),
    senderRole: String(row.sender_type || "").toLowerCase(),
    senderName: String(row.sender_name_snapshot || ""),
    text: String(row.text || ""),
    createdAt: row.created_at || null,
    source: "sql",
  }));

  return {
    conversationId: String(conversation.id),
    status: String(conversation.status || "open"),
    category: String(conversation.category || "general"),
    messages,
    total: messages.length,
    hasMore: false,
  };
}
