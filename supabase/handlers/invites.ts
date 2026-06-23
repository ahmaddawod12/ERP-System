/**
 * Invites Handler Module
 * Phase: 2 | Status: Implemented
 */
import {
  EdgeFunctionContext,
  bumpCompanySyncVersion,
  createSupabaseClient,
  optionalTrimmedString,
  requireNonEmptyString,
  resolveCompanyIdentifiers,
  validateCompanyId,
  validateEmail,
} from "../shared-edge-helpers.ts";

const ALLOWED_TARGET_ROLES = ["manager", "worker", "user", "basic"];

function generateInviteCode(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(10)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
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

  const [{ data: userProfile }, { data: creatorMembership }] = await Promise.all([
    supabase.from("app_users").select("system_role").eq("id", ctx.auth.uid).maybeSingle(),
    supabase
      .from("company_memberships")
      .select("id, role, status")
      .eq("company_id", companyId)
      .eq("user_id", ctx.auth.uid)
      .maybeSingle(),
  ]);

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
  const displayNameInput = optionalTrimmedString(payload?.displayName ?? payload?.name, 200);
  const phoneNumberInput = optionalTrimmedString(payload?.phoneNumber, 40);
  const emailInputRaw = optionalTrimmedString(payload?.email ?? ctx.auth?.email, 320);
  const emailInput = emailInputRaw ? validateEmail(emailInputRaw) : null;

  const supabase = createSupabaseClient(ctx.env);

  const { data: inviteRow, error: inviteLookupError } = await supabase
    .from("company_invites")
    .select("invited_email")
    .eq("code", inviteCode)
    .maybeSingle();

  if (inviteLookupError) {
    throw { code: "internal", message: "Failed to load invite", httpStatus: 500 };
  }

  const invitedEmail = optionalTrimmedString(inviteRow?.invited_email, 254);
  if (invitedEmail && !emailInput) {
    throw { code: "permission-denied", message: "Invite requires an authenticated email", httpStatus: 403 };
  }

  const { data, error } = await supabase.rpc("redeem_company_invite", {
    p_invite_code: inviteCode,
    p_uid: ctx.auth.uid,
    p_display_name: displayNameInput || null,
    p_phone_number: phoneNumberInput || null,
    p_email: emailInput || null,
  });

  if (error) {
    const message = String(error.message || "");
    if (message.includes("invite_not_found")) {
      throw { code: "not-found", message: "Invite not found", httpStatus: 404 };
    }
    if (message.includes("invite_expired")) {
      throw { code: "permission-denied", message: "Invite has expired", httpStatus: 403 };
    }
    if (message.includes("invite_email_mismatch")) {
      throw { code: "permission-denied", message: "Invite is restricted to a different email", httpStatus: 403 };
    }
    if (message.includes("invite_inactive")) {
      throw { code: "permission-denied", message: "Invite is not active", httpStatus: 403 };
    }
    if (message.includes("user_already_in_company")) {
      throw { code: "already-exists", message: "User already belongs to this company", httpStatus: 409 };
    }
    if (message.includes("user_already_in_other_company")) {
      throw { code: "already-exists", message: "User already belongs to another company", httpStatus: 409 };
    }
    if (message.includes("invite_role_invalid")) {
      throw { code: "failed-precondition", message: "Invite target role is invalid", httpStatus: 400 };
    }
    throw { code: "internal", message: "Failed to join company", httpStatus: 500 };
  }

  const membership = Array.isArray(data) ? data[0] : data;
  if (!membership?.membership_id || !membership?.public_company_id) {
    throw { code: "internal", message: "Failed to join company", httpStatus: 500 };
  }

  const internalCompanyId = String(membership.company_id || "");
  if (internalCompanyId) {
    await bumpCompanySyncVersion(internalCompanyId, "workers_version", ctx);
  }

  return {
    companyId: String(membership.public_company_id),
    wid: Number(membership.member_no || 0),
    role: String(membership.role),
    displayName: optionalTrimmedString(membership.display_name, 200) || displayNameInput || "",
    status: "active",
    joinedAt: String(membership.joined_at),
  };
}
