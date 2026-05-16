import {
  EdgeFunctionContext,
  assertCompanyAccess,
  bumpCompanySyncVersion,
  createSupabaseClient,
  optionalTrimmedString,
  requireNonEmptyString,
  resolveCompanyIdentifiers,
  validateCompanyId,
} from "../shared-edge-helpers.ts";

async function resolveOptionalCompanyScope(
  uid: string,
  companyIdRaw: unknown,
  ctx: EdgeFunctionContext,
): Promise<{ internalCompanyId: string; publicCompanyId: string } | null> {
  const companyId = optionalTrimmedString(companyIdRaw, 64);
  if (!companyId) return null;
  const normalized = validateCompanyId(companyId);
  await assertCompanyAccess(uid, normalized, [], ctx);
  return resolveCompanyIdentifiers(normalized, ctx.env);
}

export async function updateProfileV1(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  if (!ctx.auth?.uid) {
    throw { code: "unauthenticated", message: "Authentication required", httpStatus: 401 };
  }

  const displayName = payload?.displayName !== undefined
    ? optionalTrimmedString(payload.displayName, 200) || null
    : undefined;
  const phoneNumber = payload?.phoneNumber !== undefined
    ? optionalTrimmedString(payload.phoneNumber, 40) || null
    : undefined;

  if (displayName === undefined && phoneNumber === undefined) {
    throw {
      code: "invalid-argument",
      message: "At least one field (displayName or phoneNumber) is required",
      httpStatus: 400,
    };
  }

  const companyScope = await resolveOptionalCompanyScope(ctx.auth.uid, payload?.companyId, ctx);

  const supabase = createSupabaseClient(ctx.env);
  const now = new Date().toISOString();
  const userPatch: Record<string, unknown> = { updated_at: now };
  if (displayName !== undefined) userPatch.display_name = displayName;
  if (phoneNumber !== undefined) userPatch.phone_number = phoneNumber;

  const { data: updatedUser, error: userError } = await supabase
    .from("app_users")
    .update(userPatch)
    .eq("id", ctx.auth.uid)
    .select("id, email, display_name, phone_number, system_role, updated_at")
    .single();

  if (userError || !updatedUser) {
    throw { code: "internal", message: "Failed to update profile", httpStatus: 500 };
  }

  if (companyScope) {
    const membershipPatch: Record<string, unknown> = { updated_at: now };
    if (displayName !== undefined) membershipPatch.display_name = displayName;
    if (phoneNumber !== undefined) membershipPatch.phone_number = phoneNumber;

    const { error: membershipError } = await supabase
      .from("company_memberships")
      .update(membershipPatch)
      .eq("company_id", companyScope.internalCompanyId)
      .eq("user_id", ctx.auth.uid)
      .eq("status", "active");

    if (membershipError) {
      ctx.logger.warn("Profile update could not sync to company membership", {
        error: membershipError.message,
        companyId: companyScope.publicCompanyId,
      });
    }
  }

  return {
    uid: updatedUser.id,
    displayName: updatedUser.display_name,
    phoneNumber: updatedUser.phone_number,
    email: updatedUser.email,
    role: updatedUser.system_role,
    companyId: companyScope?.publicCompanyId || null,
    updatedAt: updatedUser.updated_at,
  };
}

export async function updatePushTokenV1(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  if (!ctx.auth?.uid) {
    throw { code: "unauthenticated", message: "Authentication required", httpStatus: 401 };
  }

  const token = requireNonEmptyString(payload?.token, "token", 8, 500);
  const platform = optionalTrimmedString(payload?.platform, 32) || null;

  const supabase = createSupabaseClient(ctx.env);
  const now = new Date().toISOString();
  const { data: updatedUser, error } = await supabase
    .from("app_users")
    .update({
      push_token: token,
      push_token_platform: platform,
      push_token_updated_at: now,
      updated_at: now,
    })
    .eq("id", ctx.auth.uid)
    .select("id, push_token, push_token_platform, push_token_updated_at, updated_at")
    .single();

  if (error || !updatedUser) {
    throw { code: "internal", message: "Failed to update push token", httpStatus: 500 };
  }

  return {
    uid: updatedUser.id,
    token: updatedUser.push_token,
    platform: updatedUser.push_token_platform,
    pushTokenUpdatedAt: updatedUser.push_token_updated_at,
    updatedAt: updatedUser.updated_at,
  };
}

