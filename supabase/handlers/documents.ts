/**
 * Documents Handler Module
 * Phase: 2 | Status: Implemented (partial)
 */
import {
  allocateNextCompanyCounter,
  assertModuleEnabled,
  bumpCompanySyncVersion,
  dispatchCloudRunPdfTask,
  EdgeFunctionContext,
  createSupabaseClient,
  isUuidLike,
  optionalTrimmedString,
  requireNonEmptyString,
  resolveCompanyIdentifiers,
  signGoogleServiceAccountJwt,
  validateCompanyId,
} from "../shared-edge-helpers.ts";
import { DOC_SUFFIX, type DocTypeCode } from "@smart-job/contracts";

async function requireDocumentAccess(
  companyId: string,
  ctx: EdgeFunctionContext,
  allowedRoles: string[] = ["manager", "user", "basic", "dev"],
): Promise<{ id: string; role: string }> {
  if (!ctx.auth?.uid) {
    throw { code: "unauthenticated", message: "Authentication required", httpStatus: 401 };
  }

  const supabase = createSupabaseClient(ctx.env);
  const [{ data: user }, { data: membership, error }] = await Promise.all([
    supabase.from("app_users").select("system_role").eq("id", ctx.auth.uid).maybeSingle(),
    supabase
      .from("company_memberships")
      .select("id, role")
      .eq("company_id", companyId)
      .eq("user_id", ctx.auth.uid)
      .eq("status", "active")
      .single(),
  ]);

  if (String(user?.system_role || "").toLowerCase() === "dev") {
    return { id: "dev", role: "dev" };
  }

  if (error || !membership) {
    throw { code: "permission-denied", message: "Not allowed for this company", httpStatus: 403 };
  }

  if (!allowedRoles.includes(String(membership.role))) {
    throw { code: "permission-denied", message: "Role cannot access documents", httpStatus: 403 };
  }

  return { id: membership.id, role: String(membership.role) };
}

export async function createOrReuseDocumentTask(
  companyId: string,
  userId: string,
  taskType: "preview" | "generate",
  documentType: number,
  documentId: string | null,
  requestPayload: Record<string, unknown>,
  ctx: EdgeFunctionContext,
): Promise<{ id: string; status: string; task_key: string; isNew: boolean }> {
  const supabase = createSupabaseClient(ctx.env);
  const lockKey = await buildDocumentTaskLockKey(taskType, documentType, documentId, requestPayload);
  let activeTaskQuery = supabase
    .from("document_tasks")
    .select("id, status, task_key")
    .eq("company_id", companyId)
    .eq("task_type", taskType)
    .eq("lock_key", lockKey)
    .in("status", ["pending", "queued", "processing"]);

  const { data: activeTask } = await activeTaskQuery.maybeSingle();

  if (activeTask?.id) {
    return { ...activeTask, isNew: false };
  }

  const now = Date.now();
  const taskKey = `${taskType}:${companyId}:${documentType}:${userId}:${now}`;
  const expireAt = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: insertedTask, error: insertError } = await supabase
    .from("document_tasks")
    .insert({
      task_key: taskKey,
      lock_key: lockKey,
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

  if (insertError && isActiveDocumentTaskConflict(insertError)) {
    const { data: concurrentTask } = await supabase
      .from("document_tasks")
      .select("id, status, task_key")
      .eq("company_id", companyId)
      .eq("task_type", taskType)
      .eq("lock_key", lockKey)
      .in("status", ["pending", "queued", "processing"])
      .maybeSingle();

    if (concurrentTask?.id) {
      return { ...concurrentTask, isNew: false };
    }
  }

  if (insertError || !insertedTask) {
    throw { code: "internal", message: `Failed to queue ${taskType} task`, httpStatus: 500 };
  }
  return { ...insertedTask, isNew: true };
}

async function markDocumentTaskDispatchFailed(taskKey: string, message: string, ctx: EdgeFunctionContext): Promise<void> {
  const supabase = createSupabaseClient(ctx.env);
  await supabase
    .from("document_tasks")
    .update({
      status: "failed",
      error: String(message || "Task dispatch failed"),
      completed_at: new Date().toISOString(),
    })
    .eq("task_key", taskKey)
    .in("status", ["pending", "queued"]);
}

function normalizeStoragePath(value: unknown): string | null {
  const normalized = optionalTrimmedString(value, 1024)?.replace(/^\/+/, "") || null;
  if (!normalized || normalized.includes("..") || normalized.includes("?")) {
    return null;
  }
  return normalized;
}

async function createServiceAccountAccessToken(scopes: string[]): Promise<string | null> {
  const serviceAccountEmail = String(
    Deno.env.get("GCP_SERVICE_ACCOUNT_EMAIL") || Deno.env.get("GOOGLE_CLIENT_EMAIL") || "",
  ).trim();
  const privateKey = String(
    Deno.env.get("GCP_SERVICE_ACCOUNT_PRIVATE_KEY") || Deno.env.get("GOOGLE_PRIVATE_KEY") || "",
  ).replace(/\\n/g, "\n").trim();

  if (!serviceAccountEmail || !privateKey || scopes.length === 0) {
    return null;
  }

  const assertion = await signGoogleServiceAccountJwt(
    serviceAccountEmail,
    privateKey,
    "https://oauth2.googleapis.com/token",
    { scope: scopes.join(" ") },
  );

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) {
    throw {
      code: "unavailable",
      httpStatus: 503,
      message: `Failed to mint GCP access token (${response.status})`,
    };
  }

  const payload = await response.json().catch(() => null) as { access_token?: unknown } | null;
  const accessToken = String(payload?.access_token || "").trim();
  return accessToken || null;
}

