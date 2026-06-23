/**
 * Miscellaneous Handler Module (Upgrades, Contact Requests, etc.)
 * Phase: 2 | Status: Implemented
 */
import {
  EdgeFunctionContext,
  enabledModulesForTier,
  createSupabaseClient,
  optionalTrimmedString,
  requireNonEmptyString,
  validateEmail,
} from "../shared-edge-helpers.ts";

const TIER_VALUES = ["Basic", "Solo", "Team", "Enterprise"];
const UPGRADEABLE_TIERS = ["Solo", "Team", "Enterprise"];

function normalizeTier(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const matched = TIER_VALUES.find((tier) => tier.toLowerCase() === raw.toLowerCase());
  return matched || null;
}

async function requireDev(uid: string, ctx: EdgeFunctionContext): Promise<{ display_name: string | null; email: string | null }> {
  const supabase = createSupabaseClient(ctx.env);
  const { data: user, error } = await supabase
    .from("app_users")
    .select("display_name, email, system_role")
    .eq("id", uid)
    .single();

  if (error || !user) {
    throw { code: "not-found", message: "User profile not found", httpStatus: 404 };
  }
  if (String(user.system_role || "").toLowerCase() !== "dev") {
    throw { code: "permission-denied", message: "Only dev admins can perform this action", httpStatus: 403 };
  }

  return user;
}

async function resolveMembershipContext(uid: string, ctx: EdgeFunctionContext): Promise<{
  role: string | null;
  publicCompanyId: string | null;
  internalCompanyId: string | null;
}> {
  const supabase = createSupabaseClient(ctx.env);
  const { data: row } = await supabase
    .from("company_memberships")
    .select("role, company_id, companies!inner(public_company_id)")
    .eq("user_id", uid)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (!row?.company_id) {
    return { role: null, publicCompanyId: null, internalCompanyId: null };
  }

  const companyRow = Array.isArray(row.companies) ? row.companies[0] : row.companies;
  return {
    role: (row as any).role || null,
    internalCompanyId: row.company_id,
    publicCompanyId: companyRow?.public_company_id ? String(companyRow.public_company_id) : null,
  };
}

export async function requestUpgradeV1(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  if (!ctx.auth?.uid) {
    throw { code: "unauthenticated", message: "Authentication required", httpStatus: 401 };
  }

  const requestedTierRaw = requireNonEmptyString(payload?.requestedTier, "requestedTier", 2, 32);
  const requestedTier = normalizeTier(requestedTierRaw);
  if (!requestedTier || !UPGRADEABLE_TIERS.includes(requestedTier)) {
    throw { code: "invalid-argument", message: "requestedTier is invalid", httpStatus: 400 };
  }

  const message = requireNonEmptyString(payload?.message, "message", 10, 2000);
  const suppliedCompanyId = optionalTrimmedString(payload?.companyId, 32);
  const suppliedCurrentTier = normalizeTier(payload?.currentTier) || "Basic";

  const supabase = createSupabaseClient(ctx.env);
  const now = new Date().toISOString();

  const [{ data: user, error: userError }, membershipCtx] = await Promise.all([
    supabase.from("app_users").select("email, system_role").eq("id", ctx.auth.uid).single(),
    resolveMembershipContext(ctx.auth.uid, ctx),
  ]);

  if (userError || !user) {
    throw { code: "not-found", message: "User profile not found", httpStatus: 404 };
  }

  const isDev = String(user.system_role || "").toLowerCase() === "dev";
  if (suppliedCompanyId && !isDev) {
    if (!membershipCtx.publicCompanyId || suppliedCompanyId !== membershipCtx.publicCompanyId) {
      throw {
        code: "permission-denied",
        message: "companyId must match your active company membership",
        httpStatus: 403,
      };
    }
  }

  const companyId = suppliedCompanyId || membershipCtx.publicCompanyId;
  let currentTier = suppliedCurrentTier;
  let internalCompanyIdForInsert: string | null = membershipCtx.internalCompanyId;
  if (companyId) {
    const publicCompanyId = Number(companyId);
    if (Number.isFinite(publicCompanyId)) {
      const { data: company } = await supabase
        .from("companies")
        .select("id")
        .eq("public_company_id", publicCompanyId)
        .single();
      if (company?.id) {
        internalCompanyIdForInsert = String(company.id);
        const { data: subscription } = await supabase
          .from("company_subscriptions")
          .select("tier")
          .eq("company_id", company.id)
          .single();
        currentTier = normalizeTier(subscription?.tier) || currentTier;
      }
    }
  }

  if (currentTier === requestedTier) {
    throw { code: "invalid-argument", message: "Requested tier must differ from current tier", httpStatus: 400 };
  }

  const role = String(user.system_role || membershipCtx.role || "").toLowerCase() || null;
  const { data: inserted, error: insertError } = await supabase
    .from("upgrade_requests")
    .insert({
      uid: ctx.auth.uid,
      email: user.email || ctx.auth.email || null,
      company_id: internalCompanyIdForInsert || null,
      role,
      current_tier: currentTier,
      requested_tier: requestedTier,
      message,
      status: "pending",
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    throw { code: "internal", message: "Failed to create upgrade request", httpStatus: 500 };
  }

  return { requestId: inserted.id };
}

export async function listUpgradeRequestsV1(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  if (!ctx.auth?.uid) {
    throw { code: "unauthenticated", message: "Authentication required", httpStatus: 401 };
  }
  await requireDev(ctx.auth.uid, ctx);

  const limit = Math.min(200, Math.max(1, Number(payload?.limit || 100) || 100));
  const supabase = createSupabaseClient(ctx.env);
  const { data: rows, error } = await supabase
    .from("upgrade_requests")
    .select("id, uid, email, company_id, role, current_tier, requested_tier, message, status, created_at, updated_at, moderated_at, moderated_by_uid, moderated_by_name, moderation_note, applied_at, applied_by_uid")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw { code: "internal", message: "Failed to list upgrade requests", httpStatus: 500 };
  }

  const items = (rows || []).map((row: any) => ({
    id: String(row.id),
    uid: row.uid == null ? null : String(row.uid),
    email: row.email == null ? null : String(row.email),
    companyId: row.company_id == null ? null : String(row.company_id),
    role: row.role == null ? null : String(row.role),
    currentTier: normalizeTier(row.current_tier) || "Basic",
    requestedTier: normalizeTier(row.requested_tier),
    message: row.message == null ? "" : String(row.message),
    status: row.status == null ? "pending" : String(row.status),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    moderatedAt: row.moderated_at || null,
    moderatedByUid: row.moderated_by_uid == null ? null : String(row.moderated_by_uid),
    moderatedByName: row.moderated_by_name == null ? null : String(row.moderated_by_name),
    moderationNote: row.moderation_note == null ? "" : String(row.moderation_note),
    appliedAt: row.applied_at || null,
    appliedByUid: row.applied_by_uid == null ? null : String(row.applied_by_uid),
  }));

  return { items, allowedTiers: TIER_VALUES };
}

