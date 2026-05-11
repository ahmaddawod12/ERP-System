import {
  assertCompanyAccess,
  createSupabaseClient,
  getEnv,
  optionalTrimmedString,
  resolveCompanyIdentifiers,
  validateCompanyId,
} from "../../../shared-edge-helpers.ts";
import type { CompanyScope, RequesterContext } from "../types.ts";

const env = getEnv();

function normalizeJobMeta(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === "object" && !Array.isArray(meta)
    ? { ...(meta as Record<string, unknown>) }
    : {};
}

export async function getMembershipMap(internalCompanyId: string, membershipIds: string[]) {
  const normalizedIds = Array.from(new Set((membershipIds || []).map((value) => String(value || "").trim()).filter(Boolean)));
  if (normalizedIds.length === 0) {
    return new Map<string, { memberNo: number | null; displayName: string | null }>();
  }

  const supabase = createSupabaseClient(env);
  const { data, error } = await supabase
    .from("company_memberships")
    .select("id, member_no, display_name")
    .eq("company_id", internalCompanyId)
    .in("id", normalizedIds);

  if (error) {
    throw { code: "internal", httpStatus: 500, message: "Failed to load membership mapping" };
  }

  const map = new Map<string, { memberNo: number | null; displayName: string | null }>();
  for (const row of data || []) {
    map.set(String(row.id), {
      memberNo: row.member_no == null ? null : Number(row.member_no),
      displayName: row.display_name || null,
    });
  }
  return map;
}

export async function getMembershipIdsForUser(internalCompanyId: string, uid: string): Promise<string[]> {
  const normalizedUid = String(uid || "").trim();
  if (!normalizedUid) return [];

  const supabase = createSupabaseClient(env);
  const { data, error } = await supabase
    .from("company_memberships")
    .select("id")
    .eq("company_id", internalCompanyId)
    .eq("user_id", normalizedUid)
    .eq("status", "active");

  if (error) {
    throw { code: "internal", httpStatus: 500, message: "Failed to resolve creator membership" };
  }

  return (data || [])
    .map((row: any) => String(row.id || "").trim())
    .filter(Boolean);
}

export async function getJobAttachments(jobIds: string[]) {
  const normalizedJobIds = Array.from(new Set((jobIds || []).map((value) => String(value || "").trim()).filter(Boolean)));
  if (normalizedJobIds.length === 0) {
    return new Map<string, Array<{ storagePath: string; kind: string }>>();
  }

  const supabase = createSupabaseClient(env);
  const { data, error } = await supabase
    .from("job_attachments")
    .select("job_id, storage_path, kind")
    .in("job_id", normalizedJobIds);

  if (error) {
    throw { code: "internal", httpStatus: 500, message: "Failed to load job attachments" };
  }

  const map = new Map<string, Array<{ storagePath: string; kind: string }>>();
  for (const row of data || []) {
    const jobId = String(row.job_id || "");
    if (!jobId) continue;
    const next = map.get(jobId) || [];
    next.push({
      storagePath: String(row.storage_path || ""),
      kind: String(row.kind || ""),
    });
    map.set(jobId, next);
  }
  return map;
}

export async function getJobPartUsageMap(jobIds: string[]) {
  const normalizedJobIds = Array.from(new Set((jobIds || []).map((value) => String(value || "").trim()).filter(Boolean)));
  if (normalizedJobIds.length === 0) {
    return new Map<string, Array<{ id: string | null; name: string; quantity: number }>>();
  }

  const supabase = createSupabaseClient(env);
  const { data, error } = await supabase
    .from("job_part_usages")
    .select("job_id, inventory_part_id, part_name_snapshot, quantity")
    .in("job_id", normalizedJobIds);

  if (error) {
    throw { code: "internal", httpStatus: 500, message: "Failed to load job parts" };
  }

  const partIds = Array.from(new Set((data || [])
    .map((row: any) => String(row.inventory_part_id || "").trim())
    .filter(Boolean)));
  const partNoById = new Map<string, number>();
  if (partIds.length > 0) {
    const { data: partRows, error: partRowsError } = await supabase
      .from("inventory_parts")
      .select("id, part_no")
      .in("id", partIds);
    if (partRowsError) {
      throw { code: "internal", httpStatus: 500, message: "Failed to load inventory part numbers" };
    }
    for (const row of partRows || []) {
      if (row?.id && row?.part_no != null) {
        partNoById.set(String(row.id), Number(row.part_no));
      }
    }
  }

  const map = new Map<string, Array<{ id: string | null; name: string; quantity: number }>>();
  for (const row of data || []) {
    const jobId = String(row.job_id || "");
    if (!jobId) continue;
    const next = map.get(jobId) || [];
    const partId = row.inventory_part_id ? String(row.inventory_part_id) : "";
    const publicPartNo = partId ? partNoById.get(partId) : undefined;
    next.push({
      id: publicPartNo != null ? String(publicPartNo) : (row.part_name_snapshot ? String(row.part_name_snapshot) : null),
      name: String(row.part_name_snapshot || ""),
      quantity: Number(row.quantity || 0),
    });
    map.set(jobId, next);
  }
  return map;
}

