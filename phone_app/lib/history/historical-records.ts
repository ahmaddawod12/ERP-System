import type {
  ArchivedDocumentRecord,
  ArchivedJobRecord,
} from '@smart-job/api-contracts';

import type { AppDocument, DocumentItem, Job } from '../../types';

function optionalText(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function numberFromUnknown(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function mapJobPart(value: Readonly<Record<string, unknown>>): NonNullable<Job['partsUsed']>[number] {
  return {
    id: typeof value.partNo === 'string' || typeof value.partNo === 'number'
      ? value.partNo
      : undefined,
    name: typeof value.name === 'string' ? value.name : undefined,
    quantity: typeof value.quantity === 'string' || typeof value.quantity === 'number'
      ? value.quantity
      : undefined,
  };
}

export function mapArchivedJob(record: ArchivedJobRecord): Job {
  const jobNo = Number(record.id);
  return {
    id: record.id,
    ...(Number.isSafeInteger(jobNo) && jobNo > 0 ? { jobNo } : {}),
    status: record.status,
    title: record.title,
    description: record.description,
    notes: optionalText(record.notes),
    location: optionalText(record.location),
    address: optionalText(record.address),
    date: record.dueDate,
    cid: record.clientId === undefined ? undefined : String(record.clientId),
    cname: optionalText(record.client?.name),
    cphone: optionalText(record.client?.phone),
    wid: record.assignee?.memberNo,
    wname: optionalText(record.assignee?.name),
    mid: record.creator?.memberNo,
    mname: optionalText(record.creator?.name),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    finishedAt: record.finishedAt,
    isCert: record.isCertificate,
    partsUsed: record.partsUsed.map(mapJobPart),
  };
}

function mapDocumentItem(value: Readonly<Record<string, unknown>>): DocumentItem {
  return {
    id: typeof value.lineNo === 'string' || typeof value.lineNo === 'number'
      ? value.lineNo
      : undefined,
    description: typeof value.description === 'string' ? value.description : undefined,
    quantity: typeof value.quantity === 'string' || typeof value.quantity === 'number'
      ? value.quantity
      : undefined,
    unitPrice: numberFromUnknown(value.unitPrice),
    total: numberFromUnknown(value.lineTotal),
  };
}

export function mapArchivedDocument(record: ArchivedDocumentRecord): AppDocument {
  const items = record.items.map(mapDocumentItem);
  return {
    id: record.id,
    documentId: record.documentId,
    documentNumber: record.documentNumber,
    type: record.documentType,
    status: record.generationStatus,
    cname: optionalText(record.client?.name),
    cphone: optionalText(record.client?.phone),
    clientVatNumber: optionalText(record.client?.vatNumber),
    createdByName: optionalText(record.creator?.name),
    totalAmount: record.totalWithVat,
    netAmount: record.totalBeforeVat,
    vatAmount: record.vatAmount,
    totalBeforeVat: record.totalBeforeVat,
    totalWithVat: record.totalWithVat,
    taxAuthorityConfirmationNumber: optionalText(record.confirmationNumber),
    notes: optionalText(record.notes),
    items,
    income: items,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
