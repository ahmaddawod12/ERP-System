/**
 * Invites Handler Module
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
  validateEmail,
} from "../shared-edge-helpers.ts";

const ALLOWED_TARGET_ROLES = ["manager", "worker", "user", "basic"];

function generateInviteCode(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
}

export async function createInviteV1(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  if (!ctx.auth?.uid) {
    throw { code: "unauthenticated", message: "Authentication required", httpStatus: 401 };
  }

  const requestedCompanyId = validateCompanyId(payload?.companyId);
  const resolvedCompany = await resolveCompanyIdentifiers(requestedCompanyId, ctx.env);
  const companyId = resolvedCompany.internalCompanyId;
  const targetRole = requireNonEmptyString(payload?.targetRole, "targetRole", 1, 50);
  if (!ALLOWED_TARGET_ROLES.includes(targetRole)) {
    throw { code: "invalid-argument", message: "Invalid targetRole", httpStatus: 400 };
  }

  const targetEmailRaw = optionalTrimmedString(payload?.targetEmail, 254);
  const targetEmail = targetEmailRaw ? validateEmail(targetEmailRaw) : undefined;
  const expiresInDays = Math.max(1, Math.min(365, Number(payload?.expiresInDays) || 30));
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  const supabase = createSupabaseClient(ctx.env);

  const { data: userProfile } = await supabase
    .from("app_users")
    .select("system_role")
    .eq("id", ctx.auth.uid)
    .maybeSingle();

  const { data: creatorMembership } = await supabase
    .from("company_memberships")
    .select("id, role, status")
    .eq("company_id", companyId)
    .eq("user_id", ctx.auth.uid)
    .maybeSingle();

  const isDev = userProfile?.system_role === "dev";
  const isManager = creatorMembership?.status === "active" && creatorMembership?.role === "manager";
  if (!isDev && !isManager) {
    throw { code: "permission-denied", message: "Manager role required", httpStatus: 403 };
  }

  let invite: any = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = generateInviteCode();
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("company_invites")
      .insert({
        company_id: companyId,
        code,
        target_role: targetRole,
        status: "active",
        invited_email: targetEmail ?? null,
        created_by_membership_id: creatorMembership?.id ?? null,
        expires_at: expiresAt,
        created_at: now,
      })
      .select("id, code, target_role, status, expires_at, created_at")
      .single();

    if (!error && data) {
      invite = data;
      break;
    }

    if (error && error.code !== "23505") {
      throw { code: "internal", message: "Failed to create invite", httpStatus: 500 };
    }
  }

  if (!invite) {
    throw { code: "unavailable", message: "Failed to generate unique invite code", httpStatus: 503 };
  }

  return {
    inviteId: invite.id,
    code: invite.code,
    targetRole: invite.target_role,
    status: invite.status,
    expiresAt: invite.expires_at,
    createdAt: invite.created_at,
  };
}

export async function joinCompanyV1(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  if (!ctx.auth?.uid) {
    throw { code: "unauthenticated", message: "Authentication required", httpStatus: 401 };
  }

  const inviteCode = requireNonEmptyString(payload?.inviteCode, "inviteCode", 4, 80).toUpperCase();
  const displayNameInput = optionalTrimmedString(payload?.displayName, 200);
  const phoneNumberInput = optionalTrimmedString(payload?.phoneNumber, 40);

  const supabase = createSupabaseClient(ctx.env);

  const { data: invite, error: inviteError } = await supabase
    .from("company_invites")
    .select("id, company_id, target_role, status, invited_email, expires_at")
    .eq("code", inviteCode)
    .single();

  if (inviteError || !invite) {
    throw { code: "not-found", message: "Invite not found", httpStatus: 404 };
  }

  if (invite.status !== "active") {
    throw { code: "permission-denied", message: "Invite is not active", httpStatus: 403 };
  }

  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    throw { code: "permission-denied", message: "Invite has expired", httpStatus: 403 };
  }

  const { data: existingMembership } = await supabase
    .from("company_memberships")
    .select("id")
    .eq("company_id", invite.company_id)
    .eq("user_id", ctx.auth.uid)
    .maybeSingle();

  if (existingMembership) {
    throw { code: "already-exists", message: "User already belongs to this company", httpStatus: 409 };
  }

  const { data: user, error: userError } = await supabase
    .from("app_users")
    .select("id, display_name, phone_number, email")
    .eq("id", ctx.auth.uid)
    .single();

  if (userError || !user) {
    throw { code: "not-found", message: "User profile not found", httpStatus: 404 };
  }

  if (invite.invited_email && user.email && invite.invited_email.toLowerCase() !== user.email.toLowerCase()) {
    throw { code: "permission-denied", message: "Invite is restricted to a different email", httpStatus: 403 };
  }

  const consumedAt = new Date().toISOString();
  const { data: consumedInvite, error: consumeError } = await supabase
    .from("company_invites")
    .update({
      status: "used",
      used_by_user_id: ctx.auth.uid,
      used_at: consumedAt,
    })
    .eq("id", invite.id)
    .eq("status", "active")
    .select("id, company_id")
    .maybeSingle();

  if (consumeError) {
    throw { code: "internal", message: "Failed to consume invite", httpStatus: 500 };
  }
  if (!consumedInvite?.id) {
    throw { code: "permission-denied", message: "Invite is no longer active", httpStatus: 403 };
  }

  const memberNo = await allocateNextCompanyCounter(invite.company_id, "member_no", ctx);
  const joinedAt = new Date().toISOString();
  const displayName = displayNameInput || user.display_name || "";
  const phoneNumber = phoneNumberInput || user.phone_number || null;

  const { data: membership, error: insertMembershipError } = await supabase
    .from("company_memberships")
    .insert({
      company_id: invite.company_id,
      user_id: ctx.auth.uid,
      member_no: memberNo,
      role: invite.target_role,
      status: "active",
      display_name: displayName || null,
      phone_number: phoneNumber,
      joined_at: joinedAt,
      created_at: joinedAt,
      updated_at: joinedAt,
    })
    .select("id, company_id, role, display_name, status, joined_at")
    .single();

  if (insertMembershipError || !membership) {
    await supabase
      .from("company_invites")
      .update({
        status: "active",
        used_by_user_id: null,
        used_at: null,
      })
      .eq("id", invite.id)
      .eq("used_by_user_id", ctx.auth.uid);
    throw { code: "internal", message: "Failed to join company", httpStatus: 500 };
  }

  if (displayNameInput || phoneNumberInput) {
    await supabase
      .from("app_users")
      .update({
        display_name: displayNameInput ?? user.display_name,
        phone_number: phoneNumberInput ?? user.phone_number,
        updated_at: joinedAt,
      })
      .eq("id", ctx.auth.uid);
  }

  const { data: company } = await supabase
    .from("companies")
    .select("public_company_id")
    .eq("id", membership.company_id)
    .maybeSingle();

  return {
    companyId: company?.public_company_id ? String(company.public_company_id) : String(membership.company_id),
    membershipId: membership.id,
    role: membership.role,
    displayName: membership.display_name || displayName || "",
    status: membership.status,
    joinedAt: membership.joined_at,
  };
}
