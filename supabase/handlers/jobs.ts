/**
 * Jobs Handler Module
 * Phase: 2 | Status: Implemented
 */
import {
  allocateNextCompanyCounter,
  EdgeFunctionContext,
  createSupabaseClient,
  optionalTrimmedString,
  requireNonEmptyString,
  resolveCompanyIdentifiers,
  validateCompanyId,
} from "../shared-edge-helpers.ts";

const VALID_STATUSES = ["pending", "waiting", "finished", "denied"];

type MembershipContext = {
  id: string;
  role: string;
  memberNo: number;
  displayName: string | null;
};

type JobAttachmentRef = {
  storagePath: string;
};

type NormalizedJobAttachmentPayload = {
  photos?: JobAttachmentRef[];
  signature?: JobAttachmentRef | null;
};

function parseDateOrNull(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const raw = String(value).trim();
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) {
    throw { code: "invalid-argument", message: `${fieldName} must be a valid ISO date`, httpStatus: 400 };
  }
  return new Date(ts).toISOString();
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeAttachmentRef(value: unknown): JobAttachmentRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const storagePath = optionalTrimmedString((value as { storagePath?: unknown }).storagePath, 1024);
  if (!storagePath) return null;
  return { storagePath };
}

function normalizeAttachmentPayload(payload: any): NormalizedJobAttachmentPayload {
  const photos = Array.isArray(payload?.photos)
    ? payload.photos.map(normalizeAttachmentRef).filter((value: JobAttachmentRef | null): value is JobAttachmentRef => Boolean(value))
    : undefined;
  const signature = payload?.signature === null
    ? null
    : normalizeAttachmentRef(payload?.signature);
  return {
    ...(photos !== undefined ? { photos } : {}),
    ...(payload && Object.prototype.hasOwnProperty.call(payload, "signature") ? { signature } : {}),
  };
}

function buildJobMetaPatch(payload: any, existingMeta: Record<string, unknown> | null | undefined = {}) {
  const meta: Record<string, unknown> = existingMeta && typeof existingMeta === "object" && !Array.isArray(existingMeta)
    ? { ...existingMeta }
    : {};

  if (Object.prototype.hasOwnProperty.call(payload, "timeFrom")) meta.timeFrom = optionalTrimmedString(payload?.timeFrom, 20) || null;
  if (Object.prototype.hasOwnProperty.call(payload, "timeTo")) meta.timeTo = optionalTrimmedString(payload?.timeTo, 20) || null;
  if (Object.prototype.hasOwnProperty.call(payload, "travelDistance")) {
    if (payload?.travelDistance === null || payload?.travelDistance === undefined || payload?.travelDistance === "") {
      meta.travelDistance = null;
    } else {
      const numeric = Number(payload.travelDistance);
      if (!Number.isFinite(numeric) || numeric < 0) {
        throw { code: "invalid-argument", message: "travelDistance must be a non-negative number", httpStatus: 400 };
      }
      meta.travelDistance = numeric;
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, "signingPerson")) meta.signingPerson = optionalTrimmedString(payload?.signingPerson, 240) || null;
  if (Object.prototype.hasOwnProperty.call(payload, "partsUsed")) meta.partsUsed = Array.isArray(payload?.partsUsed) ? payload.partsUsed : [];

  return meta;
}

function normalizeParts(parts: unknown): Array<{ partId?: string; partName?: string; qty: number }> {
  if (!Array.isArray(parts)) return [];
  return parts.map((part, index) => {
    const qty = Number((part as any)?.qty ?? (part as any)?.quantity ?? 0);
    if (!Number.isFinite(qty) || qty < 0) {
      throw { code: "invalid-argument", message: `parts[${index}].qty must be non-negative`, httpStatus: 400 };
    }
    const partId = optionalTrimmedString((part as any)?.partId, 128);
    const partName = optionalTrimmedString((part as any)?.partName, 240);
    return { partId: partId || undefined, partName: partName || undefined, qty };
  });
}

