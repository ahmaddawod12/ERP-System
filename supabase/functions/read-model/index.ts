import {
  getEnv,
  createEdgeFunctionContext,
  handleOptions,
  handleHttpError,
  buildHttpResponse,
  buildSuccessResponse,
  parseJsonBody,
  validateCompanyId,
  assertCompanyAccess,
  assertModuleEnabled,
  createSupabaseClient,
  resolveCompanyIdentifiers,
  optionalTrimmedString,
} from "../../shared-edge-helpers.ts";
import type { EdgeFunctionContext } from "../../shared-edge-helpers.ts";
import {
  canReadCompanyDocuments,
  canReadCompanyInventory,
  canReadCompanyJobs,
  canReadCompanyWorkers,
  canReadUserInventory,
  shouldScopeJobsToMembership,
} from "./auth-scope.ts";
import {
  getRowDateValue,
  isUuidLike,
  normalizeDateFilter,
  normalizeStringList,
  resolveDocumentDateField,
  resolveJobDateField,
} from "./filters.ts";
import {
  makeCursor,
  parseCursor,
  parseNumberCursor,
  parseReadLimit,
} from "./pagination.ts";
import type { CompanyScope, RequesterContext } from "./types.ts";
import {
  getCompanyInventoryParts,
  getJobAttachments,
  getJobPartUsageMap,
  getMembershipIdsForUser,
  getMembershipMap,
  getRequesterContext,
  getUserInventoryParts,
  mapJobRecord,
  resolveCompanyScope,
} from "./kinds/shared-data.ts";

const env = getEnv();
const NEVER_UUID = "00000000-0000-4000-8000-000000000000";

const READ_MODEL_KINDS = new Set([
  "bootstrap",
  "workers",
  "clients",
  "jobs",
  "documents",
  "inventory",
  "companySyncState",
  "recordById",
  "documentTask",
  "userSyncState",
]);

function normalizeDocumentPayload(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

function emptyInventoryPayload(): {
  parts: unknown[];
  nextId: number;
  lastUpdated: string;
  nextCursor: string | null;
} {
  return {
    parts: [],
    nextId: 1,
    lastUpdated: new Date().toISOString(),
    nextCursor: null,
  };
}

async function getInventoryCounts(
  supabase: ReturnType<typeof createSupabaseClient>,
  internalCompanyId: string,
  membershipId: string | null,
): Promise<{ inventoryParts: number; companyInventoryParts: number }> {
  const { data, error } = await supabase.rpc("get_inventory_counts", {
    p_company_id: internalCompanyId,
    p_membership_id: membershipId,
  });
  if (error) {
    throw { code: "internal", httpStatus: 500, message: "Failed to load inventory counts" };
  }

  const payload = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};
  return {
    inventoryParts: Number(payload.inventoryParts || 0),
    companyInventoryParts: Number(payload.companyInventoryParts || 0),
  };
}

function numericOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundCurrency(value: unknown): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function getDocumentDetailMaps(documentIds: string[]) {
  const normalizedDocumentIds = Array.from(new Set(
    (documentIds || []).map((value) => String(value || "").trim()).filter(Boolean),
  ));
  const itemsByDocumentId = new Map<string, Array<Record<string, unknown>>>();
  const jobsByDocumentId = new Map<string, Array<{ jobId: string }>>();
  if (normalizedDocumentIds.length === 0) {
    return { itemsByDocumentId, jobsByDocumentId };
  }

  const supabase = createSupabaseClient(env);
  const [itemResult, jobLinkResult] = await Promise.all([
    supabase
      .from("document_items")
      .select("document_id, line_no, description, quantity, unit_price, metadata")
      .in("document_id", normalizedDocumentIds)
      .order("line_no", { ascending: true }),
    supabase
      .from("document_job_links")
      .select("document_id, jobs(job_no)")
      .in("document_id", normalizedDocumentIds),
  ]);

  if (itemResult.error) {
    throw { code: "internal", httpStatus: 500, message: "Failed to load document items" };
  }
  if (jobLinkResult.error) {
    throw { code: "internal", httpStatus: 500, message: "Failed to load document job links" };
  }

  for (const row of itemResult.data || []) {
    const key = String(row.document_id || "");
    if (!key) continue;
    const next = itemsByDocumentId.get(key) || [];
    const metadata = normalizeDocumentPayload(row.metadata);
    next.push({
      description: row.description || "",
      quantity: Number(row.quantity || 0),
      price: Number(row.unit_price || 0),
      partId: numericOrNull(metadata.partId),
    });
    itemsByDocumentId.set(key, next);
  }

  for (const row of jobLinkResult.data || []) {
    const key = String(row.document_id || "");
    const jobNo = Number((row as any).jobs?.job_no || 0);
    if (!key || !Number.isFinite(jobNo) || jobNo <= 0) continue;
    const next = jobsByDocumentId.get(key) || [];
    next.push({ jobId: String(jobNo) });
    jobsByDocumentId.set(key, next);
  }

  return { itemsByDocumentId, jobsByDocumentId };
}

