/**
 * Documents Handler Module
 * Phase: 2 | Status: Implemented (partial)
 */
import {
  EdgeFunctionContext,
  createSupabaseClient,
  optionalTrimmedString,
  requireNonEmptyString,
  resolveCompanyIdentifiers,
  validateCompanyId,
} from "../shared-edge-helpers.ts";

async function requireDocumentAccess(
  companyId: string,
  ctx: EdgeFunctionContext,
): Promise<{ id: string; role: string }> {
  if (!ctx.auth?.uid) {
    throw { code: "unauthenticated", message: "Authentication required", httpStatus: 401 };
  }

  const supabase = createSupabaseClient(ctx.env);
  const { data: user } = await supabase
    .from("app_users")
    .select("system_role")
    .eq("id", ctx.auth.uid)
    .maybeSingle();
  if (String(user?.system_role || "").toLowerCase() === "dev") {
    return { id: "dev", role: "dev" };
  }

  const { data: membership, error } = await supabase
    .from("company_memberships")
    .select("id, role")
    .eq("company_id", companyId)
    .eq("user_id", ctx.auth.uid)
    .eq("status", "active")
    .single();

  if (error || !membership) {
    throw { code: "permission-denied", message: "Not allowed for this company", httpStatus: 403 };
  }

  if (!["manager", "user", "basic", "dev"].includes(String(membership.role))) {
    throw { code: "permission-denied", message: "Role cannot access documents", httpStatus: 403 };
  }

  return { id: membership.id, role: String(membership.role) };
}

async function bumpDocumentsVersion(companyId: string, ctx: EdgeFunctionContext): Promise<void> {
  const supabase = createSupabaseClient(ctx.env);
  const now = new Date().toISOString();
  const { data: state } = await supabase
    .from("company_sync_state")
    .select("documents_version")
    .eq("company_id", companyId)
    .maybeSingle();

  if (!state) {
    await supabase.from("company_sync_state").insert({
      company_id: companyId,
      documents_version: 1,
      updated_at: now,
    });
    return;
  }

  await supabase
    .from("company_sync_state")
    .update({ documents_version: Number(state.documents_version || 0) + 1, updated_at: now })
    .eq("company_id", companyId);
}

async function createOrReuseDocumentTask(
  companyId: string,
  userId: string,
  taskType: "preview" | "generate",
  documentType: number,
  requestPayload: Record<string, unknown>,
  ctx: EdgeFunctionContext,
): Promise<{ id: string; status: string; task_key: string }> {
  const supabase = createSupabaseClient(ctx.env);
  const { data: activeTask } = await supabase
    .from("document_tasks")
    .select("id, status, task_key")
    .eq("company_id", companyId)
    .eq("task_type", taskType)
    .eq("document_type", documentType)
    .in("status", ["pending", "queued", "processing"])
    .maybeSingle();

  if (activeTask?.id) {
    return activeTask;
  }

  const now = Date.now();
  const taskKey = `${taskType}:${companyId}:${documentType}:${userId}:${now}`;
  const expireAt = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: insertedTask, error: insertError } = await supabase
    .from("document_tasks")
    .insert({
      task_key: taskKey,
      company_id: companyId,
      user_id: userId,
      task_type: taskType,
      document_type: documentType,
      status: "pending",
      request_payload: requestPayload,
      expire_at: expireAt,
      created_at: new Date(now).toISOString(),
    })
    .select("id, status, task_key")
    .single();

  if (insertError || !insertedTask) {
    throw { code: "internal", message: `Failed to queue ${taskType} task`, httpStatus: 500 };
  }
  return insertedTask;
}

export async function publishPreviewTask(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  const requestedCompanyId = validateCompanyId(payload?.companyId);
  const resolvedCompany = await resolveCompanyIdentifiers(requestedCompanyId, ctx.env);
  const companyId = resolvedCompany.internalCompanyId;
  const membership = await requireDocumentAccess(companyId, ctx);

  const documentType = Number(payload?.documentType ?? payload?.type);
  if (!Number.isFinite(documentType) || !Number.isInteger(documentType) || documentType <= 0) {
    throw { code: "invalid-argument", message: "documentType must be a positive integer", httpStatus: 400 };
  }

  const requestPayload = {
    companyId,
    documentType,
    language: optionalTrimmedString(payload?.language, 8) || "he",
    data: payload?.data ?? null,
  };
  const task = await createOrReuseDocumentTask(
    companyId,
    ctx.auth?.uid || membership.id,
    "preview",
    documentType,
    requestPayload,
    ctx,
  );

  return {
    success: true,
    taskId: task.id,
    taskKey: task.task_key,
    status: task.status,
  };
}

