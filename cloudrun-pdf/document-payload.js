function coerceTrimmedString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function coerceOptionalString(value) {
  const trimmed = coerceTrimmedString(value);
  return trimmed || null;
}

function roundCurrency(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function normalizeClientVatNumber(client = {}) {
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

function normalizeDocumentClient(client = {}) {
  const clientVatNumber = normalizeClientVatNumber(client);
  const clientId = coerceTrimmedString(client.clientId || client.id);
  const normalized = {
    name: coerceTrimmedString(client.name),
    email: coerceTrimmedString(client.email),
    phone: coerceTrimmedString(client.phone),
    address: coerceTrimmedString(client.address),
    city: coerceTrimmedString(client.city),
    id: coerceTrimmedString(client.id) || clientId,
    clientId,
  };

  if (clientVatNumber) {
    normalized.clientVatNumber = clientVatNumber;
    normalized.customerVatNumber = clientVatNumber;
    normalized.vatNumber = clientVatNumber;
  }

  return normalized;
}

function normalizeDocumentData(documentType, documentData = {}, fallbackDocumentNumber) {
  const normalizedClient = normalizeDocumentClient(documentData.client || {});
  const normalizedDocumentNumber = documentData.documentNumber ?? fallbackDocumentNumber ?? null;
  const totals = documentData.totals || {};
  return {
    ...documentData,
    type: documentData.type || documentType,
    client: normalizedClient,
    documentNumber: normalizedDocumentNumber,
    language: coerceTrimmedString(documentData.language) || 'he',
    date: coerceOptionalString(documentData.date),
    notes: coerceOptionalString(documentData.notes),
    paymentMethod: coerceOptionalString(documentData.paymentMethod),
    paymentInfo: documentData.paymentInfo ?? null,
    invoiceReference: coerceOptionalString(documentData.invoiceReference),
    jobsData: Array.isArray(documentData.jobsData) ? documentData.jobsData : null,
    priceProposalId: coerceOptionalString(documentData.priceProposalId),
    taxAuthorityConfirmationNumber: coerceOptionalString(documentData.taxAuthorityConfirmationNumber),
    totals: {
      totalBeforeVat: roundCurrency(totals.totalBeforeVat),
      vatAmount: roundCurrency(totals.vatAmount),
      totalWithVat: roundCurrency(totals.totalWithVat),
    },
  };
}

function buildHtmlPayload({ documentType, documentData, documentNumber, logoUrl, confirmationNumber }) {
  const normalizedDocumentData = normalizeDocumentData(documentType, documentData, documentNumber);
  return {
    ...normalizedDocumentData,
    logoUrl,
    confirmationNumber:
      coerceOptionalString(confirmationNumber) ||
      normalizedDocumentData.taxAuthorityConfirmationNumber ||
      '',
  };
}

function normalizeStoredItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    price: item.price,
    partId: item.partId || item.id || null,
    id: item.partId || item.id || null,
  }));
}

function buildStoredDocumentRecord({
  documentType,
  documentData,
  uid,
  createdAt,
  totalBeforeVat,
  vatAmount,
  totalWithVat,
  storagePath,
  normalizedDocumentId,
}) {
  const normalizedDocumentData = normalizeDocumentData(documentType, documentData, normalizedDocumentId);
  const normalizedClient = normalizedDocumentData.client;
  const storedItems = normalizeStoredItems(normalizedDocumentData.items);
  const normalizedCreatedAt = coerceTrimmedString(createdAt) || new Date().toISOString();
  const normalizedConfirmationNumber = normalizedDocumentData.taxAuthorityConfirmationNumber;

  const record = {
    type: documentType,
    documentType,
    documentId: normalizedDocumentId,
    documentNumber: normalizedDocumentData.documentNumber,
    cname: normalizedClient.name || null,
    clientName: normalizedClient.name || null,
    cphone: normalizedClient.phone || null,
    clientPhone: normalizedClient.phone || null,
    clientEmail: normalizedClient.email || null,
    clientAddress: normalizedClient.address || null,
    clientCity: normalizedClient.city || null,
    clientVatNumber: normalizedClient.clientVatNumber || null,
    cid: normalizedClient.clientId || normalizedClient.id || null,
    clientId: normalizedClient.clientId || normalizedClient.id || null,
    items: storedItems,
    notes: normalizedDocumentData.notes,
    language: normalizedDocumentData.language,
    date: normalizedDocumentData.date,
    paymentMethod: normalizedDocumentData.paymentMethod,
    paymentInfo: normalizedDocumentData.paymentInfo,
    invoiceReference: normalizedDocumentData.invoiceReference,
    createdBy: uid,
    createdByUid: uid,
    createdAt: normalizedCreatedAt,
    totalBeforeVat: roundCurrency(totalBeforeVat),
    vatAmount: roundCurrency(vatAmount),
    totalWithVat: roundCurrency(totalWithVat),
    storagePath,
    jobsData: normalizedDocumentData.jobsData,
    priceProposalId: normalizedDocumentData.priceProposalId,
    confirmationNumber: normalizedConfirmationNumber,
    taxAuthorityConfirmationNumber: normalizedConfirmationNumber,
    documentData: normalizedDocumentData,
  };

  return record;
}

module.exports = {
  buildHtmlPayload,
  buildStoredDocumentRecord,
  normalizeClientVatNumber,
  normalizeDocumentClient,
  normalizeDocumentData,
  roundCurrency,
};