function normalizePartsUsed(parts: unknown): Array<{ partId?: string; partName?: string; qty: number }> {
  if (!Array.isArray(parts)) return [];
  return parts.map((part, index) => {
    const quantity = Number((part as any)?.quantity ?? (part as any)?.qty ?? 0);
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw { code: "invalid-argument", message: `partsUsed[${index}].quantity must be non-negative`, httpStatus: 400 };
    }
    const partId = optionalTrimmedString((part as any)?.partId ?? (part as any)?.id, 128);
    const partName = optionalTrimmedString((part as any)?.partName ?? (part as any)?.name, 240);
    return { partId: partId || undefined, partName: partName || undefined, qty: quantity };
  });
}

async function resolveCompanyJob<T extends Record<string, unknown>>(
  companyId: string,
  jobIdentifier: string,
  fields: string,
  ctx: EdgeFunctionContext,
): Promise<T | null> {
  const supabase = createSupabaseClient(ctx.env);
  const normalizedIdentifier = String(jobIdentifier || "").trim();

  if (/^\d+$/.test(normalizedIdentifier)) {
    const { data: byJobNo, error: byJobNoError } = await supabase
      .from("jobs")
      .select(fields)
      .eq("company_id", companyId)
      .eq("job_no", Number(normalizedIdentifier))
      .maybeSingle();
    if (byJobNoError) {
      throw { code: "internal", message: "Failed to load job", httpStatus: 500 };
    }
    if (byJobNo) {
      return byJobNo as unknown as T;
    }
  }

  if (!isUuidLike(normalizedIdentifier)) {
    return null;
  }

  const { data: byId, error: byIdError } = await supabase
    .from("jobs")
    .select(fields)
    .eq("company_id", companyId)
    .eq("id", normalizedIdentifier)
    .maybeSingle();
  if (byIdError) {
    throw { code: "internal", message: "Failed to load job", httpStatus: 500 };
  }
  return (byId as T | null) ?? null;
}

async function requireMembership(
  companyId: string,
  ctx: EdgeFunctionContext,
  allowedRoles: string[],
): Promise<MembershipContext> {
  if (!ctx.auth?.uid) {
    throw { code: "unauthenticated", message: "Authentication required", httpStatus: 401 };
  }

  const supabase = createSupabaseClient(ctx.env);
  const { data: membership, error } = await supabase
    .from("company_memberships")
    .select("id, role, member_no, display_name")
    .eq("company_id", companyId)
    .eq("user_id", ctx.auth.uid)
    .eq("status", "active")
    .single();

  if (error || !membership) {
    throw { code: "permission-denied", message: "Not allowed for this company", httpStatus: 403 };
  }
  if (!allowedRoles.includes(String(membership.role))) {
    throw { code: "permission-denied", message: "Role cannot perform this operation", httpStatus: 403 };
  }

  return {
    id: membership.id,
    role: String(membership.role),
    memberNo: Number(membership.member_no || 0),
    displayName: membership.display_name || null,
  };
}

async function maybeResolveClient(
  companyId: string,
  cidRaw: unknown,
  cnameRaw: unknown,
  cphoneRaw: unknown,
  ctx: EdgeFunctionContext,
): Promise<{ clientId: string | null; cname: string | null; cphone: string | null }> {
  const supabase = createSupabaseClient(ctx.env);
  const cidStr = optionalTrimmedString(cidRaw, 128);
  const cname = optionalTrimmedString(cnameRaw, 240) || null;
  const cphone = optionalTrimmedString(cphoneRaw, 40) || null;

  if (!cidStr) {
    return { clientId: null, cname, cphone };
  }

  let client: any = null;
  if (/^\d+$/.test(cidStr)) {
    const { data } = await supabase
      .from("clients")
      .select("id, name, phone")
      .eq("company_id", companyId)
      .eq("client_no", Number(cidStr))
      .maybeSingle();
    client = data || null;
  }
  if (!client) {
    const { data } = await supabase
      .from("clients")
      .select("id, name, phone")
      .eq("company_id", companyId)
      .eq("id", cidStr)
      .maybeSingle();
    client = data || null;
  }

  if (!client) {
    throw { code: "not-found", message: "Client not found", httpStatus: 404 };
  }

  return {
    clientId: client.id,
    cname: cname || client.name || null,
    cphone: cphone || client.phone || null,
  };
}

