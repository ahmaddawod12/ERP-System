import type React from 'react';
import type { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  DEFAULT_DOCUMENT_PAGE_SIZE,
  DocumentListQuerySchema,
  MAX_DOCUMENT_PAGE_SIZE,
  type DocumentGenerationStatus,
  type DocumentDetail,
  type DocumentSummary,
  type EmailDeliveryStatus,
  type TaxSubmissionStatus,
  type TaxAuthorityStatus,
} from '@smart-job/api-contracts';
import type { AppDocument, DateLike, DocTypeCode } from '../../../types';
import type { DateFilterRange } from '../../../components/forms/DateFilter';

export type DocumentTypeFilter = 'all' | DocTypeCode;

export type DocumentLineItem = {
  price?: number | string;
  quantity?: number | string;
  description?: string;
};

export type DocumentHistoryRecord = AppDocument & {
  income?: DocumentLineItem[];
  notes?: string;
  number?: string | number;
  documentNumber?: string | number;
  total?: number;
  description?: string;
  createdByName?: string;
  createdByUid?: string;
  storagePath?: string;
  documentId?: string;
  documentCode?: string;
  generationStatus?: DocumentGenerationStatus;
  taxAuthorityStatus?: TaxAuthorityStatus;
  entityVersion?: string;
  hasFile?: boolean;
  emailSent?: boolean;
  emailDeliveryStatus?: EmailDeliveryStatus | null;
  taxSubmissionStatus?: TaxSubmissionStatus | null;
};

export interface DocumentListFilters {
  readonly search?: string;
  readonly status?: DocumentGenerationStatus | readonly DocumentGenerationStatus[];
  readonly documentType?: DocTypeCode | readonly DocTypeCode[];
  readonly createdByUid?: string;
  readonly dateFrom?: Date | string;
  readonly dateTo?: Date | string;
  readonly pageSize?: number;
}

export interface NormalizedDocumentListFilters {
  readonly search?: string;
  readonly statuses: readonly DocumentGenerationStatus[];
  readonly documentTypes: readonly DocTypeCode[];
  readonly createdByUid?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly pageSize: number;
}

export type DocumentDateFilter = {
  type: DateFilterRange['type'];
  startDate: Date | null;
  endDate: Date | null;
  label: string;
};

export type DocumentTypeOption = {
  id: DocumentTypeFilter;
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  color: string;
  gradient: [string, string];
};

export function getDateLikeTime(value: DateLike | null | undefined): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  return new Date(String(value)).getTime();
}

function toIso(value: Date | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('The document date filter is invalid');
  }
  return date.toISOString();
}

function asUniqueArray<T extends string | number>(
  value: T | readonly T[] | undefined,
): T[] {
  if (value === undefined) return [];
  return [...new Set(Array.isArray(value) ? value : [value])] as T[];
}

function boundedPageSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_DOCUMENT_PAGE_SIZE;
  }
  return Math.min(MAX_DOCUMENT_PAGE_SIZE, Math.max(1, Math.trunc(value)));
}

export function normalizeDocumentListFilters(
  filters: DocumentListFilters = {},
): NormalizedDocumentListFilters {
  const search = filters.search?.trim().slice(0, 80) || undefined;
  const statuses = asUniqueArray(filters.status).sort();
  const documentTypes = asUniqueArray(filters.documentType).sort((left, right) => left - right);
  const createdByUid = filters.createdByUid?.trim() || undefined;
  const dateFrom = toIso(filters.dateFrom);
  const dateTo = toIso(filters.dateTo);
  const pageSize = boundedPageSize(filters.pageSize);

  DocumentListQuerySchema.parse({
    search,
    status: statuses.length > 0 ? statuses : undefined,
    documentType: documentTypes.length > 0 ? documentTypes : undefined,
    createdByUid,
    dateFrom,
    dateTo,
    pageSize,
  });

  return {
    search,
    statuses,
    documentTypes,
    createdByUid,
    dateFrom,
    dateTo,
    pageSize,
  };
}

export function buildDocumentListPath(
  companyId: number,
  filters: NormalizedDocumentListFilters,
  afterCursor: string | null = null,
): string {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error('A valid company is required to list documents');
  }

  DocumentListQuerySchema.parse({
    search: filters.search,
    status: filters.statuses.length > 0 ? filters.statuses : undefined,
    documentType: filters.documentTypes.length > 0 ? filters.documentTypes : undefined,
    createdByUid: filters.createdByUid,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    pageSize: filters.pageSize,
    afterCursor: afterCursor || undefined,
  });

  const searchParams = new URLSearchParams();
  if (filters.search) searchParams.set('search', filters.search);
  for (const status of filters.statuses) searchParams.append('status', status);
  for (const documentType of filters.documentTypes) {
    searchParams.append('documentType', String(documentType));
  }
  if (filters.createdByUid) searchParams.set('createdByUid', filters.createdByUid);
  if (filters.dateFrom) searchParams.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) searchParams.set('dateTo', filters.dateTo);
  searchParams.set('pageSize', String(filters.pageSize));
  if (afterCursor) searchParams.set('afterCursor', afterCursor);

  return `/api/v1/companies/${companyId}/documents?${searchParams.toString()}`;
}

function optional<T>(value: T | null): T | undefined {
  return value ?? undefined;
}

export function mapDocumentSummary(summary: DocumentSummary): DocumentHistoryRecord {
  return {
    id: summary.documentId,
    documentId: summary.documentId,
    documentCode: summary.documentCode,
    documentNumber: summary.documentNumber,
    type: summary.documentType,
    status: summary.generationStatus,
    generationStatus: summary.generationStatus,
    taxAuthorityStatus: summary.taxAuthorityStatus,
    entityVersion: summary.entityVersion,
    cid: optional(summary.client?.clientId ?? null),
    cname: optional(summary.client?.name ?? null),
    cphone: optional(summary.client?.phone ?? null),
    clientVatNumber: optional(summary.client?.vatNumber ?? null),
    createdByUid: optional(summary.creator?.uid ?? null),
    createdByName: optional(summary.creator?.displayName ?? null),
    notes: optional(summary.notes),
    description: optional(summary.notes),
    total: summary.totalWithVat,
    totalAmount: summary.totalWithVat,
    netAmount: summary.totalBeforeVat,
    totalBeforeVat: summary.totalBeforeVat,
    vatAmount: summary.vatAmount,
    totalWithVat: summary.totalWithVat,
    taxAuthorityConfirmationNumber: optional(summary.confirmationNumber),
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    hasFile: summary.hasFile,
    emailSent: summary.emailSent,
    emailDeliveryStatus: summary.emailDeliveryStatus,
  };
}

export function mapDocumentDetail(detail: DocumentDetail): DocumentHistoryRecord {
  return {
    ...mapDocumentSummary(detail),
    taxSubmissionStatus: detail.taxSubmissionStatus,
    paymentMethod: detail.paymentMethod ?? undefined,
    paymentDetails: detail.paymentDetails ?? undefined,
  };
}

export function mergeDocumentSummaryPages(
  pages: readonly { readonly items: readonly DocumentSummary[] }[] | undefined,
): DocumentHistoryRecord[] {
  const seen = new Set<string>();
  const documents: DocumentHistoryRecord[] = [];
  for (const page of pages ?? []) {
    for (const summary of page.items) {
      if (seen.has(summary.documentId)) continue;
      seen.add(summary.documentId);
      documents.push(mapDocumentSummary(summary));
    }
  }
  return documents;
}
