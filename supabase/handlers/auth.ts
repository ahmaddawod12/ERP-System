/**
 * Auth Handler Module
 * 
 * Phase: 2
 * Status: Implemented
 */

import {
  AccountType,
  normalizeAccountType as normalizeAccountTypeContract,
  Role,
  getSubscriptionTierForRole,
} from "@smart-job/contracts";
import {
  allocateNextCompanyCounter,
  allocateNextSystemCounter,
  assertModuleEnabled,
  bumpCompanySyncVersion,
  enabledModulesForTier,
  EdgeFunctionContext,
  createSupabaseClient,
  optionalTrimmedString,
  requireNonEmptyString,
  resolveCompanyIdentifiers,
  validateCompanyId,
  validateEmail,
} from "../shared-edge-helpers.ts";

const ROLE_VALUES: readonly string[] = Object.values(Role);
const ACCOUNT_TYPE_VALUES = Object.values(AccountType);

function normalizeRole(roleRaw: unknown): string | null {
  const role = String(roleRaw || "").trim().toLowerCase();
  if (ROLE_VALUES.includes(role)) return role;
  return null;
}

function normalizeAccountType(value: unknown): string | null {
  const accountType = normalizeAccountTypeContract(String(value || ""));
  return accountType || null;
}

function tierForRole(role: string, accountType: string): string {
  return getSubscriptionTierForRole(role, accountType);
}

async function requireManagerOrDev(
  companyId: string,
  ctx: EdgeFunctionContext,
): Promise<{ callerMembershipId: string | null }> {
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
    return { callerMembershipId: null };
  }

  if (error || !membership || String(membership.role) !== "manager") {
    throw { code: "permission-denied", message: "Manager role required", httpStatus: 403 };
  }

  return { callerMembershipId: membership.id };
}

async function nextMemberNo(companyId: string, ctx: EdgeFunctionContext): Promise<number> {
  return allocateNextCompanyCounter(companyId, "member_no", ctx);
}