async function readArchiveJson(companyId: string, archiveKey: string): Promise<unknown[] | null> {
  const archiveBucket = String(Deno.env.get("ARCHIVE_BUCKET") || "").trim();
  if (!archiveBucket) {
    throw {
      code: "unavailable",
      httpStatus: 503,
      message: "ARCHIVE_BUCKET is not configured",
    };
  }

  const accessToken = await createServiceAccountAccessToken(["https://www.googleapis.com/auth/devstorage.read_only"]);
  if (!accessToken) {
    throw {
      code: "unavailable",
      httpStatus: 503,
      message: "Archive retrieval credentials are not configured",
    };
  }

  const objectPath = `companies/${companyId}/archives/${archiveKey}.json`;
  const encodedObject = encodeURIComponent(objectPath);
  const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(archiveBucket)}/o/${encodedObject}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw {
      code: "unavailable",
      httpStatus: 503,
      message: `Archive month retrieval failed (${response.status})`,
    };
  }

  const payload = await response.json().catch(() => null);
  return Array.isArray(payload) ? payload : null;
}

async function loadCompanyDocumentContext(companyId: string, membershipId: string, ctx: EdgeFunctionContext) {
  const supabase = createSupabaseClient(ctx.env);
  const isDev = membershipId === "dev";

  const [{ data: companyProfile, error: companyProfileError }, { data: membership, error: membershipError }] = await Promise.all([
    supabase
      .from("company_profiles")
      .select("he_name, en_name, business_email, business_phone, address, city, vat_number")
      .eq("company_id", companyId)
      .maybeSingle(),
    isDev
      ? Promise.resolve({ data: null, error: null })
      : supabase
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

function parseDocumentDate(value: unknown, fieldName: string): string | null {
  const raw = optionalTrimmedString(value, 64);
  if (!raw) return null;
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) {
    throw { code: "invalid-argument", message: `${fieldName} must be a valid ISO date`, httpStatus: 400 };
  }
  return new Date(ts).toISOString();
}

const MAX_ITEMS_PER_DOCUMENT = 100;

function normalizeDocumentDataPayload(
  rawDocumentData: unknown,
  companyPayload: Record<string, unknown>,
): Record<string, unknown> {
  const documentData = rawDocumentData && typeof rawDocumentData === "object" && !Array.isArray(rawDocumentData)
    ? { ...(rawDocumentData as Record<string, unknown>) }
    : {};
  const items = (documentData as any).items;
  if (Array.isArray(items) && items.length > MAX_ITEMS_PER_DOCUMENT) {
    throw {
      code: "invalid-argument",
      message: `Document may contain at most ${MAX_ITEMS_PER_DOCUMENT} items`,
      httpStatus: 400,
    };
  }
  return {
    ...documentData,
    company: companyPayload,
  };
}

export function buildPublicDocumentId(documentType: number, documentNumber: number, publicCompanyId: string) {
  const suffix = DOC_SUFFIX[documentType as DocTypeCode];
  if (!suffix) {
    throw { code: "invalid-argument", message: "Unsupported documentType", httpStatus: 400 };
  }
  return `${suffix}${documentNumber}-${publicCompanyId}`;
}

function normalizeTaskLockPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeTaskLockPayload(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, nestedValue]) => nestedValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, normalizeTaskLockPayload(nestedValue)]),
  );
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function buildDocumentTaskLockKey(
  taskType: "preview" | "generate",
  documentType: number,
  documentId: string | null,
  requestPayload: Record<string, unknown>,
): Promise<string> {
  const normalizedDocumentId = String(documentId || "").trim();
  if (normalizedDocumentId) {
    return `document:${normalizedDocumentId}`;
  }

  const normalizedPayload = JSON.stringify(normalizeTaskLockPayload(requestPayload));
  const payloadHash = await sha256Hex(`${taskType}:${documentType}:${normalizedPayload}`);
  return `${taskType}:${documentType}:${payloadHash}`;
}

