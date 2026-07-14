import {
  DocumentGenerateRequestSchema,
  DocumentPreviewRequestSchema,
  type DocumentGenerateRequest,
  type DocumentPreviewRequest,
} from '@smart-job/api-contracts';
import { DOC_TYPE } from '@smart-job/contracts';

export interface DocumentTaskParams {
  readonly documentType: string | number;
  readonly companyId: string | number;
  readonly documentData?: Record<string, unknown>;
  readonly documentId?: string;
}

const DOCUMENT_TYPE_ALIASES: Readonly<Record<string, number>> = Object.freeze({
  priceproposal: DOC_TYPE.PRICE_PROPOSAL,
  deliverynote: DOC_TYPE.DELIVERY_NOTE,
  returncertificate: DOC_TYPE.RETURN_CERTIFICATE,
  taxinvoice: DOC_TYPE.TAX_INVOICE,
  refund: DOC_TYPE.REFUND,
  receipt: DOC_TYPE.RECEIPT,
});

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} is required`);
  }
  return value as Record<string, unknown>;
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim() || undefined;
}

function normalizeDocumentType(value: string | number): number {
  if (typeof value === 'number') return value;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return DOCUMENT_TYPE_ALIASES[trimmed.replace(/[\s_-]+/g, '').toLowerCase()] ?? Number.NaN;
}

export function isTaxDocumentType(value: string | number): boolean {
  return normalizeDocumentType(value) === DOC_TYPE.TAX_INVOICE;
}

export function normalizeDocumentCompanyId(value: string | number): number {
  const companyId = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error('A valid company is required to publish a document task');
  }
  return companyId;
}

function normalizePartNo(item: Record<string, unknown>): number | undefined {
  const raw = item.partNo ?? item.partId;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const partNo = typeof raw === 'number' ? raw : Number(raw);
  return Number.isSafeInteger(partNo) && partNo > 0 ? partNo : undefined;
}

function normalizedCandidate(params: DocumentTaskParams): unknown {
  const documentData = asRecord(params.documentData, 'Document data');
  const client = asRecord(documentData.client, 'Document client');
  if (!Array.isArray(documentData.items)) {
    throw new Error('At least one document item is required');
  }

  const clientId = optionalText(client.clientId);
  const email = optionalText(client.email);
  const phone = optionalText(client.phone);
  const address = optionalText(client.address);
  const city = optionalText(client.city);
  const clientVatNumber = optionalText(client.clientVatNumber ?? client.vatNumber);
  const notes = optionalText(documentData.notes);
  const paymentMethod = optionalText(documentData.paymentMethod);
  const invoiceReference = documentData.invoiceReference == null
    ? undefined
    : optionalText(String(documentData.invoiceReference));

  return {
    documentType: normalizeDocumentType(params.documentType),
    documentData: {
      client: {
        ...(clientId ? { clientId } : {}),
        name: typeof client.name === 'string' ? client.name : '',
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
        ...(address ? { address } : {}),
        ...(city ? { city } : {}),
        ...(clientVatNumber ? { clientVatNumber } : {}),
      },
      items: documentData.items.map((value) => {
        const item = asRecord(value, 'Document item');
        const partNo = normalizePartNo(item);
        return {
          description: typeof item.description === 'string' ? item.description : '',
          quantity: Number(item.quantity),
          price: Number(item.price),
          ...(partNo ? { partNo } : {}),
        };
      }),
      language: documentData.language,
      date: documentData.date instanceof Date
        ? documentData.date.toISOString()
        : String(documentData.date ?? ''),
      ...(notes ? { notes } : {}),
      ...(paymentMethod ? { paymentMethod } : {}),
      ...(documentData.paymentInfo !== undefined && documentData.paymentInfo !== ''
        ? { paymentInfo: documentData.paymentInfo }
        : {}),
      ...(invoiceReference ? { invoiceReference } : {}),
    },
  };
}

function rejectTaxWorkflow(params: DocumentTaskParams): void {
  if (isTaxDocumentType(params.documentType)) {
    throw new Error('Tax invoices must use the tax approval workflow.');
  }
}

export function buildDocumentPreviewRequest(
  params: DocumentTaskParams,
): DocumentPreviewRequest {
  rejectTaxWorkflow(params);
  return DocumentPreviewRequestSchema.parse(normalizedCandidate(params));
}

export function buildDocumentGenerateRequest(
  params: DocumentTaskParams,
): DocumentGenerateRequest {
  rejectTaxWorkflow(params);
  return DocumentGenerateRequestSchema.parse(normalizedCandidate(params));
}