export async function manageWorker(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  if (!ctx.auth?.uid) {
    throw { code: "unauthenticated", message: "Authentication required", httpStatus: 401 };
  }

  const action = requireNonEmptyString(payload?.action, "action", 3, 12).toLowerCase();
  if (!["add", "edit", "delete"].includes(action)) {
    throw { code: "invalid-argument", message: "Action must be add, edit, or delete", httpStatus: 400 };
  }

  const requestedCompanyId = validateCompanyId(payload?.companyId);
  const resolvedCompany = await resolveCompanyIdentifiers(requestedCompanyId, ctx.env);
  const companyId = resolvedCompany.internalCompanyId;
  await assertModuleEnabled(companyId, "workers", ctx);
  await requireManagerOrDev(companyId, ctx);

  const workerUid = optionalTrimmedString(payload?.workerUid || payload?.uid, 128);
  if (!workerUid) {
    throw { code: "invalid-argument", message: "workerUid is required", httpStatus: 400 };
  }

  const supabase = createSupabaseClient(ctx.env);
  const now = new Date().toISOString();

  if (action === "add") {
    const email = validateEmail(requireNonEmptyString(payload?.email, "email", 5, 320)).toLowerCase();
    const name = optionalTrimmedString(payload?.name, 200) || "";
    const phoneNumber = optionalTrimmedString(payload?.phoneNumber, 40) || null;
    const role = normalizeRole(payload?.role || "worker");
    if (!role || !["worker", "user", "basic"].includes(role)) {
      throw { code: "invalid-argument", message: "role must be worker, user, or basic", httpStatus: 400 };
    }

    // Ensure app user exists/upserted.
    const { error: upsertUserError } = await supabase
      .from("app_users")
      .upsert({
        id: workerUid,
        email,
        display_name: name || null,
        phone_number: phoneNumber,
        updated_at: now,
      }, { onConflict: "id" });
    if (upsertUserError) {
      throw { code: "internal", message: "Failed to upsert worker profile", httpStatus: 500 };
    }

    const { data: existingMembership } = await supabase
      .from("company_memberships")
      .select("id")
      .eq("company_id", companyId)
      .eq("user_id", workerUid)
      .maybeSingle();
    if (existingMembership) {
      throw { code: "already-exists", message: "Worker already exists in company", httpStatus: 409 };
    }

    const memberNo = await nextMemberNo(companyId, ctx);
    const { data: membership, error: insertError } = await supabase
      .from("company_memberships")
      .insert({
        company_id: companyId,
        user_id: workerUid,
        member_no: memberNo,
        role,
        status: "active",
        display_name: name || null,
        phone_number: phoneNumber,
        joined_at: now,
        created_at: now,
        updated_at: now,
      })
      .select("id, member_no")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        throw { code: "already-exists", message: "Worker already exists in company", httpStatus: 409 };
      }
      throw { code: "internal", message: "Failed to create worker membership", httpStatus: 500 };
    }
    if (!membership) {
      throw { code: "internal", message: "Failed to create worker membership", httpStatus: 500 };
    }

    await bumpCompanySyncVersion(companyId, "workers_version", ctx);
    return {
      success: true,
      uid: workerUid,
      wid: membership.member_no,
      message: "Worker membership created successfully",
    };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("company_memberships")
    .select("id")
    .eq("company_id", companyId)
    .eq("user_id", workerUid)
    .maybeSingle();
  if (membershipError || !membership) {
    throw { code: "not-found", message: "Worker record not found in company workers list", httpStatus: 404 };
  }

  if (action === "delete") {
    const { error: deleteError } = await supabase
      .from("company_memberships")
      .delete()
      .eq("id", membership.id)
      .eq("company_id", companyId);
    if (deleteError) {
      throw { code: "internal", message: "Failed to delete worker", httpStatus: 500 };
    }

    await bumpCompanySyncVersion(companyId, "workers_version", ctx);
    return { success: true, message: "Worker account deleted successfully" };
  }

  const name = payload?.name !== undefined ? optionalTrimmedString(payload?.name, 200) : undefined;
  const phoneNumber = payload?.phoneNumber !== undefined ? optionalTrimmedString(payload?.phoneNumber, 40) : undefined;
  const role = payload?.role !== undefined ? normalizeRole(payload?.role) : undefined;
  if (payload?.role !== undefined && (!role || !["worker", "user", "basic"].includes(role))) {
    throw { code: "invalid-argument", message: "Cannot assign the requested role", httpStatus: 400 };
  }
  if (name === undefined && phoneNumber === undefined && role === undefined) {
    throw { code: "invalid-argument", message: "At least one field must be provided for update", httpStatus: 400 };
  }

  const membershipPatch: Record<string, unknown> = { updated_at: now };
  if (name !== undefined) membershipPatch.display_name = name || null;
  if (phoneNumber !== undefined) membershipPatch.phone_number = phoneNumber || null;
  if (role !== undefined) membershipPatch.role = role;

  const { error: updateMembershipError } = await supabase
    .from("company_memberships")
    .update(membershipPatch)
    .eq("id", membership.id)
    .eq("company_id", companyId);
  if (updateMembershipError) {
    throw { code: "internal", message: "Failed to update worker membership", httpStatus: 500 };
  }

  const appUserPatch: Record<string, unknown> = { updated_at: now };
  if (name !== undefined) appUserPatch.display_name = name || null;
  if (phoneNumber !== undefined) appUserPatch.phone_number = phoneNumber || null;
  const { error: appUserUpdateError } = await supabase.from("app_users").update(appUserPatch).eq("id", workerUid);
  if (appUserUpdateError) {
    throw { code: "internal", message: "Failed to update worker profile", httpStatus: 500 };
  }

  await bumpCompanySyncVersion(companyId, "workers_version", ctx);
  return { success: true, message: "Worker account updated successfully" };
}

