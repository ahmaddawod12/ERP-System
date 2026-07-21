type UnknownRecord = Record<string, unknown>;

export type NormalizedDocumentClient = {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  id: string;
  clientId: string;
  clientVatNumber?: string;
  customerVatNumber?: string;
  vatNumber?: string;
};

export type NormalizedDocumentItem = UnknownRecord & {
  description?: unknown;
  quantity?: unknown;
  price?: unknown;
  partId?: unknown;
  id?: unknown;
};

export type NormalizedDocumentData = UnknownRecord & {
  type: unknown;
  client: NormalizedDocumentClient;
  company: UnknownRecord;
  items: NormalizedDocumentItem[];
  documentNumber: unknown;
  language: string;
  date: string | null;
  notes: string | null;
  paymentMethod: string | null;
  paymentInfo: unknown;
  invoiceReference: string | null;
  jobsData: unknown[] | null;
  priceProposalId: string | null;
  taxAuthorityConfirmationNumber: string | null;
  totals: {
    totalBeforeVat: number;
    vatAmount: number;
    totalWithVat: number;
  };
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function coerceTrimmedString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function coerceOptionalString(value: unknown): string | null {
  const trimmed = coerceTrimmedString(value);
  return trimmed || null;
}

function roundCurrency(value: unknown): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function normalizeClientVatNumber(value: unknown = {}): string {
  const client = asRecord(value);
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

function normalizeDocumentClient(value: unknown = {}): NormalizedDocumentClient {
  const client = asRecord(value);
  const clientVatNumber = normalizeClientVatNumber(client);
  const clientId = coerceTrimmedString(client.clientId || client.id);
  const normalized: NormalizedDocumentClient = {
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

function normalizeDocumentData(
  documentType: unknown,
  value: unknown = {},
  fallbackDocumentNumber?: unknown,
): NormalizedDocumentData {
  const documentData = asRecord(value);
  const normalizedClient = normalizeDocumentClient(documentData.client);
  const normalizedDocumentNumber = documentData.documentNumber ?? fallbackDocumentNumber ?? null;
  const totals = asRecord(documentData.totals);
  const items = Array.isArray(documentData.items)
    ? documentData.items.map(asRecord)
    : [];
  return {
    ...documentData,
    type: documentData.type || documentType,
    client: normalizedClient,
    company: asRecord(documentData.company),
    items,
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

function buildHtmlPayload({
  documentType,
  documentData,
  documentNumber,
  logoUrl,
  confirmationNumber,
}: {
  documentType: unknown;
  documentData: unknown;
  documentNumber?: unknown;
  logoUrl?: unknown;
  confirmationNumber?: unknown;
}): NormalizedDocumentData & { logoUrl: unknown; confirmationNumber: string } {
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

function normalizeStoredItems(items: unknown) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((value) => {
    const item = asRecord(value);
    return {
    description: item.description,
    quantity: item.quantity,
    price: item.price,
    partId: item.partId || item.id || null,
    id: item.partId || item.id || null,
    };
  });
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
}: {
  documentType: unknown;
  documentData: unknown;
  uid: unknown;
  createdAt: unknown;
  totalBeforeVat: unknown;
  vatAmount: unknown;
  totalWithVat: unknown;
  storagePath: unknown;
  normalizedDocumentId: unknown;
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
    cphone: normalizedClient.phone || null,
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

export { buildHtmlPayload, buildStoredDocumentRecord, normalizeClientVatNumber, normalizeDocumentClient, normalizeDocumentData, roundCurrency };