export async function moderateUpgradeRequestV1(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  if (!ctx.auth?.uid) {
    throw { code: "unauthenticated", message: "Authentication required", httpStatus: 401 };
  }

  const moderator = await requireDev(ctx.auth.uid, ctx);
  const requestId = requireNonEmptyString(payload?.requestId, "requestId", 3, 128);
  const status = requireNonEmptyString(payload?.status, "status", 4, 32).toLowerCase();
  const moderationNote = optionalTrimmedString(payload?.moderationNote, 1000) || "";

  if (!["approved", "rejected", "pending"].includes(status)) {
    throw { code: "invalid-argument", message: "status must be approved, rejected, or pending", httpStatus: 400 };
  }

  const supabase = createSupabaseClient(ctx.env);
  const now = new Date().toISOString();

  const { data: requestData, error: loadError } = await supabase
    .from("upgrade_requests")
    .select("id, company_id, requested_tier, applied_at")
    .eq("id", requestId)
    .single();

  if (loadError || !requestData) {
    throw { code: "not-found", message: "Upgrade request not found", httpStatus: 404 };
  }

  if (requestData.applied_at && status !== "approved") {
    throw {
      code: "failed-precondition",
      message: "Applied upgrade requests cannot be moved back to pending or rejected",
      httpStatus: 400,
    };
  }

  const requestedTier = normalizeTier(requestData.requested_tier);
  let approvedCurrentTier: string | null = null;
  if (status === "approved" && requestedTier && requestData.company_id) {
    const internalCompanyId = String(requestData.company_id).trim();
    if (internalCompanyId) {
      const { error: subscriptionError } = await supabase
        .from("company_subscriptions")
        .update({
          tier: requestedTier,
          status: "active",
          enabled_modules: enabledModulesForTier(requestedTier),
          updated_at: now,
        })
        .eq("company_id", internalCompanyId);

      if (subscriptionError) {
        throw { code: "internal", message: "Failed to apply approved tier", httpStatus: 500 };
      }
      approvedCurrentTier = requestedTier;
    }
  }

  const patch: Record<string, any> = {
    status,
    moderation_note: moderationNote,
    updated_at: now,
    moderated_at: now,
    moderated_by_uid: ctx.auth.uid,
    moderated_by_name: moderator.display_name || moderator.email || ctx.auth.uid,
  };
  if (approvedCurrentTier) {
    patch.current_tier = approvedCurrentTier;
    patch.applied_at = now;
    patch.applied_by_uid = ctx.auth.uid;
  }

  const { error: updateError } = await supabase
    .from("upgrade_requests")
    .update(patch)
    .eq("id", requestId);

  if (updateError) {
    throw { code: "internal", message: "Failed to moderate upgrade request", httpStatus: 500 };
  }

  return { requestId, status };
}

export async function contactRequestV1(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  const name = requireNonEmptyString(payload?.name, "name", 2, 120);
  const email = validateEmail(requireNonEmptyString(payload?.email, "email", 5, 320)).toLowerCase();
  const subject = requireNonEmptyString(payload?.subject, "subject", 2, 500);
  const company = requireNonEmptyString(payload?.company, "company", 2, 140);
  const message = requireNonEmptyString(payload?.message, "message", 8, 2000);
  const websiteHp = optionalTrimmedString(payload?.website || payload?.url || payload?.companyWebsite, 500);
  if (websiteHp) {
    throw { code: "invalid-argument", message: "Invalid contact request", httpStatus: 400 };
  }

  const supabase = createSupabaseClient(ctx.env);
  const now = new Date().toISOString();
  const expireAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();

  const { data: inserted, error } = await supabase
    .from("contact_requests")
    .insert({
      name,
      email,
      subject,
      company,
      message,
      status: "new",
      created_at: now,
      updated_at: now,
      expire_at: expireAt,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    throw { code: "internal", message: "Failed to create contact request", httpStatus: 500 };
  }

  return { requestId: inserted.id };
}