export async function registerBusinessV1(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  if (!ctx.auth?.uid) {
    throw { code: "unauthenticated", message: "Authentication required", httpStatus: 401 };
  }

  const role = normalizeRole(payload?.role);
  if (!role || !["manager", "user", "basic"].includes(role)) {
    throw { code: "invalid-argument", message: "role must be manager, user, or basic", httpStatus: 400 };
  }

  const accountType = normalizeAccountType(payload?.accountType);
  if (!accountType) {
    throw { code: "invalid-argument", message: "accountType must be solo or business", httpStatus: 400 };
  }

  const validTuple =
    (role === "manager" && accountType === "business") ||
    (role === "user" && accountType === "solo") ||
    (role === "basic" && accountType === "solo");
  if (!validTuple) {
    throw {
      code: "invalid-argument",
      message: "Invalid role/accountType combination. Allowed: manager+business, user+solo, basic+solo",
      httpStatus: 400,
    };
  }

  const name = optionalTrimmedString(payload?.name, 200) || "";
  const phoneNumber = optionalTrimmedString(payload?.phoneNumber, 40) || null;
  const now = new Date().toISOString();

  const heName = accountType === "solo"
    ? optionalTrimmedString(payload?.he_name || payload?.name, 200)
    : requireNonEmptyString(payload?.he_name, "he_name", 1, 200);
  const enName = optionalTrimmedString(payload?.en_name, 200) || null;
  const vatNumber = accountType === "solo"
    ? optionalTrimmedString(payload?.vat_number, 50)
    : requireNonEmptyString(payload?.vat_number, "vat_number", 1, 50);
  const businessType = accountType === "solo"
    ? optionalTrimmedString(payload?.business_type || "solo", 120)
    : requireNonEmptyString(payload?.business_type, "business_type", 1, 120);
  const city = optionalTrimmedString(payload?.city, 120) || null;
  const address = optionalTrimmedString(payload?.address, 500) || null;
  const businessEmail = optionalTrimmedString(payload?.business_email, 320) || ctx.auth.email || null;
  const businessPhone = optionalTrimmedString(payload?.business_phone, 40) || null;
  const businessFax = optionalTrimmedString(payload?.business_fax, 40) || null;
  const accountantName = optionalTrimmedString(payload?.accountant_name, 200) || null;
  const accountantEmail = optionalTrimmedString(payload?.accountant_email, 320) || null;
  const accountantPhone = optionalTrimmedString(payload?.accountant_phone, 40) || null;

  const tier = tierForRole(role, accountType);
  const enabledModules = enabledModulesForTier(tier);

  const supabase = createSupabaseClient(ctx.env);

  // Ensure app user profile exists.
  const fallbackEmail = validateEmail(requireNonEmptyString(ctx.auth.email || payload?.business_email || payload?.email, "email", 5, 320)).toLowerCase();
  const { error: upsertSelfError } = await supabase
    .from("app_users")
    .upsert({
      id: ctx.auth.uid,
      email: fallbackEmail,
      display_name: name || null,
      phone_number: phoneNumber,
      system_role: null,
      updated_at: now,
    }, { onConflict: "id" });
  if (upsertSelfError) {
    throw { code: "internal", message: "Failed to upsert account profile", httpStatus: 500 };
  }

  // Allocate the next public company id atomically.
  const publicCompanyId = await allocateNextSystemCounter(
    "public_company_id",
    ctx,
    1001,
  );

  const { data: registeredRows, error: registerError } = await supabase.rpc("register_business_account", {
    p_public_company_id: publicCompanyId,
    p_account_type: accountType,
    p_created_by_user_id: ctx.auth.uid,
    p_he_name: heName || null,
    p_en_name: enName,
    p_vat_number: vatNumber || null,
    p_business_type: businessType || null,
    p_city: city,
    p_address: address,
    p_business_email: businessEmail,
    p_business_phone: businessPhone,
    p_business_fax: businessFax,
    p_accountant_name: accountantName,
    p_accountant_email: accountantEmail,
    p_accountant_phone: accountantPhone,
    p_tier: tier,
    p_enabled_modules: enabledModules,
    p_user_id: ctx.auth.uid,
    p_role: role,
    p_display_name: name || null,
    p_phone_number: phoneNumber,
    p_created_at: now,
  });

  if (registerError) {
    if (registerError.code === "23505" || String(registerError.message || "").includes("duplicate key")) {
      throw { code: "already-exists", message: "Company already registered", httpStatus: 409 };
    }
    ctx.logger.error("register_business_account failed", { error: registerError.message });
    throw { code: "internal", message: "Failed to create company", httpStatus: 500 };
  }

  const registeredRow = Array.isArray(registeredRows) ? registeredRows[0] : registeredRows;
  if (!registeredRow?.public_company_id) {
    throw { code: "internal", message: "Failed to create company", httpStatus: 500 };
  }

  return {
    success: true,
    companyId: String(registeredRow.public_company_id),
    role,
    tier,
  };
}
