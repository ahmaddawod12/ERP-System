/**
 * Documents Handler Module
 * Phase: 2 | Status: Implemented (partial)
 */
import {
  allocateNextCompanyCounter,
  dispatchCloudRunPdfTask,
  EdgeFunctionContext,
  createSupabaseClient,
  optionalTrimmedString,
  requireNonEmptyString,
  resolveCompanyIdentifiers,
  validateCompanyId,
} from "../shared-edge-helpers.ts";

const DOC_SUFFIX: Record<number, string> = {
  10: "PP",
  200: "DN",
  210: "RC",
  305: "TI",
  330: "RD",
  400: "RT",
};

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
  documentId: string | null,
  requestPayload: Record<string, unknown>,
  ctx: EdgeFunctionContext,
): Promise<{ id: string; status: string; task_key: string }> {
  const supabase = createSupabaseClient(ctx.env);
  let activeTaskQuery = supabase
    .from("document_tasks")
    .select("id, status, task_key")
    .eq("company_id", companyId)
    .eq("task_type", taskType)
    .eq("document_type", documentType)
    .in("status", ["pending", "queued", "processing"]);

  if (documentId) {
    activeTaskQuery = activeTaskQuery.eq("document_id", documentId);
  } else {
    activeTaskQuery = activeTaskQuery.is("document_id", null);
  }

  const { data: activeTask } = await activeTaskQuery.maybeSingle();

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
      document_id: documentId,
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

async function loadCompanyDocumentContext(companyId: string, membershipId: string, ctx: EdgeFunctionContext) {
  const supabase = createSupabaseClient(ctx.env);
  const [{ data: companyProfile, error: companyProfileError }, { data: membership, error: membershipError }] = await Promise.all([
    supabase
      .from("company_profiles")
      .select("he_name, en_name, business_email, business_phone, address, city, vat_number")
      .eq("company_id", companyId)
      .maybeSingle(),
    supabase
      .from("company_memberships")
      .select("member_no, display_name")
      .eq("id", membershipId)
      .maybeSingle(),
  ]);

  if (companyProfileError) {
    throw { code: "internal", message: "Failed to load company profile", httpStatus: 500 };
  }
  if (membershipError) {
    throw { code: "internal", message: "Failed to load membership profile", httpStatus: 500 };
  }

  return {
    company: {
      name: companyProfile?.he_name || companyProfile?.en_name || "",
      nameHe: companyProfile?.he_name || "",
      nameEn: companyProfile?.en_name || "",
      email: companyProfile?.business_email || "",
      phone: companyProfile?.business_phone || "",
      address: [companyProfile?.address, companyProfile?.city].filter(Boolean).join(" ").trim(),
      vatNumber: companyProfile?.vat_number || "",
    },
    creator: {
      wid: membership?.member_no ? String(membership.member_no) : null,
      name: membership?.display_name || null,
    },
  };
}

function normalizeDocumentDataPayload(
  rawDocumentData: unknown,
  companyPayload: Record<string, unknown>,
): Record<string, unknown> {
  const documentData = rawDocumentData && typeof rawDocumentData === "object" && !Array.isArray(rawDocumentData)
    ? { ...(rawDocumentData as Record<string, unknown>) }
    : {};
  return {
    ...documentData,
    company: companyPayload,
  };
}

function buildPublicDocumentId(documentType: number, documentNumber: number, publicCompanyId: string) {
  const suffix = DOC_SUFFIX[documentType];
  if (!suffix) {
    throw { code: "invalid-argument", message: "Unsupported documentType", httpStatus: 400 };
  }
  return `${suffix}${documentNumber}-${publicCompanyId}`;
}

async function createDraftDocumentRecord(
  companyId: string,
  publicCompanyId: string,
  membershipId: string,
  documentType: number,
  documentData: Record<string, unknown>,
  ctx: EdgeFunctionContext,
): Promise<{ internalDocumentId: string; publicDocumentId: string; documentNumber: number }> {
  const documentNumber = await allocateNextCompanyCounter(companyId, `doc_${documentType}`, ctx);
  const publicDocumentId = buildPublicDocumentId(documentType, documentNumber, publicCompanyId);
  const client = documentData.client && typeof documentData.client === "object" ? documentData.client as Record<string, unknown> : {};
  const now = new Date().toISOString();
  const payloadDate = optionalTrimmedString(documentData.date, 64);
  const supabase = createSupabaseClient(ctx.env);

  const { data: insertedDocument, error: insertError } = await supabase
    .from("documents")
    .insert({
      company_id: companyId,
      document_type: documentType,
      document_number: documentNumber,
      document_code: publicDocumentId,
      generation_status: "pending",
      tax_authority_status: documentType === 305 ? "reserved" : "none",
      created_by_membership_id: membershipId,
      language: optionalTrimmedString(documentData.language, 8) || "he",
      document_date: payloadDate ? new Date(payloadDate).toISOString() : null,
      notes: optionalTrimmedString(documentData.notes, 4000) || null,
      total_before_vat: Number(documentData.totalBeforeVat || 0),
      vat_amount: Number(documentData.vatAmount || 0),
      total_with_vat: Number(documentData.totalWithVat || 0),
      client_name_snapshot: optionalTrimmedString(client.name, 240) || null,
      client_phone_snapshot: optionalTrimmedString(client.phone, 40) || null,
      client_city_snapshot: optionalTrimmedString(client.city, 120) || null,
      client_vat_snapshot: optionalTrimmedString(client.clientVatNumber ?? client.customerVatNumber ?? client.vatNumber, 32) || null,
      payload: documentData,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();

  if (insertError || !insertedDocument?.id) {
    throw { code: "internal", message: "Failed to create document draft", httpStatus: 500 };
  }

  return {
    internalDocumentId: String(insertedDocument.id),
    publicDocumentId,
    documentNumber,
  };
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

  const companyContext = await loadCompanyDocumentContext(companyId, membership.id, ctx);
  const documentData = normalizeDocumentDataPayload(payload?.documentData ?? payload?.data, companyContext.company);
  const requestPayload: Record<string, unknown> = {
    companyId: resolvedCompany.publicCompanyId,
    documentType,
    language: optionalTrimmedString(payload?.language, 8) || "he",
    documentData,
  };
  const task = await createOrReuseDocumentTask(
    companyId,
    ctx.auth?.uid || membership.id,
    "preview",
    documentType,
    null,
    requestPayload,
    ctx,
  );

  await dispatchCloudRunPdfTask("/preview", {
    taskId: task.task_key,
    documentType,
    documentData,
    uid: ctx.auth?.uid || membership.id,
    companyId: resolvedCompany.publicCompanyId,
  }, ctx.env);

  return {
    success: true,
    taskId: task.task_key,
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

  const companyContext = await loadCompanyDocumentContext(companyId, membership.id, ctx);
  const documentData = normalizeDocumentDataPayload(payload?.documentData ?? payload?.data, companyContext.company);
  const requestPayload: Record<string, unknown> = {
    companyId: resolvedCompany.publicCompanyId,
    documentType,
    language: optionalTrimmedString(payload?.language, 8) || "he",
    documentData,
    idempotencyKey: optionalTrimmedString(payload?.idempotencyKey, 256) || null,
  };
  const requestedDocumentId = optionalTrimmedString(payload?.documentId, 128);
  let documentId: string | null = null;
  let publicDocumentId = requestedDocumentId || null;
  let documentNumber: number | null = null;

  if (requestedDocumentId) {
    const { data: documentRow, error: documentError } = await createSupabaseClient(ctx.env)
      .from("documents")
      .select("id, document_number, document_code")
      .eq("company_id", companyId)
      .eq("document_code", requestedDocumentId)
      .maybeSingle();

    if (documentError) {
      throw { code: "internal", message: "Failed to resolve document task target", httpStatus: 500 };
    }
    documentId = documentRow?.id ? String(documentRow.id) : null;
    publicDocumentId = documentRow?.document_code ? String(documentRow.document_code) : requestedDocumentId;
    documentNumber = Number(documentRow?.document_number || 0) || null;
    if (!documentId) {
      throw { code: "not-found", message: "Document not found", httpStatus: 404 };
    }
  } else {
    const createdDocument = await createDraftDocumentRecord(
      companyId,
      resolvedCompany.publicCompanyId,
      membership.id,
      documentType,
      documentData,
      ctx,
    );
    documentId = createdDocument.internalDocumentId;
    publicDocumentId = createdDocument.publicDocumentId;
    documentNumber = createdDocument.documentNumber;
  }

  requestPayload.documentId = publicDocumentId;
  requestPayload.publicDocumentId = publicDocumentId;

  const task = await createOrReuseDocumentTask(
    companyId,
    ctx.auth?.uid || membership.id,
    "generate",
    documentType,
    documentId,
    requestPayload,
    ctx,
  );

  await dispatchCloudRunPdfTask("/generate", {
    taskId: task.task_key,
    documentType,
    documentData: {
      ...documentData,
      documentNumber: documentNumber || undefined,
    },
    uid: ctx.auth?.uid || membership.id,
    companyId: resolvedCompany.publicCompanyId,
    documentId: publicDocumentId,
    documentNumber: documentNumber || undefined,
    confirmationNumber: optionalTrimmedString(documentData["taxAuthorityConfirmationNumber"], 128) || undefined,
  }, ctx.env);

  return {
    success: true,
    taskId: task.task_key,
    taskKey: task.task_key,
    status: task.status,
    documentId: publicDocumentId,
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
