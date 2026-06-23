/**
 * Tax Handler Module
 * Phase: 2 | Status: Implemented (partial)
 */
import {
  claimIdempotency,
  recordIdempotencyResult,
  bumpCompanySyncVersion,
  EdgeFunctionContext,
  createSupabaseClient,
  allocateNextCompanyCounter,
  dispatchCloudRunPdfTask,
  optionalTrimmedString,
  requireNonEmptyString,
  resolveCompanyIdentifiers,
  validateCompanyId,
} from "../shared-edge-helpers.ts";
import { DocType, VAT_RATE } from "@smart-job/contracts";
import { buildPublicDocumentId, createOrReuseDocumentTask } from "./documents.ts";

const TAX_INVOICE_TYPE = DocType.TaxInvoice;

function parseDocumentDate(value: unknown, fieldName: string): string | null {
  const raw = optionalTrimmedString(value, 64);
  if (!raw) return null;
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) {
    throw { code: "invalid-argument", message: `${fieldName} must be a valid ISO date`, httpStatus: 400 };
  }
  return new Date(ts).toISOString();
}

async function requireTaxManagerOrDev(
  companyId: string,
  ctx: EdgeFunctionContext,
): Promise<{ membershipId: string; membershipRole: string }> {
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
    return { membershipId: "dev", membershipRole: "dev" };
  }

  if (error || !membership || String(membership.role) !== "manager") {
    throw { code: "permission-denied", message: "Manager role required for tax operations", httpStatus: 403 };
  }

  return {
    membershipId: String(membership.id),
    membershipRole: String(membership.role),
  };
}

async function findExistingReservedTaxInvoice(
  companyId: string,
  idempotencyKey: string,
  ctx: EdgeFunctionContext,
): Promise<{
  internalDocumentId: string;
  publicDocumentId: string;
  documentNumber: number;
  taskKey: string | null;
} | null> {
  const supabase = createSupabaseClient(ctx.env);
  const { data, error } = await supabase
    .from("tax_invoice_reservations")
    .select("document_id, document_number, status_payload, documents!inner(document_code)")
    .eq("company_id", companyId)
    .eq("status", "reserved")
    .contains("status_payload", { idempotencyKey })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const documentRow = Array.isArray(data?.documents) ? data.documents[0] : data?.documents;

  if (error || !data?.document_id || !documentRow?.document_code) {
    return null;
  }

  const taskKey = typeof data.status_payload?.taskKey === "string"
    ? String(data.status_payload.taskKey).trim() || null
    : null;
  return {
    internalDocumentId: String(data.document_id),
    publicDocumentId: String(documentRow.document_code),
    documentNumber: Number(data.document_number || 0),
    taskKey,
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
    const vatAmount = Math.round(totalBeforeVat * VAT_RATE * 100) / 100;
    const totalWithVat = Math.round((totalBeforeVat + vatAmount) * 100) / 100;

    const existingReservation = await findExistingReservedTaxInvoice(companyId, idempotencyKey, ctx);

    const documentNumber = existingReservation?.documentNumber
      || await allocateNextCompanyCounter(companyId, `doc_${TAX_INVOICE_TYPE}`, ctx);
    const publicDocumentId = existingReservation?.publicDocumentId
      || buildPublicDocumentId(TAX_INVOICE_TYPE, documentNumber, publicCompanyId);

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

    let internalDocumentId = existingReservation?.internalDocumentId || null;
    if (!internalDocumentId) {
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
          document_date: parseDocumentDate(documentDate, "documentDate"),
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
      internalDocumentId = String(insertedDocument.id);
    }

    const reservationPayload = {
      source: "supabase-edge",
      stage: "reservation",
      idempotencyKey,
      publicDocumentId,
      documentId: publicDocumentId,
    };

    if (!existingReservation) {
      const { error: reservationError } = await supabase.from("tax_invoice_reservations").insert({
        company_id: companyId,
        document_id: internalDocumentId,
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
    }

    await bumpCompanySyncVersion(companyId, "documents_version", ctx);

    const task = await createOrReuseDocumentTask(
      companyId,
      ctx.auth?.uid || taxAccess.membershipId,
      "generate",
      TAX_INVOICE_TYPE,
      internalDocumentId,
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

    await supabase
      .from("tax_invoice_reservations")
      .update({
        status_payload: {
          ...reservationPayload,
          taskKey: task.task_key,
        },
        updated_at: now,
      })
      .eq("company_id", companyId)
      .eq("document_id", internalDocumentId)
      .eq("status", "reserved");

    if (task.isNew) {
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
    }

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