async function maybeResolveAssignee(
  companyId: string,
  widRaw: unknown,
  ctx: EdgeFunctionContext,
): Promise<{ assignedMembershipId: string | null; wid: string | null; wname: string | null }> {
  const widStr = optionalTrimmedString(widRaw, 128);
  if (!widStr) return { assignedMembershipId: null, wid: null, wname: null };

  const supabase = createSupabaseClient(ctx.env);
  let membership: any = null;
  if (/^\d+$/.test(widStr)) {
    const { data } = await supabase
      .from("company_memberships")
      .select("id, member_no, display_name")
      .eq("company_id", companyId)
      .eq("member_no", Number(widStr))
      .eq("status", "active")
      .maybeSingle();
    membership = data || null;
  }
  if (!membership) {
    const { data } = await supabase
      .from("company_memberships")
      .select("id, member_no, display_name")
      .eq("company_id", companyId)
      .eq("id", widStr)
      .eq("status", "active")
      .maybeSingle();
    membership = data || null;
  }

  if (!membership) {
    throw { code: "not-found", message: "Assigned worker not found", httpStatus: 404 };
  }

  return {
    assignedMembershipId: membership.id,
    wid: String(membership.member_no || ""),
    wname: membership.display_name || null,
  };
}

async function getMembershipSummaryById(
  companyId: string,
  membershipId: string | null | undefined,
  ctx: EdgeFunctionContext,
): Promise<{ wid: string | null; wname: string | null } | null> {
  const normalizedMembershipId = optionalTrimmedString(membershipId, 128);
  if (!normalizedMembershipId) return null;

  const supabase = createSupabaseClient(ctx.env);
  const { data: membership, error } = await supabase
    .from("company_memberships")
    .select("member_no, display_name")
    .eq("company_id", companyId)
    .eq("id", normalizedMembershipId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw { code: "internal", message: "Failed to resolve membership", httpStatus: 500 };
  }
  if (!membership) return null;

  return {
    wid: membership.member_no != null ? String(membership.member_no) : null,
    wname: membership.display_name || null,
  };
}

async function bumpJobsVersion(companyId: string, ctx: EdgeFunctionContext): Promise<void> {
  const supabase = createSupabaseClient(ctx.env);
  const now = new Date().toISOString();
  const { data: state } = await supabase
    .from("company_sync_state")
    .select("jobs_version")
    .eq("company_id", companyId)
    .maybeSingle();

  if (!state) {
    const { error: insertError } = await supabase.from("company_sync_state").insert({
      company_id: companyId,
      jobs_version: 1,
      updated_at: now,
    });
    if (insertError) {
      throw { code: "internal", message: "Failed to initialize jobs sync state", httpStatus: 500 };
    }
    return;
  }

  const { error: updateError } = await supabase
    .from("company_sync_state")
    .update({ jobs_version: Number(state.jobs_version || 0) + 1, updated_at: now })
    .eq("company_id", companyId);
  if (updateError) {
    throw { code: "internal", message: "Failed to bump jobs sync state", httpStatus: 500 };
  }
}