export async function clearPushTokenV1(_payload: any, ctx: EdgeFunctionContext): Promise<any> {
  if (!ctx.auth?.uid) {
    throw { code: "unauthenticated", message: "Authentication required", httpStatus: 401 };
  }

  const supabase = createSupabaseClient(ctx.env);
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("app_users")
    .update({
      push_token: null,
      push_token_platform: null,
      push_token_updated_at: null,
      updated_at: now,
    })
    .eq("id", ctx.auth.uid);

  if (error) {
    throw { code: "internal", message: "Failed to clear push token", httpStatus: 500 };
  }

  return { uid: ctx.auth.uid, cleared: true };
}

export async function updateBusinessInfoV1(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  if (!ctx.auth?.uid) {
    throw { code: "unauthenticated", message: "Authentication required", httpStatus: 401 };
  }

  const companyId = validateCompanyId(payload?.companyId);
  await assertCompanyAccess(ctx.auth.uid, companyId, ["manager", "dev"], ctx);
  const resolvedCompany = await resolveCompanyIdentifiers(companyId, ctx.env);

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { last_updated_at: now };

  const fieldMap: Record<string, string> = {
    he_name: "he_name",
    en_name: "en_name",
    business_type: "business_type",
    city: "city",
    address: "address",
    business_email: "business_email",
    business_phone: "business_phone",
    business_fax: "business_fax",
    accountant_name: "accountant_name",
    accountant_email: "accountant_email",
    accountant_phone: "accountant_phone",
  };

  if (payload?.vat_number !== undefined) {
    throw {
      code: "invalid-argument",
      message: "vat_number is immutable after onboarding",
      httpStatus: 400,
    };
  }

  for (const [source, target] of Object.entries(fieldMap)) {
    if (payload?.[source] !== undefined) {
      patch[target] = optionalTrimmedString(payload[source], 500) || null;
    }
  }

  if (Object.keys(patch).length === 1) {
    throw {
      code: "invalid-argument",
      message: "No business info fields were provided",
      httpStatus: 400,
    };
  }

  const supabase = createSupabaseClient(ctx.env);
  const { data: updatedProfile, error: updateError } = await supabase
    .from("company_profiles")
    .update(patch)
    .eq("company_id", resolvedCompany.internalCompanyId)
    .select("company_id, he_name, en_name, vat_number, business_type, city, address, business_email, business_phone, business_fax, accountant_name, accountant_email, accountant_phone, last_updated_at")
    .single();

  if (updateError || !updatedProfile) {
    throw { code: "internal", message: "Failed to update business info", httpStatus: 500 };
  }

  return {
    companyId: resolvedCompany.publicCompanyId,
    he_name: updatedProfile.he_name,
    en_name: updatedProfile.en_name,
    vat_number: updatedProfile.vat_number,
    business_type: updatedProfile.business_type,
    city: updatedProfile.city,
    address: updatedProfile.address,
    business_email: updatedProfile.business_email,
    business_phone: updatedProfile.business_phone,
    business_fax: updatedProfile.business_fax,
    accountant_name: updatedProfile.accountant_name,
    accountant_email: updatedProfile.accountant_email,
    accountant_phone: updatedProfile.accountant_phone,
    updatedAt: updatedProfile.last_updated_at,
  };
}

export async function updateCacheV1(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  if (!ctx.auth?.uid) {
    throw { code: "unauthenticated", message: "Authentication required", httpStatus: 401 };
  }

  const companyId = validateCompanyId(payload?.companyId);
  await assertCompanyAccess(ctx.auth.uid, companyId, [], ctx);
  const resolvedCompany = await resolveCompanyIdentifiers(companyId, ctx.env);

  const requestedField = requireNonEmptyString(payload?.field, "field", 3, 64).toLowerCase();
  const aliasMap: Record<string, string> = {
    profile: "workers",
    inventory: "company_inventory",
    company_inventory: "company_inventory",
    workers: "workers",
    clients: "clients",
    jobs: "jobs",
    documents: "documents",
  };

  const canonicalField = aliasMap[requestedField];
  if (!canonicalField) {
    throw {
      code: "invalid-argument",
      httpStatus: 400,
      message: "field must be one of profile, inventory, company_inventory, workers, clients, jobs, documents",
    };
  }

  const versionFieldMap: Record<string, string> = {
    jobs: "jobs_version",
    documents: "documents_version",
    clients: "clients_version",
    workers: "workers_version",
    company_inventory: "company_inventory_version",
  };

  const versionField = versionFieldMap[canonicalField];
  const now = new Date().toISOString();
  await bumpCompanySyncVersion(
    resolvedCompany.internalCompanyId,
    versionField as "jobs_version" | "documents_version" | "clients_version" | "workers_version" | "company_inventory_version",
    ctx,
  );

  return {
    companyId: resolvedCompany.publicCompanyId,
    updatedFields: [canonicalField],
    updatedAt: now,
  };
}