export async function publishGenerateTask(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  const requestedCompanyId = validateCompanyId(payload?.companyId);
  const resolvedCompany = await resolveCompanyIdentifiers(requestedCompanyId, ctx.env);
  const companyId = resolvedCompany.internalCompanyId;
  const membership = await requireDocumentAccess(companyId, ctx);

  const documentType = Number(payload?.documentType ?? payload?.type);
  if (!Number.isFinite(documentType) || !Number.isInteger(documentType) || documentType <= 0) {
    throw { code: "invalid-argument", message: "documentType must be a positive integer", httpStatus: 400 };
  }

  const requestPayload = {
    companyId,
    documentType,
    language: optionalTrimmedString(payload?.language, 8) || "he",
    data: payload?.data ?? null,
    idempotencyKey: optionalTrimmedString(payload?.idempotencyKey, 256) || null,
  };
  const task = await createOrReuseDocumentTask(
    companyId,
    ctx.auth?.uid || membership.id,
    "generate",
    documentType,
    requestPayload,
    ctx,
  );

  return {
    success: true,
    taskId: task.id,
    taskKey: task.task_key,
    status: task.status,
  };
}

export async function deleteDocumentV1(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  const requestedCompanyId = validateCompanyId(payload?.companyId);
  const resolvedCompany = await resolveCompanyIdentifiers(requestedCompanyId, ctx.env);
  const companyId = resolvedCompany.internalCompanyId;
  const documentId = requireNonEmptyString(payload?.documentId, "documentId", 3, 128);
  await requireDocumentAccess(companyId, ctx);

  const supabase = createSupabaseClient(ctx.env);
  const { data: existingDocument, error: loadError } = await supabase
    .from("documents")
    .select("id, storage_path")
    .eq("company_id", companyId)
    .eq("id", documentId)
    .single();

  if (loadError || !existingDocument) {
    throw { code: "not-found", message: "Document not found", httpStatus: 404 };
  }

  const { error: deleteError } = await supabase
    .from("documents")
    .delete()
    .eq("company_id", companyId)
    .eq("id", documentId);

  if (deleteError) {
    throw { code: "internal", message: "Failed to delete document", httpStatus: 500 };
  }

  await bumpDocumentsVersion(companyId, ctx);
  return { success: true, documentId: existingDocument.id };
}

export async function createDocumentDownloadUrlV1(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  const requestedCompanyId = validateCompanyId(payload?.companyId);
  const resolvedCompany = await resolveCompanyIdentifiers(requestedCompanyId, ctx.env);
  const companyId = resolvedCompany.internalCompanyId;
  const documentId = requireNonEmptyString(payload?.documentId, "documentId", 3, 128);
  await requireDocumentAccess(companyId, ctx);

  const supabase = createSupabaseClient(ctx.env);
  const { data: documentRow, error: loadError } = await supabase
    .from("documents")
    .select("id, storage_path")
    .eq("company_id", companyId)
    .eq("id", documentId)
    .single();

  if (loadError || !documentRow) {
    throw { code: "not-found", message: "Document not found", httpStatus: 404 };
  }

  const storagePath = optionalTrimmedString(documentRow.storage_path, 1024);
  if (!storagePath) {
    throw { code: "failed-precondition", message: "Document file is not available", httpStatus: 400 };
  }

  const normalizedStoragePath = storagePath.replace(/^\/+/, "");
  const expectedPrefix = `companies/${resolvedCompany.publicCompanyId}/documents/`;
  if (!normalizedStoragePath.startsWith(expectedPrefix)) {
    throw { code: "failed-precondition", message: "Document storage path is invalid", httpStatus: 400 };
  }

  const bucket = Deno.env.get("DOCUMENTS_BUCKET") || "companies";
  const expirySeconds = Math.min(60 * 60, Math.max(60, Number(payload?.expirySeconds || 900) || 900));
  const { data: signed, error: signError } = await supabase.storage
    .from(bucket)
    .createSignedUrl(normalizedStoragePath, expirySeconds);

  if (signError || !signed?.signedUrl) {
    throw { code: "unavailable", message: "Document download URL is unavailable", httpStatus: 503 };
  }

  return {
    success: true,
    documentId: documentRow.id,
    downloadURL: signed.signedUrl,
    expiresAt: new Date(Date.now() + expirySeconds * 1000).toISOString(),
  };
}

export async function fetchArchiveMonthV1(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  const requestedCompanyId = validateCompanyId(payload?.companyId);
  const resolvedCompany = await resolveCompanyIdentifiers(requestedCompanyId, ctx.env);
  const companyId = resolvedCompany.internalCompanyId;
  await requireDocumentAccess(companyId, ctx);

  const year = Number(payload?.year);
  const month = Number(payload?.month);
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw { code: "invalid-argument", message: "year is invalid", httpStatus: 400 };
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw { code: "invalid-argument", message: "month is invalid", httpStatus: 400 };
  }

  const dataType = optionalTrimmedString(payload?.dataType, 40) || "documents";
  if (dataType !== "documents" && dataType !== "finishedJobs") {
    throw { code: "invalid-argument", message: "dataType must be documents or finishedJobs", httpStatus: 400 };
  }

  throw {
    code: "unavailable",
    message: "Archive month retrieval is not yet implemented in Supabase Edge runtime",
    httpStatus: 503,
    details: { year, month, dataType },
  };
}