async function mapJobRecordForResponse(job: any, ctx: EdgeFunctionContext): Promise<any> {
  const supabase = createSupabaseClient(ctx.env);
  const meta = job.meta && typeof job.meta === "object" && !Array.isArray(job.meta) ? job.meta as Record<string, unknown> : {};

  const [{ data: parts }, { data: attachments }, assigneeSummary, creatorSummary] = await Promise.all([
    supabase
      .from("job_part_usages")
      .select("inventory_part_id, part_name_snapshot, quantity")
      .eq("job_id", job.id),
    supabase
      .from("job_attachments")
      .select("storage_path, kind")
      .eq("job_id", job.id),
    getMembershipSummaryById(String(job.company_id), job.assigned_membership_id, ctx),
    getMembershipSummaryById(String(job.company_id), job.created_by_membership_id, ctx),
  ]);

  const photoRefs = (attachments || [])
    .filter((attachment: any) => String(attachment.kind) === "photo")
    .map((attachment: any) => ({ storagePath: String(attachment.storage_path || "") }))
    .filter((attachment: JobAttachmentRef) => Boolean(attachment.storagePath));
  const signatureRef = (attachments || [])
    .find((attachment: any) => String(attachment.kind) === "signature");
  const partIds = Array.from(new Set((parts || [])
    .map((part: any) => optionalTrimmedString(part.inventory_part_id, 128))
    .filter(Boolean))) as string[];
  const partNoById = new Map<string, number>();
  if (partIds.length > 0) {
    const { data: partRows, error: partRowsError } = await supabase
      .from("inventory_parts")
      .select("id, part_no")
      .in("id", partIds);
    if (partRowsError) {
      throw { code: "internal", message: "Failed to load inventory part numbers", httpStatus: 500 };
    }
    for (const row of partRows || []) {
      if (row?.id && row?.part_no != null) {
        partNoById.set(String(row.id), Number(row.part_no));
      }
    }
  }

  return {
    jobId: String(job.job_no || job.id),
    jobNo: job.job_no,
    status: String(job.status),
    companyId: String(job.company_id),
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
    wid: assigneeSummary?.wid || null,
    wname: assigneeSummary?.wname || job.assigned_member_name_snapshot || null,
    mid: creatorSummary?.wid || null,
    mname: creatorSummary?.wname || job.created_by_name_snapshot || null,
    parts: (parts || []).map((part: any) => ({
      partId: part.inventory_part_id ? (partNoById.get(String(part.inventory_part_id)) ?? undefined) : undefined,
      partName: part.part_name_snapshot || undefined,
      qty: Number(part.quantity || 0),
    })),
    partsUsed: (parts || []).map((part: any) => ({
      id: part.inventory_part_id ? (partNoById.get(String(part.inventory_part_id)) ?? part.part_name_snapshot ?? undefined) : part.part_name_snapshot || undefined,
      name: part.part_name_snapshot || undefined,
      quantity: Number(part.quantity || 0),
    })),
    isCert: Boolean(job.is_cert),
    timeFrom: typeof meta.timeFrom === "string" ? meta.timeFrom : null,
    timeTo: typeof meta.timeTo === "string" ? meta.timeTo : null,
    travelDistance: meta.travelDistance == null ? null : Number(meta.travelDistance),
    signingPerson: typeof meta.signingPerson === "string" ? meta.signingPerson : null,
    photos: photoRefs,
    signature: signatureRef?.storage_path ? { storagePath: String(signatureRef.storage_path) } : null,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    finishedAt: job.finished_at || null,
    deniedAt: job.denied_at || null,
  };
}

