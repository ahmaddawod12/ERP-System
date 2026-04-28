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
  createSupabaseClient,
  resolveCompanyIdentifiers,
  optionalTrimmedString,
} from "../../shared-edge-helpers.ts";

const env = getEnv();
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

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

type CompanyScope = {
  internalCompanyId: string;
  publicCompanyId: string;
};

function normalizeIsoString(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) return null;
  return new Date(ts).toISOString();
}

function parsePageSize(raw: unknown): number {
  const value = Number(raw || DEFAULT_PAGE_SIZE);
  if (!Number.isFinite(value)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(value)));
}

async function resolveCompanyScope(
  uid: string,
  requestedCompanyId: unknown,
): Promise<CompanyScope> {
  const requested = optionalTrimmedString(requestedCompanyId, 64);
  if (requested) {
    const companyId = validateCompanyId(requested);
    await assertCompanyAccess(uid, companyId, [], {
      correlationId: "read-model",
      logger: console as any,
      auth: { uid, claims: {} },
      env,
      corsHeaders: {},
    } as any);
    return resolveCompanyIdentifiers(companyId, env);
  }

  const supabase = createSupabaseClient(env);
  const { data: memberships, error } = await supabase
    .from("company_memberships")
    .select("company_id, joined_at, created_at")
    .eq("user_id", uid)
    .eq("status", "active")
    .order("joined_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(2);

  if (error || !memberships || memberships.length === 0 || !memberships[0]?.company_id) {
    throw {
      code: "failed-precondition",
      httpStatus: 400,
      message: "companyId is required for this request",
    };
  }

  if (memberships.length > 1) {
    throw {
      code: "failed-precondition",
      httpStatus: 400,
      message: "companyId is required when user belongs to multiple companies",
    };
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, public_company_id")
    .eq("id", memberships[0].company_id)
    .single();

  if (companyError || !company?.id) {
    throw {
      code: "not-found",
      httpStatus: 404,
      message: "Company not found",
    };
  }

  return {
    internalCompanyId: String(company.id),
    publicCompanyId: String(company.public_company_id || ""),
  };
}

async function getRequesterRoleContext(internalCompanyId: string, uid: string) {
  const supabase = createSupabaseClient(env);
  const [{ data: userRow, error: userError }, { data: membership, error: membershipError }] = await Promise.all([
    supabase
      .from("app_users")
      .select("system_role")
      .eq("id", uid)
      .maybeSingle(),
    supabase
      .from("company_memberships")
      .select("role")
      .eq("company_id", internalCompanyId)
      .eq("user_id", uid)
      .eq("status", "active")
      .maybeSingle(),
  ]);

  if (userError) {
    throw { code: "internal", httpStatus: 500, message: "Failed to load requester role" };
  }
  if (membershipError || !membership) {
    throw { code: "permission-denied", httpStatus: 403, message: "Not allowed for this company" };
  }

  return {
    role: String(membership.role || "").toLowerCase(),
    isDev: String(userRow?.system_role || "").toLowerCase() === "dev",
  };
}

async function getCompanyInventoryParts(internalCompanyId: string) {
  const supabase = createSupabaseClient(env);
  const { data: location, error: locationError } = await supabase
    .from("inventory_locations")
    .select("id")
    .eq("company_id", internalCompanyId)
    .eq("location_type", "company")
    .is("membership_id", null)
    .maybeSingle();

  if (locationError) {
    throw { code: "internal", httpStatus: 500, message: "Failed to load company inventory location" };
  }

  if (!location?.id) {
    return { parts: [], nextId: 1, lastUpdated: new Date().toISOString() };
  }

  const [{ data: parts, error: partsError }, { data: balances, error: balancesError }, { data: counterRow }] = await Promise.all([
    supabase
      .from("inventory_parts")
      .select("id, part_no, name, active, low_threshold, created_at")
      .eq("company_id", internalCompanyId)
      .order("part_no", { ascending: true }),
    supabase
      .from("inventory_balances")
      .select("part_id, quantity_on_hand, updated_at")
      .eq("location_id", location.id),
    supabase
      .from("company_counters")
      .select("next_value")
      .eq("company_id", internalCompanyId)
      .eq("counter_key", "part_no")
      .maybeSingle(),
  ]);

  if (partsError || balancesError) {
    throw { code: "internal", httpStatus: 500, message: "Failed to load company inventory" };
  }

  const balancesByPartId = new Map<string, any>();
  for (const row of balances || []) {
    balancesByPartId.set(String(row.part_id), row);
  }

  const normalizedParts = (parts || []).map((part: any) => {
    const balance = balancesByPartId.get(String(part.id));
    return {
      id: Number(part.part_no || 0),
      name: String(part.name || ""),
      active: Boolean(part.active),
      quantity: Number(balance?.quantity_on_hand || 0),
      lowThreshold: Number(part.low_threshold || 0),
      dateAdded: part.created_at || null,
    };
  });

  const maxId = normalizedParts.reduce((acc, item) => Math.max(acc, Number(item.id || 0)), 0);
  const nextId = counterRow ? Number(counterRow.next_value) : maxId + 1;
  return {
    parts: normalizedParts,
    nextId,
    lastUpdated: new Date().toISOString(),
  };
}

async function getUserInventoryParts(internalCompanyId: string, targetUid: string) {
  const supabase = createSupabaseClient(env);
  const { data: membership, error: membershipError } = await supabase
    .from("company_memberships")
    .select("id")
    .eq("company_id", internalCompanyId)
    .eq("user_id", targetUid)
    .eq("status", "active")
    .maybeSingle();

  if (membershipError) {
    throw { code: "internal", httpStatus: 500, message: "Failed to load member inventory access" };
  }

  if (!membership?.id) {
    return { parts: [], nextId: 1, lastUpdated: new Date().toISOString() };
  }

  const { data: location, error: locationError } = await supabase
    .from("inventory_locations")
    .select("id")
    .eq("company_id", internalCompanyId)
    .eq("location_type", "member")
    .eq("membership_id", membership.id)
    .maybeSingle();

  if (locationError) {
    throw { code: "internal", httpStatus: 500, message: "Failed to load member inventory location" };
  }

  if (!location?.id) {
    return { parts: [], nextId: 1, lastUpdated: new Date().toISOString() };
  }

  const [{ data: balances, error: balancesError }, { data: parts, error: partsError }, { data: userCounterRow }] = await Promise.all([
    supabase
      .from("inventory_balances")
      .select("part_id, quantity_on_hand, updated_at")
      .eq("location_id", location.id),
    supabase
      .from("inventory_parts")
      .select("id, part_no, name, low_threshold, created_at")
      .eq("company_id", internalCompanyId),
    supabase
      .from("company_counters")
      .select("next_value")
      .eq("company_id", internalCompanyId)
      .eq("counter_key", "part_no")
      .maybeSingle(),
  ]);

  if (balancesError || partsError) {
    throw { code: "internal", httpStatus: 500, message: "Failed to load member inventory" };
  }

  const partById = new Map<string, any>();
  for (const part of parts || []) {
    partById.set(String(part.id), part);
  }

  const normalizedParts = (balances || []).map((balance: any) => {
    const part = partById.get(String(balance.part_id));
    return {
      id: Number(part?.part_no || 0),
      name: String(part?.name || ""),
      quantity: Number(balance.quantity_on_hand || 0),
      lowThreshold: Number(part?.low_threshold || 0),
      dateAdded: part?.created_at || null,
    };
  });

  const maxId = normalizedParts.reduce((acc, item) => Math.max(acc, Number(item.id || 0)), 0);
  const nextId = userCounterRow ? Number(userCounterRow.next_value) : maxId + 1;
  return {
    parts: normalizedParts,
    nextId,
    lastUpdated: new Date().toISOString(),
  };
}

function makeCursor(createdAt: unknown, id: unknown): string {
  return `${String(createdAt || "")}|${String(id || "")}`;
}

function parseCursor(cursorRaw: unknown): { createdAt: string; id: string } | null {
  const raw = String(cursorRaw || "").trim();
  if (!raw || !raw.includes("|")) return null;
  const [createdAt, id] = raw.split("|");
  if (!createdAt || !id) return null;
  return { createdAt, id };
}

async function buildReadModelResponse(body: Record<string, unknown>, uid: string) {
  const kind = optionalTrimmedString(body.kind, 64);
  if (!kind || !READ_MODEL_KINDS.has(kind)) {
    throw {
      code: "invalid-argument",
      httpStatus: 400,
      message: "Unsupported read-model kind",
    };
  }

  const supabase = createSupabaseClient(env);

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

  const scope = await resolveCompanyScope(uid, body.companyId);
  await assertCompanyAccess(uid, scope.publicCompanyId, [], {
    correlationId: "read-model",
    logger: console as any,
    auth: { uid, claims: {} },
    env,
    corsHeaders: {},
  } as any);

  if (kind === "companySyncState") {
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

  if (kind === "workers") {
    const { data } = await supabase
      .from("company_memberships")
      .select("id, user_id, member_no, role, display_name, phone_number, created_at, updated_at, app_users(email)")
      .eq("company_id", scope.internalCompanyId)
      .eq("status", "active")
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

  if (kind === "clients") {
    const { data } = await supabase
      .from("clients")
      .select("id, client_no, name, email, phone, address, notes, city, vat_number, created_at, updated_at")
      .eq("company_id", scope.internalCompanyId)
      .order("client_no", { ascending: false });

    return (data || []).map((row: any) => ({
      id: row.id,
      numericId: row.client_no,
      name: row.name,
      email: row.email || "",
      phone: row.phone || "",
      address: row.address || "",
      notes: row.notes || "",
      city: row.city || "",
      vatNumber: row.vat_number || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  if (kind === "inventory") {
    const scopeKind = optionalTrimmedString(body.scope, 16) || "company";
    if (scopeKind === "user") {
      const targetUid = optionalTrimmedString(body.targetUid, 200) || uid;
      if (targetUid !== uid) {
        const requester = await getRequesterRoleContext(scope.internalCompanyId, uid);
        if (!requester.isDev && requester.role !== "manager") {
          throw {
            code: "permission-denied",
            httpStatus: 403,
            message: "Only managers can read another member inventory",
          };
        }
      }
      return getUserInventoryParts(scope.internalCompanyId, targetUid);
    }
    return getCompanyInventoryParts(scope.internalCompanyId);
  }

  if (kind === "documentTask") {
    const taskId = optionalTrimmedString(body.taskId, 160);
    if (!taskId) {
      throw { code: "invalid-argument", httpStatus: 400, message: "taskId is required" };
    }

    const { data: task } = await supabase
      .from("document_tasks")
      .select("id, company_id, user_id, task_type, status, preview_url, generate_url, request_payload, storage_path, pdf_size, error, document_id")
      .eq("task_key", taskId)
      .maybeSingle();

    if (!task) return null;
    if (String(task.user_id) !== uid && String(task.company_id) !== scope.internalCompanyId) {
      throw { code: "permission-denied", httpStatus: 403, message: "Not allowed to read this task" };
    }

    return {
      status: task.status,
      taskType: task.task_type,
      previewURL: task.preview_url || null,
      downloadURL: task.generate_url || null,
      documentId: task.document_id || null,
      pdfSize: task.pdf_size || null,
      storagePath: task.storage_path || null,
      error: task.error || null,
      requestPayload: task.request_payload || {},
    };
  }

  if (kind === "recordById") {
    const recordId = optionalTrimmedString(body.recordId, 160);
    if (!recordId) {
      throw { code: "invalid-argument", httpStatus: 400, message: "recordId is required" };
    }

    const [{ data: job }, { data: document }] = await Promise.all([
      supabase
        .from("jobs")
        .select("id, status, title, description, location, client_name_snapshot, client_phone_snapshot, created_at, updated_at")
        .eq("company_id", scope.internalCompanyId)
        .eq("id", recordId)
        .maybeSingle(),
      supabase
        .from("documents")
        .select("id, document_type, document_number, document_code, client_name_snapshot, client_phone_snapshot, created_at, storage_path")
        .eq("company_id", scope.internalCompanyId)
        .eq("id", recordId)
        .maybeSingle(),
    ]);

    if (job) {
      return {
        id: job.id,
        status: job.status,
        title: job.title,
        description: job.description,
        location: job.location,
        cname: job.client_name_snapshot,
        cphone: job.client_phone_snapshot,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
      };
    }

    if (document) {
      return {
        id: document.id,
        type: document.document_type,
        documentType: document.document_type,
        documentNumber: document.document_number,
        documentId: document.document_code,
        cname: document.client_name_snapshot,
        cphone: document.client_phone_snapshot,
        createdAt: document.created_at,
        storagePath: document.storage_path,
      };
    }

    return null;
  }

  if (kind === "jobs") {
    const pageSize = parsePageSize(body.pageSize || body.limit);
    const cursor = parseCursor(body.afterCursor);
    let query = supabase
      .from("jobs")
      .select("id, job_no, status, title, description, notes, location, address, category, priority, due_at, client_id, client_name_snapshot, client_phone_snapshot, assigned_membership_id, assigned_member_name_snapshot, created_by_membership_id, created_by_name_snapshot, is_cert, created_at, updated_at, finished_at, denied_at")
      .eq("company_id", scope.internalCompanyId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(pageSize + 1);

    if (cursor) {
      query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
    }

    const { data, error } = await query;
    if (error) {
      throw { code: "internal", httpStatus: 500, message: "Failed to load jobs" };
    }
    const hasMore = (data || []).length > pageSize;
    const items = (data || []).slice(0, pageSize).map((job: any) => ({
      id: String(job.id),
      jobId: String(job.id),
      jobNo: Number(job.job_no || 0),
      status: String(job.status || "pending"),
      title: job.title || "",
      description: job.description || "",
      notes: job.notes || "",
      location: job.location || "",
      address: job.address || "",
      category: job.category || "",
      priority: job.priority || "",
      dueAt: job.due_at || null,
      cid: job.client_id || null,
      cname: job.client_name_snapshot || null,
      cphone: job.client_phone_snapshot || null,
      wid: job.assigned_membership_id || null,
      wname: job.assigned_member_name_snapshot || null,
      mid: job.created_by_membership_id || null,
      mname: job.created_by_name_snapshot || null,
      isCert: Boolean(job.is_cert),
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      finishedAt: job.finished_at || null,
      deniedAt: job.denied_at || null,
    }));

    const nextCursor = hasMore && items.length > 0
      ? makeCursor(items[items.length - 1].createdAt, items[items.length - 1].id)
      : null;

    return { items, nextCursor };
  }

  if (kind === "documents") {
    const pageSize = parsePageSize(body.pageSize || body.limit);
    const cursor = parseCursor(body.afterCursor);

    let query = supabase
      .from("documents")
      .select("id, document_type, document_number, document_code, client_id, client_name_snapshot, client_phone_snapshot, client_city_snapshot, client_vat_snapshot, language, notes, storage_path, confirmation_number, total_before_vat, vat_amount, total_with_vat, payload, created_at")
      .eq("company_id", scope.internalCompanyId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(pageSize + 1);

    if (cursor) {
      query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
    }

    const { data, error } = await query;
    if (error) {
      throw { code: "internal", httpStatus: 500, message: "Failed to load documents" };
    }
    const hasMore = (data || []).length > pageSize;
    const items = (data || []).slice(0, pageSize).map((doc: any) => ({
      id: String(doc.id),
      type: doc.document_type,
      documentType: doc.document_type,
      documentNumber: doc.document_number,
      documentId: doc.document_code,
      clientId: doc.client_id || null,
      cname: doc.client_name_snapshot || "",
      cphone: doc.client_phone_snapshot || "",
      clientCity: doc.client_city_snapshot || "",
      clientVatNumber: doc.client_vat_snapshot || "",
      language: doc.language || "he",
      notes: doc.notes || "",
      storagePath: doc.storage_path || null,
      confirmationNumber: doc.confirmation_number || null,
      totalBeforeVat: Number(doc.total_before_vat || 0),
      vatAmount: Number(doc.vat_amount || 0),
      totalWithVat: Number(doc.total_with_vat || 0),
      documentData: doc.payload || {},
      createdAt: doc.created_at,
    }));

    const nextCursor = hasMore && items.length > 0
      ? makeCursor(items[items.length - 1].createdAt, items[items.length - 1].id)
      : null;

    return { items, nextCursor };
  }

  // bootstrap
  const includeCollections = body.includeCollections === true;

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

  const userInventory = await getUserInventoryParts(scope.internalCompanyId, uid);
  const companyInventory = await getCompanyInventoryParts(scope.internalCompanyId);

  let workers: any[] = [];
  let clients: any[] = [];
  let jobs: any[] = [];
  let documents: any[] = [];

  if (includeCollections) {
    workers = await buildReadModelResponse({ kind: "workers", companyId: scope.publicCompanyId }, uid);
    clients = await buildReadModelResponse({ kind: "clients", companyId: scope.publicCompanyId }, uid);
    const jobsResult = await buildReadModelResponse({ kind: "jobs", companyId: scope.publicCompanyId, pageSize: 200 }, uid);
    const docsResult = await buildReadModelResponse({ kind: "documents", companyId: scope.publicCompanyId, pageSize: 200 }, uid);
    jobs = jobsResult.items || [];
    documents = docsResult.items || [];
  }

  return {
    profile,
    subscription,
    businessInfo,
    inventory: userInventory,
    companyInventory,
    workers,
    clients,
    jobs,
    documents,
    jobsNextCursor: null,
    documentsNextCursor: null,
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
