/**
 * Tax Handler Module
 * Phase: 2 | Status: Implemented (partial)
 */
import {
  claimIdempotency,
  recordIdempotencyResult,
  EdgeFunctionContext,
  createSupabaseClient,
  optionalTrimmedString,
  requireNonEmptyString,
  resolveCompanyIdentifiers,
  validateCompanyId,
} from "../shared-edge-helpers.ts";
import { publishGenerateTask } from "./documents.ts";

const TAX_INVOICE_TYPE = 305;

async function requireTaxManagerOrDev(
  companyId: string,
  ctx: EdgeFunctionContext,
): Promise<{ membershipId: string; membershipRole: string }> {
  if (!ctx.auth?.uid) {
    throw { code: "unauthenticated", message: "Authentication required", httpStatus: 401 };
  }

  const supabase = createSupabaseClient(ctx.env);
  const { data: user } = await supabase
    .from("app_users")
    .select("system_role")
    .eq("id", ctx.auth.uid)
    .maybeSingle();
  if (String(user?.system_role || "").toLowerCase() === "dev") {
    return { membershipId: "dev", membershipRole: "dev" };
  }

  const { data: membership, error } = await supabase
    .from("company_memberships")
    .select("id, role")
    .eq("company_id", companyId)
    .eq("user_id", ctx.auth.uid)
    .eq("status", "active")
    .single();

  if (error || !membership || String(membership.role) !== "manager") {
    throw { code: "permission-denied", message: "Manager role required for tax operations", httpStatus: 403 };
  }

  return {
    membershipId: String(membership.id),
    membershipRole: String(membership.role),
  };
}

export async function getInvoiceApproval(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  const requestedCompanyId = validateCompanyId(payload?.companyId);
  const resolvedCompany = await resolveCompanyIdentifiers(requestedCompanyId, ctx.env);
  const companyId = resolvedCompany.internalCompanyId;
  const publicCompanyId = resolvedCompany.publicCompanyId;
  const idempotencyKey = requireNonEmptyString(payload?.idempotencyKey, "idempotencyKey", 8, 256);
  await requireTaxManagerOrDev(companyId, ctx);

  const idempotencyExpireAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const claim = await claimIdempotency(
    idempotencyKey,
    ctx.auth!.uid,
    "getInvoiceApproval",
    ctx,
    { companyId: publicCompanyId, expireAt: idempotencyExpireAt },
  );
  if (claim.status === "approved") {
    return claim.result;
  }
  if (claim.status === "in_progress") {
    throw {
      code: "already-exists",
      httpStatus: 409,
      message: "An equivalent request is already in progress",
    };
  }

  try {
    const supabase = createSupabaseClient(ctx.env);
    const now = new Date().toISOString();
    const client = payload?.client && typeof payload.client === "object" && !Array.isArray(payload.client)
      ? payload.client as Record<string, unknown>
      : {};
    const items: unknown[] = Array.isArray(payload?.items) ? payload.items : [];
    if (items.length === 0) {
      throw { code: "invalid-argument", message: "items must contain at least one line", httpStatus: 400 };
    }

    const totalBeforeVat = items.reduce((sum: number, item: unknown) => {
      const lineItem = item && typeof item === "object" && !Array.isArray(item)
        ? item as Record<string, unknown>
        : {};
      const quantity = Number(lineItem.quantity || 0);
      const price = Number(lineItem.price || 0);
      return sum + (Number.isFinite(quantity) ? quantity : 0) * (Number.isFinite(price) ? price : 0);
    }, 0);
    const vatAmount = Math.round(totalBeforeVat * 0.18 * 100) / 100;
    const totalWithVat = Math.round((totalBeforeVat + vatAmount) * 100) / 100;

    const publishResult = await publishGenerateTask({
      companyId: publicCompanyId,
      documentType: TAX_INVOICE_TYPE,
      idempotencyKey,
      documentData: {
        type: TAX_INVOICE_TYPE,
        client,
        items,
        language: optionalTrimmedString(payload?.language, 8) || "he",
        date: optionalTrimmedString(payload?.date, 64) || new Date().toISOString().slice(0, 10),
        notes: optionalTrimmedString(payload?.notes, 4000) || "",
        jobsData: Array.isArray(payload?.jobsData) ? payload.jobsData : undefined,
        priceProposalId: optionalTrimmedString(payload?.priceProposalId, 128) || null,
        totalBeforeVat,
        vatAmount,
        totalWithVat,
      },
    }, ctx);

    const publicDocumentId = optionalTrimmedString(publishResult?.documentId, 128);
    if (!publicDocumentId) {
      throw { code: "internal", message: "Failed to prepare tax invoice document", httpStatus: 500 };
    }

    const { data: documentRow, error: documentError } = await supabase
      .from("documents")
      .select("id, document_number, document_code, client_name_snapshot")
      .eq("company_id", companyId)
      .eq("document_code", publicDocumentId)
      .single();

    if (documentError || !documentRow?.id) {
      throw { code: "internal", message: "Draft tax invoice document could not be loaded", httpStatus: 500 };
    }

    const documentNumber = Number(documentRow.document_number || 0);

    const { data: existingReservation } = await supabase
      .from("tax_invoice_reservations")
      .select("id")
      .eq("company_id", companyId)
      .eq("document_id", documentRow.id)
      .maybeSingle();

    if (!existingReservation?.id) {
      const { error: reservationError } = await supabase.from("tax_invoice_reservations").insert({
        company_id: companyId,
        document_id: documentRow.id,
        document_number: documentNumber,
        status: "reserved",
        reserved_by_user_id: ctx.auth?.uid || null,
        client_name_snapshot: optionalTrimmedString(documentRow.client_name_snapshot, 240) || null,
        status_payload: { source: "supabase-edge", stage: "reservation" },
        created_at: now,
        updated_at: now,
      });
      if (reservationError) {
        throw { code: "internal", message: "Failed to create tax reservation", httpStatus: 500 };
      }
    }

    const { error: documentPatchError } = await supabase
      .from("documents")
      .update({
        tax_authority_status: "reserved",
        updated_at: now,
      })
      .eq("company_id", companyId)
      .eq("id", documentRow.id);
    if (documentPatchError) {
      throw { code: "internal", message: "Failed to reserve tax invoice", httpStatus: 500 };
    }

    const resultPayload = {
      success: true,
      status: "reserved",
      companyId: publicCompanyId,
      documentId: publicDocumentId,
      documentNumber,
      pdfTaskId: optionalTrimmedString(publishResult?.taskId, 160) || undefined,
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
        expireAt: idempotencyExpireAt,
      },
    );

    return resultPayload;
  } catch (error) {
    const caught = error as { code?: string; message?: string };
    await recordIdempotencyResult(
      idempotencyKey,
      ctx.auth!.uid,
      "getInvoiceApproval",
      {
        success: false,
        code: String(caught.code || "internal"),
        message: String(caught.message || "Tax invoice approval failed"),
      },
      ctx,
      {
        companyId: publicCompanyId,
        status: "failed",
        expireAt: idempotencyExpireAt,
      },
    );
    throw error;
  }
}

export async function taxAuthorityCallbackV1(payload: any, ctx: EdgeFunctionContext): Promise<any> {
  throw { code: "unavailable", httpStatus: 501, message: "taxAuthorityCallbackV1 not implemented in handler; use /tax/callback endpoint" };
}