export async function createJobV1(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  const requestedCompanyId = validateCompanyId(payload?.companyId);
  const resolvedCompany = await resolveCompanyIdentifiers(requestedCompanyId, ctx.env);
  const companyId = resolvedCompany.internalCompanyId;
  const membership = await requireMembership(companyId, ctx, ["manager", "user", "dev"]);

  const jobType = optionalTrimmedString(payload?.type, 20) || "pending";
  if (!["pending", "finished"].includes(jobType)) {
    throw { code: "invalid-argument", message: "type must be pending or finished", httpStatus: 400 };
  }
  if (membership.role === "user" && jobType === "pending") {
    throw { code: "permission-denied", message: "Solo users cannot create pending jobs", httpStatus: 403 };
  }

  const title = optionalTrimmedString(payload?.title, 240) || "";
  const description = optionalTrimmedString(payload?.description, 8000) || "";
  const notes = optionalTrimmedString(payload?.notes, 8000) || "";
  const location = optionalTrimmedString(payload?.location, 240) || "";
  const address = optionalTrimmedString(payload?.address, 500) || "";
  const category = optionalTrimmedString(payload?.category, 120) || "";
  const priority = optionalTrimmedString(payload?.priority, 40) || "";
  const dueAt = parseDateOrNull(payload?.dueAt, "dueAt");
  const parts = Object.prototype.hasOwnProperty.call(payload || {}, "partsUsed")
    ? normalizePartsUsed(payload?.partsUsed)
    : normalizeParts(payload?.parts);
  const status = jobType === "pending" ? "pending" : "finished";
  const now = new Date().toISOString();
  const attachments = normalizeAttachmentPayload(payload);

  const client = await maybeResolveClient(companyId, payload?.cid, payload?.cname, payload?.cphone, ctx);
  const assignee = await maybeResolveAssignee(companyId, payload?.wid, ctx);
  const idempotencyKey = optionalTrimmedString(payload?.idempotencyKey, 128) || null;

  const supabase = createSupabaseClient(ctx.env);
  if (idempotencyKey) {
    const { data: duplicateJob } = await supabase
      .from("jobs")
      .select("*")
      .eq("company_id", companyId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (duplicateJob) {
      return await mapJobRecordForResponse(duplicateJob, ctx);
    }
  }

  const nextJobNo = await allocateNextCompanyCounter(companyId, "job_no", ctx);
  const { data: inserted, error: insertError } = await supabase
    .from("jobs")
    .insert({
      company_id: companyId,
      job_no: nextJobNo,
      status,
      title: title || null,
      description: description || null,
      notes: notes || null,
      location: location || null,
      address: address || null,
      category: category || null,
      priority: priority || null,
      due_at: dueAt,
      client_id: client.clientId,
      assigned_membership_id: assignee.assignedMembershipId,
      created_by_membership_id: membership.id,
      created_by_name_snapshot: membership.displayName,
      client_name_snapshot: client.cname,
      client_phone_snapshot: client.cphone,
      assigned_member_name_snapshot: assignee.wname,
      accepted_by_user_id: status === "finished" ? ctx.auth?.uid : null,
      accepted_at: status === "finished" ? now : null,
      finished_at: status === "finished" ? now : null,
      is_cert: false,
      idempotency_key: idempotencyKey,
      meta: buildJobMetaPatch(payload),
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();

  if (insertError || !inserted) {
    if (insertError?.code === "23505") {
      throw { code: "already-exists", message: "Duplicate idempotency key", httpStatus: 409 };
    }
    throw { code: "internal", message: "Failed to create job", httpStatus: 500 };
  }

  if (parts.length > 0) {
    const partRows = parts.map((part) => ({
      job_id: inserted.id,
      inventory_part_id: part.partId || null,
      part_name_snapshot: part.partName || null,
      quantity: part.qty,
      created_at: now,
    }));
    const { error: partsError } = await supabase.from("job_part_usages").insert(partRows);
    if (partsError) {
      const { error: rollbackError } = await supabase.from("jobs").delete().eq("id", inserted.id).eq("company_id", companyId);
      if (rollbackError) {
        ctx.logger.error("Failed to roll back job after parts insert failure", {
          jobId: inserted.id,
          companyId,
          rollbackError: rollbackError.message,
        });
      }
      throw { code: "internal", message: "Failed to save job parts", httpStatus: 500 };
    }
  }

  if (attachments.photos !== undefined || attachments.signature !== undefined) {
    const attachmentRows = [
      ...(attachments.photos || []).map((photo) => ({
        job_id: inserted.id,
        storage_path: photo.storagePath,
        kind: "photo",
        uploaded_by_user_id: ctx.auth?.uid || null,
        created_at: now,
      })),
      ...(attachments.signature?.storagePath ? [{
        job_id: inserted.id,
        storage_path: attachments.signature.storagePath,
        kind: "signature",
        uploaded_by_user_id: ctx.auth?.uid || null,
        created_at: now,
      }] : []),
    ];
    if (attachmentRows.length > 0) {
      const { error: attachmentError } = await supabase.from("job_attachments").insert(attachmentRows);
      if (attachmentError) {
        const { error: rollbackError } = await supabase.from("jobs").delete().eq("id", inserted.id).eq("company_id", companyId);
        if (rollbackError) {
          ctx.logger.error("Failed to roll back job after attachment insert failure", {
            jobId: inserted.id,
            companyId,
            rollbackError: rollbackError.message,
          });
        }
        throw { code: "internal", message: "Failed to save job attachments", httpStatus: 500 };
      }
    }
  }

  await bumpJobsVersion(companyId, ctx);
  return await mapJobRecordForResponse(inserted, ctx);
}

export async function updateJobV1(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  const requestedCompanyId = validateCompanyId(payload?.companyId);
  const resolvedCompany = await resolveCompanyIdentifiers(requestedCompanyId, ctx.env);
  const companyId = resolvedCompany.internalCompanyId;
  const requestedJobId = requireNonEmptyString(payload?.jobId, "jobId", 1, 128);
  const membership = await requireMembership(companyId, ctx, ["manager", "worker", "user", "dev"]);

  const supabase = createSupabaseClient(ctx.env);
  const existingJob = await resolveCompanyJob<any>(companyId, requestedJobId, "*", ctx);
  if (!existingJob) {
    throw { code: "not-found", message: "Job not found", httpStatus: 404 };
  }
  const jobId = String(existingJob.id);

  if (["worker", "user"].includes(membership.role)) {
    const assignedMembershipId = String(existingJob.assigned_membership_id || "");
    const assignedMatchesMembership = assignedMembershipId && assignedMembershipId === membership.id;
    if (!assignedMatchesMembership) {
      throw { code: "permission-denied", message: "You can only update your assigned jobs", httpStatus: 403 };
    }
  }

  const nextStatus = payload?.status !== undefined
    ? requireNonEmptyString(payload.status, "status", 4, 32).toLowerCase()
    : null;
  if (nextStatus && !VALID_STATUSES.includes(nextStatus)) {
    throw { code: "invalid-argument", message: `Invalid status: ${nextStatus}`, httpStatus: 400 };
  }
  if (nextStatus === "finished" && String(existingJob.status || "") !== "finished") {
    throw { code: "failed-precondition", message: "Cannot transition directly to finished. Use acceptJobV1.", httpStatus: 400 };
  }
  if (payload?.isCert !== undefined) {
    throw { code: "permission-denied", message: "isCert is server-managed and cannot be updated directly", httpStatus: 403 };
  }

  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (payload?.title !== undefined) patch.title = optionalTrimmedString(payload.title, 240) || null;
  if (payload?.description !== undefined) patch.description = optionalTrimmedString(payload.description, 8000) || null;
  if (payload?.notes !== undefined) patch.notes = optionalTrimmedString(payload.notes, 8000) || null;
  if (payload?.location !== undefined) patch.location = optionalTrimmedString(payload.location, 240) || null;
  if (payload?.address !== undefined) patch.address = optionalTrimmedString(payload.address, 500) || null;
  if (payload?.category !== undefined) patch.category = optionalTrimmedString(payload.category, 120) || null;
  if (payload?.priority !== undefined) patch.priority = optionalTrimmedString(payload.priority, 40) || null;
  if (payload?.dueAt !== undefined) patch.due_at = parseDateOrNull(payload.dueAt, "dueAt");
  if (nextStatus) patch.status = nextStatus;
  if (payload?.deniedAt !== undefined) patch.denied_at = parseDateOrNull(payload.deniedAt, "deniedAt");
  if (payload?.deniedBy !== undefined) patch.denied_by_user_id = optionalTrimmedString(payload.deniedBy, 128) || null;

  if (payload?.cid !== undefined || payload?.cname !== undefined || payload?.cphone !== undefined) {
    const client = await maybeResolveClient(
      companyId,
      payload?.cid ?? (existingJob.client_id || null),
      payload?.cname,
      payload?.cphone,
      ctx,
    );
    patch.client_id = client.clientId;
    patch.client_name_snapshot = client.cname;
    patch.client_phone_snapshot = client.cphone;
  }

  if (payload?.wid !== undefined) {
    const assignee = await maybeResolveAssignee(companyId, payload?.wid, ctx);
    patch.assigned_membership_id = assignee.assignedMembershipId;
    patch.assigned_member_name_snapshot = assignee.wname;
  }

  patch.meta = buildJobMetaPatch(payload, existingJob.meta || {});

  const { data: updatedJob, error: updateError } = await supabase
    .from("jobs")
    .update(patch)
    .eq("id", jobId)
    .eq("company_id", companyId)
    .select()
    .single();

  if (updateError || !updatedJob) {
    throw { code: "internal", message: "Failed to update job", httpStatus: 500 };
  }

  if (payload?.parts !== undefined || payload?.partsUsed !== undefined) {
    const parts = payload?.partsUsed !== undefined ? normalizePartsUsed(payload.partsUsed) : normalizeParts(payload.parts);
    const { data: existingParts } = await supabase
      .from("job_part_usages")
      .select("inventory_part_id, part_name_snapshot, quantity, created_at")
      .eq("job_id", jobId);

    const { error: deletePartsError } = await supabase.from("job_part_usages").delete().eq("job_id", jobId);
    if (deletePartsError) {
      throw { code: "internal", message: "Failed to reset job parts", httpStatus: 500 };
    }
    if (parts.length > 0) {
      const rows = parts.map((part) => ({
        job_id: jobId,
        inventory_part_id: part.partId || null,
        part_name_snapshot: part.partName || null,
        quantity: part.qty,
        created_at: new Date().toISOString(),
      }));
      const { error: partsError } = await supabase.from("job_part_usages").insert(rows);
      if (partsError) {
        if (Array.isArray(existingParts) && existingParts.length > 0) {
          const { error: restoreError } = await supabase.from("job_part_usages").insert(
            existingParts.map((part: any) => ({
              job_id: jobId,
              inventory_part_id: part.inventory_part_id || null,
              part_name_snapshot: part.part_name_snapshot || null,
              quantity: Number(part.quantity || 0),
              created_at: part.created_at || new Date().toISOString(),
            })),
          );
          if (restoreError) {
            ctx.logger.error("Failed to restore job parts after update failure", {
              jobId,
              companyId,
              restoreError: restoreError.message,
            });
          }
        }
        throw { code: "internal", message: "Failed to update job parts", httpStatus: 500 };
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload || {}, "photos") || Object.prototype.hasOwnProperty.call(payload || {}, "signature")) {
    const attachments = normalizeAttachmentPayload(payload);
    const { error: deleteAttachmentsError } = await supabase.from("job_attachments").delete().eq("job_id", jobId);
    if (deleteAttachmentsError) {
      throw { code: "internal", message: "Failed to reset job attachments", httpStatus: 500 };
    }
    const attachmentRows = [
      ...(attachments.photos || []).map((photo) => ({
        job_id: jobId,
        storage_path: photo.storagePath,
        kind: "photo",
        uploaded_by_user_id: ctx.auth?.uid || null,
        created_at: new Date().toISOString(),
      })),
      ...(attachments.signature?.storagePath ? [{
        job_id: jobId,
        storage_path: attachments.signature.storagePath,
        kind: "signature",
        uploaded_by_user_id: ctx.auth?.uid || null,
        created_at: new Date().toISOString(),
      }] : []),
    ];
    if (attachmentRows.length > 0) {
      const { error: attachmentError } = await supabase.from("job_attachments").insert(attachmentRows);
      if (attachmentError) {
        throw { code: "internal", message: "Failed to update job attachments", httpStatus: 500 };
      }
    }
  }

  await bumpJobsVersion(companyId, ctx);
  return await mapJobRecordForResponse(updatedJob, ctx);
}

export async function deleteJobV1(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  const requestedCompanyId = validateCompanyId(payload?.companyId);
  const resolvedCompany = await resolveCompanyIdentifiers(requestedCompanyId, ctx.env);
  const companyId = resolvedCompany.internalCompanyId;
  const requestedJobId = requireNonEmptyString(payload?.jobId, "jobId", 1, 128);
  const membership = await requireMembership(companyId, ctx, ["manager", "worker", "user", "dev"]);

  const supabase = createSupabaseClient(ctx.env);
  const existingJob = await resolveCompanyJob<any>(companyId, requestedJobId, "id, job_no, status, is_cert, assigned_membership_id", ctx);

  if (!existingJob) {
    throw { code: "not-found", message: "Job not found", httpStatus: 404 };
  }
  const jobId = String(existingJob.id);

  if (existingJob.is_cert === true) {
    throw { code: "failed-precondition", message: "Cannot delete a job that has a generated document (isCert=true)", httpStatus: 400 };
  }
  if (["pending", "waiting"].includes(String(existingJob.status || "")) && !["manager", "dev"].includes(membership.role)) {
    throw { code: "permission-denied", message: "Only managers can delete pending jobs", httpStatus: 403 };
  }
  if (["worker", "user"].includes(membership.role) && String(existingJob.assigned_membership_id || "") !== membership.id) {
    throw { code: "permission-denied", message: "You can only delete your own jobs", httpStatus: 403 };
  }

  const { error: deleteError } = await supabase
    .from("jobs")
    .delete()
    .eq("company_id", companyId)
    .eq("id", jobId);

  if (deleteError) {
    throw { code: "internal", message: "Failed to delete job", httpStatus: 500 };
  }

  await bumpJobsVersion(companyId, ctx);
  return { deleted: true, jobId: String(existingJob.job_no || requestedJobId) };
}

export async function acceptJobV1(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  const requestedCompanyId = validateCompanyId(payload?.companyId);
  const resolvedCompany = await resolveCompanyIdentifiers(requestedCompanyId, ctx.env);
  const companyId = resolvedCompany.internalCompanyId;
  const requestedJobId = requireNonEmptyString(payload?.jobId, "jobId", 1, 128);
  await requireMembership(companyId, ctx, ["manager", "dev"]);

  const now = new Date().toISOString();
  const supabase = createSupabaseClient(ctx.env);
  const existingJob = await resolveCompanyJob<any>(companyId, requestedJobId, "id", ctx);
  if (!existingJob?.id) {
    throw { code: "not-found", message: "Job not found", httpStatus: 404 };
  }
  const jobId = String(existingJob.id);
  const { data: accepted, error } = await supabase
    .from("jobs")
    .update({
      status: "finished",
      accepted_by_user_id: ctx.auth?.uid || null,
      accepted_at: now,
      finished_at: now,
      updated_at: now,
    })
    .eq("company_id", companyId)
    .eq("id", jobId)
    .select()
    .single();

  if (error || !accepted) {
    throw { code: "not-found", message: "Job not found", httpStatus: 404 };
  }

  await bumpJobsVersion(companyId, ctx);
  return await mapJobRecordForResponse(accepted, ctx);
}

export async function createJobFileDownloadUrlV1(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  const requestedCompanyId = validateCompanyId(payload?.companyId);
  const resolvedCompany = await resolveCompanyIdentifiers(requestedCompanyId, ctx.env);
  const companyId = resolvedCompany.internalCompanyId;
  const requestedJobId = requireNonEmptyString(payload?.jobId, "jobId", 1, 128);
  const storagePath = requireNonEmptyString(payload?.storagePath, "storagePath", 4, 1024).replace(/^\/+/, "");
  await requireMembership(companyId, ctx, ["manager", "worker", "user", "dev"]);

  const supabase = createSupabaseClient(ctx.env);
  const job = await resolveCompanyJob<any>(companyId, requestedJobId, "id, job_no", ctx);
  if (!job?.id) {
    throw { code: "not-found", message: "Job not found", httpStatus: 404 };
  }

  const normalizedPublicJobId = String(job.job_no || requestedJobId);
  const validPrefixes = [
    `companies/${resolvedCompany.publicCompanyId}/jobs/${normalizedPublicJobId}/`,
    `${ctx.auth?.uid || ""}/jobs/${normalizedPublicJobId}/`,
  ].filter(Boolean);
  if (!validPrefixes.some((prefix) => storagePath.startsWith(prefix))) {
    throw { code: "invalid-argument", message: "storagePath does not match the requested job", httpStatus: 400 };
  }

  const bucket = Deno.env.get("JOB_FILES_BUCKET") || "companies";
  const expirySeconds = Math.min(60 * 60, Math.max(60, Number(payload?.expirySeconds || 900) || 900));

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(storagePath, expirySeconds);
  if (error || !data?.signedUrl) {
    throw { code: "unavailable", message: "Job file download URL is unavailable", httpStatus: 503 };
  }

  return {
    success: true,
    downloadURL: data.signedUrl,
    expiresAt: new Date(Date.now() + expirySeconds * 1000).toISOString(),
  };
}
