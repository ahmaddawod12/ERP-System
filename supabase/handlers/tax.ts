/**
 * Tax Handler Module
 * Phase: 2 | Status: Implemented (partial)
 */
import {
  allocateNextCompanyCounter,
  checkIdempotency,
  recordIdempotencyResult,
  EdgeFunctionContext,
  createSupabaseClient,
  optionalTrimmedString,
  requireNonEmptyString,
  resolveCompanyIdentifiers,
  validateCompanyId,
} from "../shared-edge-helpers.ts";

const TAX_INVOICE_TYPE = 305;

async function requireTaxManagerOrDev(
  companyId: string,
  ctx: EdgeFunctionContext,
): Promise<void> {
  if (!ctx.auth?.uid) {
    throw { code: "unauthenticated", message: "Authentication required", httpStatus: 401 };
  }

  const supabase = createSupabaseClient(ctx.env);
  const { data: user } = await supabase
    .from("app_users")
    .select("system_role")
    .eq("id", ctx.auth.uid)
    .maybeSingle();
  if (String(user?.system_role || "").toLowerCase() === "dev") return;

  const { data: membership, error } = await supabase
    .from("company_memberships")
    .select("role")
    .eq("company_id", companyId)
    .eq("user_id", ctx.auth.uid)
    .eq("status", "active")
    .single();

  if (error || !membership || String(membership.role) !== "manager") {
    throw { code: "permission-denied", message: "Manager role required for tax operations", httpStatus: 403 };
  }
}

export async function getInvoiceApproval(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  const requestedCompanyId = validateCompanyId(payload?.companyId);
  const resolvedCompany = await resolveCompanyIdentifiers(requestedCompanyId, ctx.env);
  const companyId = resolvedCompany.internalCompanyId;
  const publicCompanyId = resolvedCompany.publicCompanyId;
  const documentId = requireNonEmptyString(payload?.documentId, "documentId", 3, 128);
  const idempotencyKey = requireNonEmptyString(payload?.idempotencyKey, "idempotencyKey", 8, 256);
  await requireTaxManagerOrDev(companyId, ctx);

  const cachedResult = await checkIdempotency(
    idempotencyKey,
    ctx.auth!.uid,
    "getInvoiceApproval",
    ctx,
    { companyId: publicCompanyId },
  );
  if (cachedResult) {
    return cachedResult;
  }

  const supabase = createSupabaseClient(ctx.env);
  const now = new Date().toISOString();

  const { data: documentRow, error: documentError } = await supabase
    .from("documents")
    .select("id, document_type, document_number, document_code, tax_authority_status, client_name_snapshot")
    .eq("company_id", companyId)
    .eq("id", documentId)
    .single();
  if (documentError || !documentRow) {
    throw { code: "not-found", message: "Document not found", httpStatus: 404 };
  }
  if (Number(documentRow.document_type) !== TAX_INVOICE_TYPE) {
    throw { code: "failed-precondition", message: "Only tax invoice documents are supported", httpStatus: 400 };
  }

  let documentNumber = Number(documentRow.document_number || 0);
  const needsNumbering = !Number.isInteger(documentNumber) || documentNumber <= 0;
  if (needsNumbering) {
    documentNumber = await allocateNextCompanyCounter(companyId, "doc_305", ctx);
  }
  const documentCode = optionalTrimmedString(documentRow.document_code, 64) || `TAX${documentNumber}-${publicCompanyId.slice(0, 8)}`;

  const updatePatch: Record<string, unknown> = {
    tax_authority_status: "reserved",
    updated_at: now,
  };
  if (needsNumbering) {
    updatePatch.document_number = documentNumber;
    updatePatch.document_code = documentCode;
  }

  await supabase
    .from("documents")
    .update(updatePatch)
    .eq("company_id", companyId)
    .eq("id", documentId);

  const { data: existingReservation } = await supabase
    .from("tax_invoice_reservations")
    .select("id")
    .eq("company_id", companyId)
    .eq("document_id", documentId)
    .maybeSingle();
  if (!existingReservation?.id) {
    await supabase.from("tax_invoice_reservations").insert({
      company_id: companyId,
      document_id: documentId,
      document_number: documentNumber,
      status: "reserved",
      reserved_by_user_id: ctx.auth?.uid || null,
      client_name_snapshot: optionalTrimmedString(documentRow.client_name_snapshot, 240) || null,
      status_payload: { source: "supabase-edge", stage: "reservation" },
      created_at: now,
      updated_at: now,
    });
  }

  const resultPayload = {
    success: true,
    status: "reserved",
    companyId: publicCompanyId,
    documentId,
    documentNumber,
    message: "Tax invoice reserved.",
  };

  await recordIdempotencyResult(
    idempotencyKey,
    ctx.auth!.uid,
    "getInvoiceApproval",
    resultPayload,
    ctx,
    {
      companyId: publicCompanyId,
      status: "approved",
      expireAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
  );

  return resultPayload;
}

export async function taxAuthorityCallbackV1(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  throw { code: "unavailable", httpStatus: 501, message: "taxAuthorityCallbackV1 not implemented in handler; use /tax/callback endpoint" };
}