async function getDocumentCreatorMap(internalCompanyId: string, membershipIds: string[]) {
  const normalizedMembershipIds = Array.from(new Set(
    (membershipIds || []).map((value) => String(value || "").trim()).filter(Boolean),
  ));
  const result = new Map<string, { uid: string | null; name: string | null }>();
  if (normalizedMembershipIds.length === 0) return result;

  const supabase = createSupabaseClient(env);
  const { data, error } = await supabase
    .from("company_memberships")
    .select("id, user_id, display_name, app_users(display_name, email)")
    .eq("company_id", internalCompanyId)
    .in("id", normalizedMembershipIds);

  if (error) {
    throw { code: "internal", httpStatus: 500, message: "Failed to load document creators" };
  }

  for (const row of data || []) {
    result.set(String(row.id), {
      uid: row.user_id ? String(row.user_id) : null,
      name: row.display_name || (row as any).app_users?.display_name || (row as any).app_users?.email || null,
    });
  }
  return result;
}

async function mapDocumentRows(internalCompanyId: string, rows: any[]) {
  const documentRows = rows || [];
  const documentIds = documentRows.map((row) => String(row.id || "")).filter(Boolean);
  const creatorIds = documentRows.map((row) => String(row.created_by_membership_id || "")).filter(Boolean);
  const [{ itemsByDocumentId, jobsByDocumentId }, creatorByMembershipId] = await Promise.all([
    getDocumentDetailMaps(documentIds),
    getDocumentCreatorMap(internalCompanyId, creatorIds),
  ]);

  return documentRows.map((doc: any) => {
    const payload = normalizeDocumentPayload(doc.payload);
    const payloadClient = normalizeDocumentPayload(payload.client);
    const items = itemsByDocumentId.get(String(doc.id)) || [];
    const jobsData = jobsByDocumentId.get(String(doc.id)) || (Array.isArray(payload.jobsData) ? payload.jobsData : []);
    const creator = creatorByMembershipId.get(String(doc.created_by_membership_id || ""));
    const confirmationNumber = doc.confirmation_number || payload.taxAuthorityConfirmationNumber || undefined;
    return {
      id: String(doc.document_code || doc.id),
      type: Number(doc.document_type),
      documentType: Number(doc.document_type),
      documentNumber: doc.document_number,
      documentId: doc.document_code,
      clientId: doc.client_id || null,
      cname: doc.client_name_snapshot || payloadClient.name || "",
      cphone: doc.client_phone_snapshot || payloadClient.phone || "",
      clientCity: doc.client_city_snapshot || payloadClient.city || "",
      clientVatNumber: doc.client_vat_snapshot || payloadClient.clientVatNumber || payloadClient.vatNumber || "",
      cid: payloadClient.clientId || payloadClient.id || undefined,
      language: doc.language || payload.language || "he",
      notes: doc.notes || payload.notes || "",
      storagePath: doc.storage_path || null,
      confirmationNumber: confirmationNumber || null,
      taxAuthorityConfirmationNumber: confirmationNumber || undefined,
      items,
      totalBeforeVat: roundCurrency(doc.total_before_vat),
      vatAmount: roundCurrency(doc.vat_amount),
      totalWithVat: roundCurrency(doc.total_with_vat),
      documentData: payload,
      paymentMethod: payload.paymentMethod || undefined,
      paymentInfo: payload.paymentInfo || undefined,
      createdByUid: creator?.uid || undefined,
      createdByName: creator?.name || undefined,
      date: doc.document_date || payload.date || undefined,
      jobsData,
      status: doc.generation_status || undefined,
      taxAuthorityResponseData: doc.tax_authority_response || null,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
    };
  });
}

function hasOptionalPaging(body: Record<string, unknown>): boolean {
  return body.pageSize != null || body.limit != null || Boolean(optionalTrimmedString(body.afterCursor, 200));
}

function normalizePrefixSearch(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/[%,*().]/g, "")
    .slice(0, 80);
}

function buildReadModelContext(uid: string): EdgeFunctionContext {
  return {
    correlationId: "read-model",
    logger: console as any,
    auth: { uid, claims: {} },
    env,
    corsHeaders: {},
  };
}

type ReadModelSupabase = ReturnType<typeof createSupabaseClient>;

interface HandlerContext {
  supabase: ReadModelSupabase;
  scope: CompanyScope;
  requester: RequesterContext;
  ctx: EdgeFunctionContext;
}

