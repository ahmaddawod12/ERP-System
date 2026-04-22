const TAX_INVOICE_TYPE = 305;

function roundCurrency(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function coerceTrimmedString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function coerceOptionalString(value) {
  const trimmed = coerceTrimmedString(value);
  return trimmed || null;
}

function normalizeInvoiceDate(value, fallbackDate = new Date().toISOString().slice(0, 10)) {
  const fallback = coerceTrimmedString(fallbackDate) || new Date().toISOString().slice(0, 10);
  const candidate = coerceTrimmedString(value);
  if (!candidate) {
    return fallback;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    return fallback;
  }

  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }

  return parsed.toISOString().slice(0, 10) === candidate ? candidate : fallback;
}

function getClientVatNumber(client: any = {}) {
  const candidates = [
    client.clientVatNumber,
    client.customerVatNumber,
    client.vatNumber,
    client.vat_number,
  ];

  for (const candidate of candidates) {
    const trimmed = coerceTrimmedString(candidate);
    if (trimmed) {
      return trimmed;
    }
  }

  return '';
}

function normalizeTaxInvoiceClient(client: any = {}) {
  const clientVatNumber = getClientVatNumber(client);
  const clientId = coerceTrimmedString(client.clientId || client.id);
  const normalized = {
    name: coerceTrimmedString(client.name),
    email: coerceTrimmedString(client.email),
    phone: coerceTrimmedString(client.phone),
    address: coerceTrimmedString(client.address),
    city: coerceTrimmedString(client.city),
    id: coerceTrimmedString(client.id) || clientId,
    clientId,
  } as any;

  if (clientVatNumber) {
    normalized.clientVatNumber = clientVatNumber;
    normalized.customerVatNumber = clientVatNumber;
    normalized.vatNumber = clientVatNumber;
  }

  return normalized;
}

function buildStoredTaxInvoiceDocument({
  uid,
  documentId,
  documentNumber,
  client,
  items,
  language,
  date,
  notes,
  jobsData,
  priceProposalId,
  totalBeforeVat,
  vatAmount,
  totalWithVat,
  confirmationNumber,
  responseData,
  submittedAt,
}) {
  const normalizedClient = normalizeTaxInvoiceClient(client);
  const createdAt = coerceTrimmedString(submittedAt) || new Date().toISOString();
  const normalizedDate = normalizeInvoiceDate(date);
  const normalizedItems = Array.isArray(items) ? items : [];
  const normalizedLanguage = coerceTrimmedString(language) || 'he';
  const normalizedConfirmationNumber = coerceOptionalString(confirmationNumber);
  const normalizedJobsData = Array.isArray(jobsData) ? jobsData : null;
  const normalizedPriceProposalId = coerceOptionalString(priceProposalId);

  const normalizedDocumentData = {
    type: TAX_INVOICE_TYPE,
    documentNumber: documentNumber ?? null,
    client: normalizedClient,
    items: normalizedItems,
    language: normalizedLanguage,
    date: normalizedDate,
    notes: coerceOptionalString(notes),
    jobsData: normalizedJobsData,
    priceProposalId: normalizedPriceProposalId,
    taxAuthorityConfirmationNumber: normalizedConfirmationNumber,
    totals: {
      totalBeforeVat: roundCurrency(totalBeforeVat),
      vatAmount: roundCurrency(vatAmount),
      totalWithVat: roundCurrency(totalWithVat),
    },
  };

  return {
    type: TAX_INVOICE_TYPE,
    documentType: TAX_INVOICE_TYPE,
    documentId: coerceOptionalString(documentId),
    documentNumber: documentNumber ?? null,
    cname: normalizedClient.name || null,
    cphone: normalizedClient.phone || null,
    clientCity: normalizedClient.city || null,
    clientVatNumber: normalizedClient.clientVatNumber || null,
    cid: normalizedClient.clientId || normalizedClient.id || null,
    date: normalizedDate,
    items: normalizedItems,
    language: normalizedLanguage,
    notes: coerceOptionalString(notes),
    createdByUid: uid,
    createdAt,
    jobsData: normalizedJobsData,
    priceProposalId: normalizedPriceProposalId,
    itemCount: normalizedItems.length,
    totalBeforeVat: roundCurrency(totalBeforeVat),
    vatAmount: roundCurrency(vatAmount),
    totalWithVat: roundCurrency(totalWithVat),
    confirmationNumber: normalizedConfirmationNumber,
    taxAuthorityConfirmationNumber: normalizedConfirmationNumber,
    taxAuthoritySubmittedAt: createdAt,
    taxAuthorityResponseData: responseData || null,
    documentData: normalizedDocumentData,
  };
}

export { TAX_INVOICE_TYPE, buildStoredTaxInvoiceDocument, getClientVatNumber, normalizeInvoiceDate, normalizeTaxInvoiceClient, roundCurrency };
