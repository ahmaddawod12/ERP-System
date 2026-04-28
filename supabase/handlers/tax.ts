/**
 * Tax Handler Module
 * Phase: 2 | Status: Implemented (partial)
 */
import {
  claimIdempotency,
  recordIdempotencyResult,
  EdgeFunctionContext,
  createSupabaseClient,
  allocateNextCompanyCounter,
  dispatchCloudRunPdfTask,
  optionalTrimmedString,
  requireNonEmptyString,
  resolveCompanyIdentifiers,
  validateCompanyId,
} from "../shared-edge-helpers.ts";
import { buildPublicDocumentId, createOrReuseDocumentTask } from "./documents.ts";

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
  const taxAccess = await requireTaxManagerOrDev(companyId, ctx);

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

    const documentNumber = await allocateNextCompanyCounter(companyId, `doc_${TAX_INVOICE_TYPE}`, ctx);
    const publicDocumentId = buildPublicDocumentId(TAX_INVOICE_TYPE, documentNumber, publicCompanyId);

    const documentPayload = {
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
    };

    const documentDate = optionalTrimmedString(documentPayload.date, 64);
    const { data: insertedDocument, error: documentInsertError } = await supabase
      .from("documents")
      .insert({
        company_id: companyId,
        document_type: TAX_INVOICE_TYPE,
        document_number: documentNumber,
        document_code: publicDocumentId,
        generation_status: "pending",
        tax_authority_status: "reserved",
        created_by_membership_id: taxAccess.membershipId,
        language: documentPayload.language,
        document_date: documentDate ? new Date(documentDate).toISOString() : null,
        notes: documentPayload.notes,
        total_before_vat: totalBeforeVat,
        vat_amount: vatAmount,
        total_with_vat: totalWithVat,
        client_name_snapshot: optionalTrimmedString(client.name, 240) || null,
        client_phone_snapshot: optionalTrimmedString(client.phone, 40) || null,
        client_city_snapshot: optionalTrimmedString(client.city, 120) || null,
        client_vat_snapshot: optionalTrimmedString(client.clientVatNumber ?? client.customerVatNumber ?? client.vatNumber, 32) || null,
        payload: documentPayload,
        created_at: now,
        updated_at: now,
      })
      .select("id")
      .single();

    if (documentInsertError || !insertedDocument?.id) {
      throw { code: "internal", message: "Failed to create tax invoice document", httpStatus: 500 };
    }

    const reservationPayload = {
      source: "supabase-edge",
      stage: "reservation",
      idempotencyKey,
      publicDocumentId,
      documentId: publicDocumentId,
    };

    const { error: reservationError } = await supabase.from("tax_invoice_reservations").insert({
      company_id: companyId,
      document_id: insertedDocument.id,
      document_number: documentNumber,
      status: "reserved",
      reserved_by_user_id: ctx.auth?.uid || null,
      client_name_snapshot: optionalTrimmedString(client.name, 240) || null,
      status_payload: reservationPayload,
      created_at: now,
      updated_at: now,
    });
    if (reservationError) {
      throw { code: "internal", message: "Failed to create tax reservation", httpStatus: 500 };
    }

    const task = await createOrReuseDocumentTask(
      companyId,
      ctx.auth?.uid || taxAccess.membershipId,
      "generate",
      TAX_INVOICE_TYPE,
      String(insertedDocument.id),
      {
        companyId: publicCompanyId,
        documentType: TAX_INVOICE_TYPE,
        language: documentPayload.language,
        documentData: documentPayload,
        idempotencyKey,
        documentId: publicDocumentId,
        publicDocumentId,
      },
      ctx,
    );

    await dispatchCloudRunPdfTask("/generate", {
      taskId: task.task_key,
      documentType: TAX_INVOICE_TYPE,
      documentData: {
        ...documentPayload,
        documentNumber,
      },
      uid: ctx.auth?.uid || taxAccess.membershipId,
      companyId: publicCompanyId,
      documentId: publicDocumentId,
      documentNumber,
      confirmationNumber: undefined,
    }, ctx.env);

    const resultPayload = {
      success: true,
      status: "reserved",
      companyId: publicCompanyId,
      documentId: publicDocumentId,
      documentNumber,
      pdfTaskId: task.task_key,
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