async function handleCompanySyncState(
  _body: Record<string, unknown>,
  _uid: string,
  { supabase, scope }: Pick<HandlerContext, "supabase" | "scope">,
) {
  const { data } = await supabase
    .from("company_sync_state")
    .select("jobs_version, documents_version, clients_version, workers_version, company_inventory_version, updated_at")
    .eq("company_id", scope.internalCompanyId)
    .maybeSingle();

  return {
    jobsVersion: Number(data?.jobs_version || 0),
    documentsVersion: Number(data?.documents_version || 0),
    clientsVersion: Number(data?.clients_version || 0),
    workersVersion: Number(data?.workers_version || 0),
    companyInventoryVersion: Number(data?.company_inventory_version || 0),
    updatedAt: data?.updated_at || new Date().toISOString(),
  };
}

async function handleWorkers(
  _body: Record<string, unknown>,
  _uid: string,
  { supabase, scope, requester, ctx }: HandlerContext,
) {
  await assertModuleEnabled(scope.internalCompanyId, "workers", ctx);
  if (!canReadCompanyWorkers(requester)) {
    return [];
  }

  const { data } = await supabase
    .from("company_memberships")
    .select("id, user_id, member_no, role, display_name, phone_number, created_at, updated_at, app_users(email)")
    .eq("company_id", scope.internalCompanyId)
    .eq("status", "active")
    .in("role", ["worker", "user", "basic"])
    .order("member_no", { ascending: true });

  return (data || []).map((row: any) => ({
    wid: row.member_no,
    uid: row.user_id,
    email: row.app_users?.email || "",
    role: row.role,
    name: row.display_name || "",
    phoneNumber: row.phone_number || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

async function handleClients(
  body: Record<string, unknown>,
  _uid: string,
  { supabase, scope, ctx }: Pick<HandlerContext, "supabase" | "scope" | "ctx">,
) {
  await assertModuleEnabled(scope.internalCompanyId, "clients", ctx);
  const pageSize = parseReadLimit(body);
  const cursor = parseNumberCursor(body.afterCursor);
  const search = normalizePrefixSearch(body.search);
  const { data, error } = await supabase.rpc("get_clients_page", {
    p_company_id: scope.internalCompanyId,
    p_page_size: pageSize,
    p_after_client_no: cursor ? cursor.value : null,
    p_after_id: cursor ? cursor.id : null,
    p_search: search || null,
  });
  if (error) {
    throw { code: "internal", httpStatus: 500, message: "Failed to load clients" };
  }

  const payload = data && typeof data === "object" && !Array.isArray(data)
    ? data as { items?: unknown; nextCursor?: unknown }
    : {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  return {
    items,
    nextCursor: typeof payload.nextCursor === "string" && payload.nextCursor.trim() ? payload.nextCursor : null,
  };
}

async function handleInventory(
  body: Record<string, unknown>,
  uid: string,
  { supabase, scope, requester, ctx }: HandlerContext,
) {
  await assertModuleEnabled(scope.internalCompanyId, "inventory", ctx);
  const scopeKind = optionalTrimmedString(body.scope, 16) || "company";
  if (scopeKind === "user") {
    if (!canReadUserInventory(requester)) {
      throw {
        code: "permission-denied",
        httpStatus: 403,
        message: "Inventory is not available for this role or subscription tier",
      };
    }
    const targetUid = optionalTrimmedString(body.targetUid, 200) || uid;
    if (targetUid !== uid) {
      if (!requester.isDev && requester.role !== "manager") {
        throw {
          code: "permission-denied",
          httpStatus: 403,
          message: "Only managers can read another member inventory",
        };
      }
    }
    return getUserInventoryParts(scope.internalCompanyId, targetUid, {
      pageSize: parseReadLimit(body),
      afterCursor: parseNumberCursor(body.afterCursor),
      search: optionalTrimmedString(body.search, 80) || null,
    });
  }
  if (!canReadCompanyInventory(requester)) {
    throw {
      code: "permission-denied",
      httpStatus: 403,
      message: "Company inventory is not available for this role or subscription tier",
    };
  }
  return getCompanyInventoryParts(scope.internalCompanyId, {
    pageSize: parseReadLimit(body),
    afterCursor: parseNumberCursor(body.afterCursor),
    search: optionalTrimmedString(body.search, 80) || null,
  });
}

async function handleDocumentTask(
  body: Record<string, unknown>,
  uid: string,
  { supabase, scope, requester, ctx }: HandlerContext,
) {
  await assertModuleEnabled(scope.internalCompanyId, "documents", ctx);
  const taskId = optionalTrimmedString(body.taskId, 160);
  if (!taskId) {
    throw { code: "invalid-argument", httpStatus: 400, message: "taskId is required" };
  }

  const { data: task } = await supabase
    .from("document_tasks")
    .select("id, company_id, user_id, task_type, status, preview_url, generate_url, request_payload, storage_path, pdf_size, error, document_id")
    .eq("company_id", scope.internalCompanyId)
    .eq("task_key", taskId)
    .maybeSingle();

  if (!task) return null;
  if (String(task.company_id) !== scope.internalCompanyId) {
    throw { code: "permission-denied", httpStatus: 403, message: "Not allowed to read this task" };
  }

  const isTaskOwner = String(task.user_id) === uid;
  const canReadCompanyTask = requester.isDev || requester.role === "manager";
  if (!isTaskOwner && !canReadCompanyTask) {
    throw { code: "permission-denied", httpStatus: 403, message: "Not allowed to read this task" };
  }

  return {
    status: task.status,
    taskType: task.task_type,
    previewURL: task.preview_url || null,
    downloadURL: task.generate_url || null,
    documentId: task.request_payload?.publicDocumentId || task.request_payload?.documentId || null,
    pdfSize: task.pdf_size || null,
    storagePath: task.storage_path || null,
    error: task.error || null,
    requestPayload: task.request_payload || {},
  };
}

async function handleRecordById(
  body: Record<string, unknown>,
  uid: string,
  { supabase, scope, requester }: Pick<HandlerContext, "supabase" | "scope" | "requester">,
) {
  const recordId = optionalTrimmedString(body.recordId, 160);
  if (!recordId) {
    throw { code: "invalid-argument", httpStatus: 400, message: "recordId is required" };
  }

  const normalizedRecordId = String(recordId || "").trim();
  const jobQuery = supabase
    .from("jobs")
    .select("id, job_no, status, title, description, notes, location, address, category, priority, due_at, client_id, client_name_snapshot, client_phone_snapshot, assigned_membership_id, assigned_member_name_snapshot, created_by_membership_id, created_by_name_snapshot, is_cert, meta, created_at, updated_at, finished_at, denied_at")
    .eq("company_id", scope.internalCompanyId);
  const documentByCodeQuery = supabase
    .from("documents")
    .select("id, document_type, document_number, document_code, generation_status, tax_authority_status, client_id, client_name_snapshot, client_phone_snapshot, client_city_snapshot, client_vat_snapshot, created_by_membership_id, language, notes, storage_path, confirmation_number, total_before_vat, vat_amount, total_with_vat, payload, tax_authority_response, created_at, updated_at, document_date")
    .eq("company_id", scope.internalCompanyId)
    .eq("document_code", normalizedRecordId)
    .or("document_type.neq.305,tax_authority_status.eq.approved")
    .maybeSingle();
  const documentByIdQuery = isUuidLike(normalizedRecordId)
    ? supabase
      .from("documents")
      .select("id, document_type, document_number, document_code, generation_status, tax_authority_status, client_id, client_name_snapshot, client_phone_snapshot, client_city_snapshot, client_vat_snapshot, created_by_membership_id, language, notes, storage_path, confirmation_number, total_before_vat, vat_amount, total_with_vat, payload, tax_authority_response, created_at, updated_at, document_date")
      .eq("company_id", scope.internalCompanyId)
      .eq("id", normalizedRecordId)
      .or("document_type.neq.305,tax_authority_status.eq.approved")
      .maybeSingle()
    : Promise.resolve({ data: null });

  const [{ data: job }, { data: documentByCode }, { data: documentById }] = await Promise.all([
    (/^\d+$/.test(normalizedRecordId)
      ? jobQuery.eq("job_no", Number(normalizedRecordId))
      : isUuidLike(normalizedRecordId)
        ? jobQuery.eq("id", normalizedRecordId)
        : jobQuery.eq("id", NEVER_UUID)
    ).maybeSingle(),
    documentByCodeQuery,
    documentByIdQuery,
  ]);
  const document = documentByCode || documentById;

  if (job) {
    if (!canReadCompanyJobs(requester)) {
      return null;
    }
    if (
      shouldScopeJobsToMembership(requester) &&
      (!requester.membershipId || String(job.assigned_membership_id || "") !== requester.membershipId)
    ) {
      return null;
    }
    const [membershipMap, attachmentsByJobId, partsByJobId] = await Promise.all([
      getMembershipMap(scope.internalCompanyId, [job.assigned_membership_id, job.created_by_membership_id].filter(Boolean).map(String)),
      getJobAttachments([String(job.id)]),
      getJobPartUsageMap([String(job.id)]),
    ]);
    return mapJobRecord(job, membershipMap, attachmentsByJobId, partsByJobId);
  }

  if (document) {
    if (!canReadCompanyDocuments(requester)) {
      return null;
    }
    const mapped = await mapDocumentRows(scope.internalCompanyId, [document]);
    return mapped[0] || null;
  }

  return null;
}

async function handleJobs(
  body: Record<string, unknown>,
  _uid: string,
  { supabase, scope, requester, ctx }: HandlerContext,
) {
  await assertModuleEnabled(scope.internalCompanyId, "jobs", ctx);
  if (!canReadCompanyJobs(requester)) {
    return { items: [], nextCursor: null };
  }

  const pageSize = parseReadLimit(body);
  const cursor = parseCursor(body.afterCursor);
  const dateField = resolveJobDateField(body.dateField);
  const statuses = normalizeStringList(body.status);
  const dateFrom = normalizeDateFilter(body.dateFrom);
  const dateTo = normalizeDateFilter(body.dateTo);
  let query = supabase
    .from("jobs")
    .select("id, job_no, status, title, description, notes, location, address, category, priority, due_at, client_id, client_name_snapshot, client_phone_snapshot, assigned_membership_id, assigned_member_name_snapshot, created_by_membership_id, created_by_name_snapshot, is_cert, meta, created_at, updated_at, finished_at, denied_at")
    .eq("company_id", scope.internalCompanyId)
    .order(dateField, { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize + 1);

  if (shouldScopeJobsToMembership(requester)) {
    if (!requester.membershipId) {
      return { items: [], nextCursor: null };
    }
    query = query.eq("assigned_membership_id", requester.membershipId);
  }
  if (statuses.length === 1) {
    query = query.eq("status", statuses[0]);
  } else if (statuses.length > 1) {
    query = query.in("status", statuses);
  }
  if (dateFrom) {
    query = query.gte(dateField, dateFrom);
  }
  if (dateTo) {
    query = query.lte(dateField, dateTo);
  }
  if (cursor) {
    query = query.or(`${dateField}.lt.${cursor.createdAt},and(${dateField}.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  }

  const { data, error } = await query;
  if (error) {
    throw { code: "internal", httpStatus: 500, message: "Failed to load jobs" };
  }
  const slicedRows = (data || []).slice(0, pageSize);
  const membershipMap = await getMembershipMap(
    scope.internalCompanyId,
    slicedRows.flatMap((job: any) => [job.assigned_membership_id, job.created_by_membership_id]).filter(Boolean).map(String),
  );
  const attachmentsByJobId = await getJobAttachments(slicedRows.map((job: any) => String(job.id)));
  const partsByJobId = await getJobPartUsageMap(slicedRows.map((job: any) => String(job.id)));
  const hasMore = (data || []).length > pageSize;
  const items = slicedRows.map((job: any) => mapJobRecord(job, membershipMap, attachmentsByJobId, partsByJobId));

  const nextCursor = hasMore && items.length > 0
    ? makeCursor(getRowDateValue(slicedRows[slicedRows.length - 1], dateField), slicedRows[slicedRows.length - 1]?.id)
    : null;

  return { items, nextCursor };
}

async function handleDocuments(
  body: Record<string, unknown>,
  _uid: string,
  { supabase, scope, requester, ctx }: HandlerContext,
) {
  await assertModuleEnabled(scope.internalCompanyId, "documents", ctx);
  if (!canReadCompanyDocuments(requester)) {
    return { items: [], nextCursor: null };
  }

  const pageSize = parseReadLimit(body);
  const cursor = parseCursor(body.afterCursor);
  const dateField = resolveDocumentDateField(body.dateField);
  const statuses = normalizeStringList(body.status);
  const dateFrom = normalizeDateFilter(body.dateFrom);
  const dateTo = normalizeDateFilter(body.dateTo);
  const documentType = Number(body.documentType);
  const createdByUid = optionalTrimmedString(body.createdByUid, 200);
  const creatorMembershipIds = createdByUid
    ? await getMembershipIdsForUser(scope.internalCompanyId, createdByUid)
    : [];

  if (createdByUid && creatorMembershipIds.length === 0) {
    return { items: [], nextCursor: null };
  }

  let query = supabase
    .from("documents")
    .select("id, document_type, document_number, document_code, generation_status, tax_authority_status, client_id, client_name_snapshot, client_phone_snapshot, client_city_snapshot, client_vat_snapshot, created_by_membership_id, language, notes, storage_path, confirmation_number, total_before_vat, vat_amount, total_with_vat, payload, tax_authority_response, created_at, updated_at, document_date")
    .eq("company_id", scope.internalCompanyId)
    .or("document_type.neq.305,tax_authority_status.eq.approved")
    .order(dateField, { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize + 1);

  if (statuses.length === 1) {
    query = query.eq("generation_status", statuses[0]);
  } else if (statuses.length > 1) {
    query = query.in("generation_status", statuses);
  }
  if (Number.isInteger(documentType)) {
    query = query.eq("document_type", documentType);
  }
  if (creatorMembershipIds.length === 1) {
    query = query.eq("created_by_membership_id", creatorMembershipIds[0]);
  } else if (creatorMembershipIds.length > 1) {
    query = query.in("created_by_membership_id", creatorMembershipIds);
  }
  if (dateFrom) {
    query = query.gte(dateField, dateFrom);
  }
  if (dateTo) {
    query = query.lte(dateField, dateTo);
  }
  if (cursor) {
    query = query.or(`${dateField}.lt.${cursor.createdAt},and(${dateField}.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  }

  const { data, error } = await query;
  if (error) {
    throw { code: "internal", httpStatus: 500, message: "Failed to load documents" };
  }
  const hasMore = (data || []).length > pageSize;
  const slicedRows = (data || []).slice(0, pageSize);
  const items = await mapDocumentRows(scope.internalCompanyId, slicedRows);

  const nextCursor = hasMore && items.length > 0
    ? makeCursor(getRowDateValue((data || [])[pageSize - 1], dateField), (data || [])[pageSize - 1]?.id)
    : null;

  return { items, nextCursor };
}

async function handleBootstrap(
  body: Record<string, unknown>,
  uid: string,
  { supabase, scope, requester, ctx }: HandlerContext,
) {
  const includeCollections = body.includeCollections === true;
  const countOnly = body.countOnly === true;

  const [
    companyResult,
    companyProfileResult,
    subscriptionResult,
    syncResult,
    membershipResult,
    userResult,
  ] = await Promise.all([
    supabase
      .from("companies")
      .select("id, public_company_id, account_type, status, created_at, updated_at")
      .eq("id", scope.internalCompanyId)
      .single(),
    supabase
      .from("company_profiles")
      .select("he_name, en_name, vat_number, business_type, city, address, business_email, business_phone, business_fax, accountant_name, accountant_email, accountant_phone, registered_at, last_updated_at")
      .eq("company_id", scope.internalCompanyId)
      .maybeSingle(),
    supabase
      .from("company_subscriptions")
      .select("tier, status, enabled_modules, expires_at, updated_at")
      .eq("company_id", scope.internalCompanyId)
      .maybeSingle(),
    supabase
      .from("company_sync_state")
      .select("jobs_version, documents_version, clients_version, workers_version, company_inventory_version, updated_at")
      .eq("company_id", scope.internalCompanyId)
      .maybeSingle(),
    supabase
      .from("company_memberships")
      .select("id, role, member_no, display_name, phone_number, created_at, updated_at")
      .eq("company_id", scope.internalCompanyId)
      .eq("user_id", uid)
      .eq("status", "active")
      .single(),
    supabase
      .from("app_users")
      .select("id, email, display_name, phone_number, system_role, created_at, updated_at")
      .eq("id", uid)
      .single(),
  ]);

  if (companyResult.error || !companyResult.data) {
    throw { code: "not-found", httpStatus: 404, message: "Company not found" };
  }
  if (membershipResult.error || !membershipResult.data) {
    throw { code: "permission-denied", httpStatus: 403, message: "Company membership not found" };
  }

  const role = String(
    userResult.data?.system_role || membershipResult.data.role || "basic",
  ).toLowerCase();

  const enabledModules = (subscriptionResult.data?.enabled_modules || {}) as Record<string, boolean>;

  const profile = {
    uid,
    email: userResult.data?.email || "",
    role,
    companyId: scope.publicCompanyId,
    wid: membershipResult.data.member_no || null,
    mid: role === "manager" ? membershipResult.data.member_no || null : null,
    name: membershipResult.data.display_name || userResult.data?.display_name || "",
    phoneNumber: membershipResult.data.phone_number || userResult.data?.phone_number || "",
    accountType: companyResult.data.account_type,
    createdAt: userResult.data?.created_at || membershipResult.data.created_at,
    updatedAt: membershipResult.data.updated_at || userResult.data?.updated_at,
  };

  const subscription = {
    tier: subscriptionResult.data?.tier || "Basic",
    status: subscriptionResult.data?.status || "active",
    expiresAt: subscriptionResult.data?.expires_at || undefined,
    enabledModules,
    updatedAt: subscriptionResult.data?.updated_at || new Date().toISOString(),
  };

  const businessInfo = {
    he_name: companyProfileResult.data?.he_name || "",
    en_name: companyProfileResult.data?.en_name || "",
    city: companyProfileResult.data?.city || "",
    address: companyProfileResult.data?.address || "",
    vat_number: companyProfileResult.data?.vat_number || "",
    business_type: companyProfileResult.data?.business_type || "",
    business_email: companyProfileResult.data?.business_email || "",
    business_phone: companyProfileResult.data?.business_phone || "",
    business_fax: companyProfileResult.data?.business_fax || "",
    accountant_name: companyProfileResult.data?.accountant_name || "",
    accountant_email: companyProfileResult.data?.accountant_email || "",
    accountant_phone: companyProfileResult.data?.accountant_phone || "",
    registered_at: companyProfileResult.data?.registered_at || "",
    last_updated: companyProfileResult.data?.last_updated_at || "",
  };

  const counts = {
    jobs: 0,
    clients: 0,
    documents: 0,
    inventoryParts: 0,
    companyInventoryParts: 0,
    workers: 0,
  };

  if (countOnly) {
    const moduleEnabled = (name: string) => Boolean(enabledModules[name]);

    if (moduleEnabled("inventory")) {
      const inventoryCounts = await getInventoryCounts(supabase, scope.internalCompanyId, String(membershipResult.data.id || ""));
      counts.inventoryParts = inventoryCounts.inventoryParts;
      counts.companyInventoryParts = inventoryCounts.companyInventoryParts;
    }

    if (moduleEnabled("jobs")) {
      let jobsCountQuery = supabase.from("jobs").select("id", { count: "exact", head: true }).eq("company_id", scope.internalCompanyId);
      if (!canReadCompanyJobs(requester)) {
        jobsCountQuery = jobsCountQuery.eq("id", NEVER_UUID);
      } else if (shouldScopeJobsToMembership(requester)) {
        jobsCountQuery = requester.membershipId
          ? jobsCountQuery.eq("assigned_membership_id", requester.membershipId)
          : jobsCountQuery.eq("id", NEVER_UUID);
      }
      const { count } = await jobsCountQuery;
      counts.jobs = Number(count || 0);
    }

    if (moduleEnabled("documents")) {
      const documentsCountQuery = canReadCompanyDocuments(requester)
        ? supabase
          .from("documents")
          .select("id", { count: "exact", head: true })
          .eq("company_id", scope.internalCompanyId)
          .or("document_type.neq.305,tax_authority_status.eq.approved")
        : supabase.from("documents").select("id", { count: "exact", head: true }).eq("id", NEVER_UUID);
      const { count } = await documentsCountQuery;
      counts.documents = Number(count || 0);
    }

    if (moduleEnabled("workers")) {
      const workersCountQuery = canReadCompanyWorkers(requester)
        ? supabase.from("company_memberships").select("id", { count: "exact", head: true }).eq("company_id", scope.internalCompanyId).eq("status", "active").in("role", ["worker", "user", "basic"])
        : supabase.from("company_memberships").select("id", { count: "exact", head: true }).eq("id", NEVER_UUID);
      const { count } = await workersCountQuery;
      counts.workers = Number(count || 0);
    }

    if (moduleEnabled("clients")) {
      const { count: clientsCount } = await supabase.from("clients").select("id", { count: "exact", head: true }).eq("company_id", scope.internalCompanyId);
      counts.clients = Number(clientsCount || 0);
    }

    return {
      profile,
      subscription,
      businessInfo,
      inventory: emptyInventoryPayload(),
      companyInventory: emptyInventoryPayload(),
      workers: [],
      clients: [],
      clientsNextCursor: null,
      jobs: [],
      documents: [],
      jobsNextCursor: null,
      documentsNextCursor: null,
      counts,
      syncState: {
        jobsVersion: Number(syncResult.data?.jobs_version || 0),
        documentsVersion: Number(syncResult.data?.documents_version || 0),
        clientsVersion: Number(syncResult.data?.clients_version || 0),
        workersVersion: Number(syncResult.data?.workers_version || 0),
        companyInventoryVersion: Number(syncResult.data?.company_inventory_version || 0),
        updatedAt: syncResult.data?.updated_at || new Date().toISOString(),
      },
    };
  }

  let userInventory = emptyInventoryPayload();
  let companyInventory = emptyInventoryPayload();

  let workers: any[] = [];
  let clients: any[] = [];
  let clientsNextCursor: string | null = null;
  let jobs: any[] = [];
  let documents: any[] = [];
  let jobsNextCursor: string | null = null;
  let documentsNextCursor: string | null = null;

  if (includeCollections) {
    const moduleEnabled = (name: string) => Boolean(enabledModules[name]);
    const handlerCtx: HandlerContext = { supabase, scope, requester, ctx };

    if (moduleEnabled("inventory")) {
      const [userInventoryResult, companyInventoryResult] = await Promise.all([
        getUserInventoryParts(scope.internalCompanyId, uid),
        getCompanyInventoryParts(scope.internalCompanyId),
      ]);
      userInventory = userInventoryResult;
      companyInventory = companyInventoryResult;
      counts.inventoryParts = userInventory.parts.length;
      counts.companyInventoryParts = companyInventory.parts.length;
    }

    const collectionPromises: Promise<any>[] = [];
    if (moduleEnabled("workers")) {
      collectionPromises.push(
        handleWorkers({ kind: "workers", companyId: scope.publicCompanyId }, uid, handlerCtx)
          .then((result) => { workers = result; counts.workers = workers.length; }),
      );
    }
    if (moduleEnabled("clients")) {
      collectionPromises.push(
        handleClients({ kind: "clients", companyId: scope.publicCompanyId, pageSize: 50 }, uid, handlerCtx)
          .then((result) => {
            clients = Array.isArray(result) ? result : (result.items || []);
            clientsNextCursor = Array.isArray(result) ? null : (result.nextCursor || null);
            counts.clients = clients.length;
          }),
      );
    }
    if (moduleEnabled("jobs")) {
      collectionPromises.push(
        handleJobs({ kind: "jobs", companyId: scope.publicCompanyId, pageSize: 50 }, uid, handlerCtx)
          .then((result) => { jobs = result.items || []; jobsNextCursor = result.nextCursor || null; counts.jobs = jobs.length; }),
      );
    }
    if (moduleEnabled("documents")) {
      collectionPromises.push(
        handleDocuments({ kind: "documents", companyId: scope.publicCompanyId, pageSize: 50 }, uid, handlerCtx)
          .then((result) => { documents = result.items || []; documentsNextCursor = result.nextCursor || null; counts.documents = documents.length; }),
      );
    }

    await Promise.all(collectionPromises);
  }

  return {
    profile,
    subscription,
    businessInfo,
    inventory: userInventory,
    companyInventory,
    workers,
    clients,
    clientsNextCursor,
    jobs,
    documents,
    jobsNextCursor,
    documentsNextCursor,
    counts,
    syncState: {
      jobsVersion: Number(syncResult.data?.jobs_version || 0),
      documentsVersion: Number(syncResult.data?.documents_version || 0),
      clientsVersion: Number(syncResult.data?.clients_version || 0),
      workersVersion: Number(syncResult.data?.workers_version || 0),
      companyInventoryVersion: Number(syncResult.data?.company_inventory_version || 0),
      updatedAt: syncResult.data?.updated_at || new Date().toISOString(),
    },
  };
}

async function buildReadModelResponse(
  body: Record<string, unknown>,
  uid: string,
  preloaded: {
    supabase?: ReturnType<typeof createSupabaseClient>;
    scope?: CompanyScope;
    requester?: RequesterContext;
  } = {},
): Promise<any> {
  const kind = optionalTrimmedString(body.kind, 64);
  if (!kind || !READ_MODEL_KINDS.has(kind)) {
    throw {
      code: "invalid-argument",
      httpStatus: 400,
      message: "Unsupported read-model kind",
    };
  }

  const supabase = preloaded.supabase || createSupabaseClient(env);

  if (kind === "userSyncState") {
    const { data: userRow } = await supabase
      .from("app_users")
      .select("updated_at")
      .eq("id", uid)
      .maybeSingle();
    return {
      profile: 0,
      inventory: 0,
      subscription: 0,
      updatedAt: userRow?.updated_at || new Date().toISOString(),
    };
  }

  let scope: CompanyScope;
  if (preloaded.scope) {
    scope = preloaded.scope;
  } else {
    scope = await resolveCompanyScope(uid, body.companyId);
    await assertCompanyAccess(uid, scope.publicCompanyId, [], buildReadModelContext(uid));
  }
  const requester = preloaded.requester || await getRequesterContext(scope, uid);
  const ctx = buildReadModelContext(uid);
  const handlerCtx: HandlerContext = { supabase, scope, requester, ctx };

  switch (kind) {
    case "companySyncState":
      return handleCompanySyncState(body, uid, handlerCtx);
    case "workers":
      return handleWorkers(body, uid, handlerCtx);
    case "clients":
      return handleClients(body, uid, handlerCtx);
    case "inventory":
      return handleInventory(body, uid, handlerCtx);
    case "documentTask":
      return handleDocumentTask(body, uid, handlerCtx);
    case "recordById":
      return handleRecordById(body, uid, handlerCtx);
    case "jobs":
      return handleJobs(body, uid, handlerCtx);
    case "documents":
      return handleDocuments(body, uid, handlerCtx);
    case "bootstrap":
      return handleBootstrap(body, uid, handlerCtx);
    default:
      throw {
        code: "invalid-argument",
        httpStatus: 400,
        message: "Unsupported read-model kind",
      };
  }
}

async function handleReadModelRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    const ctx = await createEdgeFunctionContext(req, env);
    return handleOptions(ctx.corsHeaders);
  }

  if (req.method !== "POST") {
    const ctx = await createEdgeFunctionContext(req, env);
    return buildHttpResponse(
      405,
      {
        ok: false,
        error: {
          code: "invalid-argument",
          message: "Only POST is allowed",
        },
      },
      ctx.corsHeaders,
    );
  }

  try {
    const ctx = await createEdgeFunctionContext(req, env);
    if (!ctx.auth?.uid) {
      throw {
        code: "unauthenticated",
        httpStatus: 401,
        message: "Authentication required",
      };
    }

    const body = await parseJsonBody(req);
    const data = await buildReadModelResponse(body || {}, ctx.auth.uid);

    return buildHttpResponse(
      200,
      buildSuccessResponse(data),
      ctx.corsHeaders,
    );
  } catch (error) {
    let corsHeaders: Record<string, string> = {};
    try {
      const errCtx = await createEdgeFunctionContext(req, env);
      corsHeaders = errCtx.corsHeaders;
    } catch {
      // createEdgeFunctionContext itself failed; proceed with empty corsHeaders
    }
    return handleHttpError(error, corsHeaders);
  }
}

export default handleReadModelRequest;
export const handler = handleReadModelRequest;

const readModelServe = (globalThis as { Deno?: { serve?: (handler: (req: Request) => Response | Promise<Response>) => unknown } }).Deno?.serve;
if (typeof readModelServe === "function") {
  readModelServe(handleReadModelRequest);
}