export function mapJobRecord(
  job: any,
  membershipMap: Map<string, { memberNo: number | null; displayName: string | null }>,
  attachmentsByJobId: Map<string, Array<{ storagePath: string; kind: string }>>,
  partsByJobId: Map<string, Array<{ id: string | null; name: string; quantity: number }>>,
) {
  const jobId = String(job.id || "");
  const meta = normalizeJobMeta(job.meta);
  const assignee = membershipMap.get(String(job.assigned_membership_id || ""));
  const creator = membershipMap.get(String(job.created_by_membership_id || ""));
  const attachments = attachmentsByJobId.get(jobId) || [];
  const photos = attachments
    .filter((attachment) => attachment.kind === "photo")
    .map((attachment) => ({ storagePath: attachment.storagePath }))
    .filter((attachment) => Boolean(attachment.storagePath));
  const signature = attachments.find((attachment) => attachment.kind === "signature");
  const partsUsed = partsByJobId.get(jobId) || [];

  return {
    id: String(job.job_no || job.id),
    jobId: String(job.job_no || job.id),
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
    dueDate: job.due_at || null,
    cid: job.client_id || null,
    cname: job.client_name_snapshot || null,
    cphone: job.client_phone_snapshot || null,
    wid: assignee?.memberNo != null ? String(assignee.memberNo) : null,
    wname: assignee?.displayName || job.assigned_member_name_snapshot || null,
    mid: creator?.memberNo != null ? String(creator.memberNo) : null,
    mname: creator?.displayName || job.created_by_name_snapshot || null,
    isCert: Boolean(job.is_cert),
    timeFrom: typeof meta.timeFrom === "string" ? meta.timeFrom : null,
    timeTo: typeof meta.timeTo === "string" ? meta.timeTo : null,
    travelDistance: meta.travelDistance == null ? null : Number(meta.travelDistance),
    signingPerson: typeof meta.signingPerson === "string" ? meta.signingPerson : null,
    photos,
    signature: signature?.storagePath ? { storagePath: signature.storagePath } : null,
    partsUsed,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    finishedAt: job.finished_at || null,
    deniedAt: job.denied_at || null,
  };
}

export async function resolveCompanyScope(
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

export async function getRequesterContext(scope: CompanyScope, uid: string): Promise<RequesterContext> {
  const supabase = createSupabaseClient(env);
  const [
    { data: userRow, error: userError },
    { data: membership, error: membershipError },
    { data: company, error: companyError },
  ] = await Promise.all([
    supabase
      .from("app_users")
      .select("system_role")
      .eq("id", uid)
      .maybeSingle(),
    supabase
      .from("company_memberships")
      .select("id, role, member_no")
      .eq("company_id", scope.internalCompanyId)
      .eq("user_id", uid)
      .eq("status", "active")
      .maybeSingle(),
    supabase
      .from("companies")
      .select("account_type")
      .eq("id", scope.internalCompanyId)
      .maybeSingle(),
  ]);

  if (userError || companyError) {
    throw { code: "internal", httpStatus: 500, message: "Failed to load requester context" };
  }
  const isDev = String(userRow?.system_role || "").toLowerCase() === "dev";
  if (membershipError || (!membership && !isDev)) {
    throw { code: "permission-denied", httpStatus: 403, message: "Not allowed for this company" };
  }

  return {
    role: isDev ? "dev" : String(membership?.role || "").toLowerCase(),
    membershipId: membership?.id ? String(membership.id) : null,
    memberNo: membership?.member_no == null ? null : Number(membership.member_no),
    accountType: String(company?.account_type || "").toLowerCase(),
    isDev,
  };
}

export async function getCompanyInventoryParts(internalCompanyId: string) {
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

  const nextId = counterRow ? Number(counterRow.next_value) : 1;
  return {
    parts: normalizedParts,
    nextId,
    lastUpdated: new Date().toISOString(),
  };
}

export async function getUserInventoryParts(internalCompanyId: string, targetUid: string) {
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

  const nextId = userCounterRow ? Number(userCounterRow.next_value) : 1;
  return {
    parts: normalizedParts,
    nextId,
    lastUpdated: new Date().toISOString(),
  };
}
