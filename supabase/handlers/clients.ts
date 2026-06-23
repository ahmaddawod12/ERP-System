/**
 * Clients Handler Module
 * Phase: 2 | Status: Implemented
 */
import {
  allocateNextCompanyCounter,
  assertModuleEnabled,
  bumpCompanySyncVersion,
  EdgeFunctionContext,
  createSupabaseClient,
  optionalTrimmedString,
  requireNonEmptyString,
  resolveCompanyIdentifiers,
  validateCompanyId,
  validateEmail,
} from "../shared-edge-helpers.ts";

async function requireActiveMembership(
  companyId: string,
  ctx: EdgeFunctionContext,
): Promise<{ id: string }> {
  if (!ctx.auth?.uid) {
    throw { code: "unauthenticated", message: "Authentication required", httpStatus: 401 };
  }

  const supabase = createSupabaseClient(ctx.env);
  const { data: membership, error } = await supabase
    .from("company_memberships")
    .select("id")
    .eq("company_id", companyId)
    .eq("user_id", ctx.auth.uid)
    .eq("status", "active")
    .single();

  if (error || !membership) {
    throw { code: "permission-denied", message: "Not allowed for this company", httpStatus: 403 };
  }

  return membership;
}

export async function addClientV1(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  const requestedCompanyId = validateCompanyId(payload?.companyId);
  const resolvedCompany = await resolveCompanyIdentifiers(requestedCompanyId, ctx.env);
  const companyId = resolvedCompany.internalCompanyId;
  await assertModuleEnabled(companyId, "clients", ctx);
  const name = requireNonEmptyString(payload?.name, "name", 1, 240);
  const phone = optionalTrimmedString(payload?.phone, 40);
  const email = payload?.email !== undefined && String(payload.email).trim() !== ""
    ? validateEmail(payload.email)
    : undefined;
  const address = optionalTrimmedString(payload?.address, 500);
  const city = optionalTrimmedString(payload?.city, 120);
  const vatNumber = optionalTrimmedString(payload?.vatNumber ?? payload?.vat_number, 32);
  const notes = optionalTrimmedString(payload?.notes, 2000);

  const membership = await requireActiveMembership(companyId, ctx);
  const supabase = createSupabaseClient(ctx.env);

  const clientNo = await allocateNextCompanyCounter(companyId, "client_no", ctx);
  const now = new Date().toISOString();

  const { data: insertedClient, error: insertError } = await supabase
    .from("clients")
    .insert({
      company_id: companyId,
      client_no: clientNo,
      status: "active",
      name,
      phone,
      email,
      address,
      city,
      vat_number: vatNumber,
      notes,
      created_by_membership_id: membership.id,
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();

  if (insertError || !insertedClient) {
    throw { code: "internal", message: "Failed to create client", httpStatus: 500 };
  }

  await bumpCompanySyncVersion(companyId, "clients_version", ctx);

  return {
    clientId: insertedClient.id,
    clientNo: insertedClient.client_no,
    name: insertedClient.name,
    phone: insertedClient.phone ?? undefined,
    email: insertedClient.email ?? undefined,
    address: insertedClient.address ?? undefined,
    city: insertedClient.city ?? undefined,
    vatNumber: insertedClient.vat_number ?? undefined,
    vat_number: insertedClient.vat_number ?? undefined,
    notes: insertedClient.notes ?? undefined,
    status: insertedClient.status,
    createdAt: insertedClient.created_at,
  };
}

export async function updateClientV1(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  const requestedCompanyId = validateCompanyId(payload?.companyId);
  const resolvedCompany = await resolveCompanyIdentifiers(requestedCompanyId, ctx.env);
  const companyId = resolvedCompany.internalCompanyId;
  await assertModuleEnabled(companyId, "clients", ctx);
  const clientId = requireNonEmptyString(payload?.clientId, "clientId", 1, 120);
  await requireActiveMembership(companyId, ctx);

  const update: Record<string, any> = { updated_at: new Date().toISOString() };
  if (payload?.name !== undefined) update.name = requireNonEmptyString(payload.name, "name", 1, 240);
  if (payload?.phone !== undefined) update.phone = optionalTrimmedString(payload.phone, 40) ?? null;
  if (payload?.email !== undefined) update.email = payload.email ? validateEmail(payload.email) : null;
  if (payload?.address !== undefined) update.address = optionalTrimmedString(payload.address, 500) ?? null;
  if (payload?.city !== undefined) update.city = optionalTrimmedString(payload.city, 120) ?? null;
  if (payload?.vatNumber !== undefined || payload?.vat_number !== undefined) {
    update.vat_number = optionalTrimmedString(payload.vatNumber ?? payload.vat_number, 32) ?? null;
  }
  if (payload?.notes !== undefined) update.notes = optionalTrimmedString(payload.notes, 2000) ?? null;
  if (payload?.status !== undefined) {
    if (payload.status !== "active" && payload.status !== "archived") {
      throw { code: "invalid-argument", message: "status must be active or archived", httpStatus: 400 };
    }
    update.status = payload.status;
    update.archived_at = payload.status === "archived" ? new Date().toISOString() : null;
  }

  if (Object.keys(update).length === 1) {
    throw { code: "invalid-argument", message: "No fields to update", httpStatus: 400 };
  }

  const supabase = createSupabaseClient(ctx.env);
  const { data: updatedClient, error: updateError } = await supabase
    .from("clients")
    .update(update)
    .eq("id", clientId)
    .eq("company_id", companyId)
    .select()
    .single();

  if (updateError || !updatedClient) {
    if (updateError?.code === "PGRST116") {
      throw { code: "not-found", message: "Client not found", httpStatus: 404 };
    }
    throw { code: "internal", message: "Failed to update client", httpStatus: 500 };
  }

  await bumpCompanySyncVersion(companyId, "clients_version", ctx);

  return {
    clientId: updatedClient.id,
    clientNo: updatedClient.client_no,
    name: updatedClient.name,
    phone: updatedClient.phone ?? undefined,
    email: updatedClient.email ?? undefined,
    address: updatedClient.address ?? undefined,
    city: updatedClient.city ?? undefined,
    vatNumber: updatedClient.vat_number ?? undefined,
    vat_number: updatedClient.vat_number ?? undefined,
    notes: updatedClient.notes ?? undefined,
    status: updatedClient.status,
    createdAt: updatedClient.created_at,
    updatedAt: updatedClient.updated_at,
  };
}

export async function deleteClientV1(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  const requestedCompanyId = validateCompanyId(payload?.companyId);
  const resolvedCompany = await resolveCompanyIdentifiers(requestedCompanyId, ctx.env);
  const companyId = resolvedCompany.internalCompanyId;
  await assertModuleEnabled(companyId, "clients", ctx);
  const clientId = requireNonEmptyString(payload?.clientId, "clientId", 1, 120);
  await requireActiveMembership(companyId, ctx);

  const supabase = createSupabaseClient(ctx.env);

  const [{ data: linkedJobs }, { data: linkedDocuments }] = await Promise.all([
    supabase.from("jobs").select("id").eq("company_id", companyId).eq("client_id", clientId).limit(1),
    supabase.from("documents").select("id").eq("company_id", companyId).eq("client_id", clientId).limit(1),
  ]);
  if ((linkedJobs || []).length > 0) {
    throw { code: "failed-precondition", message: "Cannot delete a client that has linked jobs", httpStatus: 400 };
  }
  if ((linkedDocuments || []).length > 0) {
    throw { code: "failed-precondition", message: "Cannot delete a client that has linked documents", httpStatus: 400 };
  }

  const { data: deletedClient, error: deleteError } = await supabase
    .from("clients")
    .delete()
    .eq("id", clientId)
    .eq("company_id", companyId)
    .select("id")
    .single();

  if (deleteError || !deletedClient) {
    if (deleteError?.code === "PGRST116") {
      throw { code: "not-found", message: "Client not found", httpStatus: 404 };
    }
    throw { code: "internal", message: "Failed to delete client", httpStatus: 500 };
  }

  await bumpCompanySyncVersion(companyId, "clients_version", ctx);

  return { deleted: true };
}