function isActiveDocumentTaskConflict(error: any): boolean {
  const constraint = String(error?.constraint || error?.details || error?.message || "");
  return String(error?.code || "") === "23505" && constraint.includes("document_tasks_active_company_lock_unique");
}

async function resolveCompanyDocument<T extends Record<string, unknown>>(
  companyId: string,
  documentIdentifier: string,
  fields: string,
  ctx: EdgeFunctionContext,
): Promise<T | null> {
  const supabase = createSupabaseClient(ctx.env);
  const normalizedIdentifier = String(documentIdentifier || "").trim();

  const { data: byCode, error: byCodeError } = await supabase
    .from("documents")
    .select(fields)
    .eq("company_id", companyId)
    .eq("document_code", normalizedIdentifier)
    .maybeSingle();
  if (byCodeError) {
    throw { code: "internal", message: "Failed to load document", httpStatus: 500 };
  }
  if (byCode) {
    return byCode as unknown as T;
  }

  if (!isUuidLike(normalizedIdentifier)) {
    return null;
  }

  const { data: byId, error: byIdError } = await supabase
    .from("documents")
    .select(fields)
    .eq("company_id", companyId)
    .eq("id", normalizedIdentifier)
    .maybeSingle();
  if (byIdError) {
    throw { code: "internal", message: "Failed to load document", httpStatus: 500 };
  }
  return (byId as T | null) ?? null;
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
      document_date: parseDocumentDate(payloadDate, "documentDate"),
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

  if (task.isNew) {
    try {
      await dispatchCloudRunPdfTask("/preview", {
        taskId: task.task_key,
        documentType,
        documentData,
        uid: ctx.auth?.uid || membership.id,
        companyId: resolvedCompany.publicCompanyId,
      }, ctx.env);
    } catch (error) {
      await markDocumentTaskDispatchFailed(task.task_key, error instanceof Error ? error.message : "Preview dispatch failed", ctx);
      throw error;
    }
  }

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
  await assertModuleEnabled(companyId, "documents", ctx);
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
    const documentRow = await resolveCompanyDocument<{
      id?: string;
      document_number?: number;
      document_code?: string;
      document_type?: number;
    }>(
      companyId,
      requestedDocumentId,
      "id, document_number, document_code, document_type",
      ctx,
    );
    documentId = documentRow?.id ? String(documentRow.id) : null;
    publicDocumentId = documentRow?.document_code ? String(documentRow.document_code) : requestedDocumentId;
    documentNumber = Number(documentRow?.document_number || 0) || null;
    if (!documentId) {
      throw { code: "not-found", message: "Document not found", httpStatus: 404 };
    }
    if (documentRow?.document_type !== undefined && Number(documentRow.document_type) !== documentType) {
      throw {
        code: "failed-precondition",
        message: `Document type mismatch: requested ${documentType} but existing document is ${documentRow.document_type}`,
        httpStatus: 400,
      };
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

  if (task.isNew) {
    try {
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
    } catch (error) {
      await markDocumentTaskDispatchFailed(task.task_key, error instanceof Error ? error.message : "Generate dispatch failed", ctx);
      throw error;
    }
  }

  await bumpCompanySyncVersion(companyId, "documents_version", ctx);

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
  await assertModuleEnabled(companyId, "documents", ctx);
  const documentId = requireNonEmptyString(payload?.documentId, "documentId", 3, 128);
  await requireDocumentAccess(companyId, ctx, ["manager", "dev"]);

  const supabase = createSupabaseClient(ctx.env);
  const existingDocument = await resolveCompanyDocument<{
    id?: string;
    document_code?: string;
    storage_path?: string;
    document_type?: number;
    tax_authority_status?: string;
  }>(
    companyId,
    documentId,
    "id, document_code, storage_path, document_type, tax_authority_status",
    ctx,
  );

  if (!existingDocument) {
    throw { code: "not-found", message: "Document not found", httpStatus: 404 };
  }

  const TAX_INVOICE_TYPE = 305;
  if (
    Number(existingDocument.document_type) === TAX_INVOICE_TYPE &&
    String(existingDocument.tax_authority_status || "").toLowerCase() === "approved"
  ) {
    throw {
      code: "failed-precondition",
      message: "Approved tax invoices cannot be deleted",
      httpStatus: 400,
    };
  }

  const { error: deleteError } = await supabase
    .from("documents")
    .delete()
    .eq("company_id", companyId)
    .eq("id", String(existingDocument.id));

  if (deleteError) {
    throw { code: "internal", message: "Failed to delete document", httpStatus: 500 };
  }

  await bumpCompanySyncVersion(companyId, "documents_version", ctx);
  return {
    success: true,
    documentId: optionalTrimmedString(existingDocument.document_code, 128) || String(existingDocument.id),
  };
}

export async function createDocumentDownloadUrlV1(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  const requestedCompanyId = validateCompanyId(payload?.companyId);
  const resolvedCompany = await resolveCompanyIdentifiers(requestedCompanyId, ctx.env);
  const companyId = resolvedCompany.internalCompanyId;
  await assertModuleEnabled(companyId, "documents", ctx);
  const documentId = requireNonEmptyString(payload?.documentId, "documentId", 3, 128);
  await requireDocumentAccess(companyId, ctx);

  const supabase = createSupabaseClient(ctx.env);
  const documentRow = await resolveCompanyDocument<{
    id?: string;
    document_code?: string;
    storage_path?: string;
  }>(
    companyId,
    documentId,
    "id, document_code, storage_path",
    ctx,
  );

  if (!documentRow) {
    throw { code: "not-found", message: "Document not found", httpStatus: 404 };
  }

  const storagePath = optionalTrimmedString(documentRow.storage_path, 1024);
  if (!storagePath) {
    throw { code: "failed-precondition", message: "Document file is not available", httpStatus: 400 };
  }

  const normalizedStoragePath = normalizeStoragePath(storagePath);
  if (!normalizedStoragePath) {
    throw { code: "failed-precondition", message: "Document storage path is invalid", httpStatus: 400 };
  }
  const expectedPrefix = `${resolvedCompany.internalCompanyId}/documents/`;
  if (!normalizedStoragePath.startsWith(expectedPrefix)) {
    throw { code: "failed-precondition", message: "Document storage path is invalid", httpStatus: 400 };
  }

  const bucket = Deno.env.get("DOCUMENTS_BUCKET") || "smart-job-company-files";
  const expirySeconds = Math.min(60 * 60, Math.max(60, Number(payload?.expirySeconds || 900) || 900));
  const { data: signed, error: signError } = await supabase.storage
    .from(bucket)
    .createSignedUrl(normalizedStoragePath, expirySeconds);

  if (signError || !signed?.signedUrl) {
    throw { code: "unavailable", message: "Document download URL is unavailable", httpStatus: 503 };
  }

  return {
    success: true,
    documentId: optionalTrimmedString(documentRow.document_code, 128) || String(documentRow.id),
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

  const archiveKey = `${year}-${month}-${dataType === "finishedJobs" ? "j" : "d"}`;
  const items = await readArchiveJson(resolvedCompany.publicCompanyId, archiveKey);
  return {
    success: true,
    year,
    month,
    dataType,
    items: items || [],
  };
}
