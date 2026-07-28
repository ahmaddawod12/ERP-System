import {
  DocumentGenerationStatusSchema,
  DocumentListQuerySchema,
  type Cursor,
  type DocumentGenerationStatus,
  type DocumentListQuery,
} from "@smart-job/api-contracts";
import {
  DocType,
  type DocTypeCode as DocumentTypeCode,
} from "@smart-job/contracts";

export const WEBSITE_DOCUMENTS_PAGE_SIZE = 25;

type DocumentTypeFilter = "" | `${DocumentTypeCode}`;

export interface DocumentsFilterValues {
  search: string;
  status: "" | DocumentGenerationStatus;
  documentType: DocumentTypeFilter;
  dateFrom: string;
  dateTo: string;
}

export type DocumentsSearchParams = Record<string, string | string[] | undefined>;

export type ParsedDocumentsSearchParams =
  | {
      ok: true;
      filters: DocumentsFilterValues;
      query: DocumentListQuery;
      afterCursor: Cursor | null;
    }
  | {
      ok: false;
      filters: DocumentsFilterValues;
      message: string;
    };

const EMPTY_FILTERS: DocumentsFilterValues = {
  search: "",
  status: "",
  documentType: "",
  dateFrom: "",
  dateTo: "",
};

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const DOCUMENT_GENERATION_STATUS_OPTIONS = DocumentGenerationStatusSchema.options;

const DOCUMENT_STATUSES = new Set<DocumentGenerationStatus>(DOCUMENT_GENERATION_STATUS_OPTIONS);
const DOCUMENT_TYPES = new Set<DocumentTypeCode>(Object.values(DocType));

function readSingleValue(
  searchParams: DocumentsSearchParams,
  key: string,
): { value: string; duplicate: boolean } {
  const rawValue = searchParams[key];
  if (rawValue === undefined) return { value: "", duplicate: false };
  if (Array.isArray(rawValue)) {
    return { value: rawValue[0] ?? "", duplicate: true };
  }
  return { value: rawValue, duplicate: false };
}

function isCalendarDate(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function documentTypeFilter(value: string): DocumentTypeFilter | null {
  if (value === "") return "";
  const code = Number(value);
  return DOCUMENT_TYPES.has(code as DocumentTypeCode)
    ? String(code) as DocumentTypeFilter
    : null;
}

export function parseDocumentsSearchParams(
  searchParams: DocumentsSearchParams,
): ParsedDocumentsSearchParams {
  const search = readSingleValue(searchParams, "search");
  const status = readSingleValue(searchParams, "status");
  const documentType = readSingleValue(searchParams, "documentType");
  const dateFrom = readSingleValue(searchParams, "dateFrom");
  const dateTo = readSingleValue(searchParams, "dateTo");
  const afterCursor = readSingleValue(searchParams, "afterCursor");
  const values = [search, status, documentType, dateFrom, dateTo, afterCursor];

  const normalizedStatus = status.value.trim().toLowerCase();
  const normalizedDocumentType = documentTypeFilter(documentType.value.trim());
  const filters: DocumentsFilterValues = {
    search: search.value.trim(),
    status: DOCUMENT_STATUSES.has(normalizedStatus as DocumentGenerationStatus)
      ? normalizedStatus as DocumentGenerationStatus
      : "",
    documentType: normalizedDocumentType ?? "",
    dateFrom: dateFrom.value.trim(),
    dateTo: dateTo.value.trim(),
  };

  if (
    values.some((entry) => entry.duplicate)
    || (normalizedStatus !== "" && !DOCUMENT_STATUSES.has(normalizedStatus as DocumentGenerationStatus))
    || normalizedDocumentType === null
    || (filters.dateFrom !== "" && !isCalendarDate(filters.dateFrom))
    || (filters.dateTo !== "" && !isCalendarDate(filters.dateTo))
  ) {
    return {
      ok: false,
      filters,
      message: "One or more document filters are invalid. Review the status, type, and date fields, then try again.",
    };
  }

  const parsed = DocumentListQuerySchema.safeParse({
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.documentType ? { documentType: Number(filters.documentType) } : {}),
    ...(filters.dateFrom ? { dateFrom: `${filters.dateFrom}T00:00:00.000Z` } : {}),
    ...(filters.dateTo ? { dateTo: `${filters.dateTo}T23:59:59.999Z` } : {}),
    ...(afterCursor.value.trim() ? { afterCursor: afterCursor.value.trim() } : {}),
    pageSize: WEBSITE_DOCUMENTS_PAGE_SIZE,
  });
  if (!parsed.success) {
    return {
      ok: false,
      filters,
      message: "One or more document filters are invalid. Shorten the search, review the date range, or restart from the first page.",
    };
  }

  return {
    ok: true,
    filters,
    query: parsed.data,
    afterCursor: parsed.data.afterCursor ?? null,
  };
}

function assertPublicCompanyId(companyId: number): void {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new Error("A positive public company ID is required");
  }
}

export function buildCompanyDocumentsApiPath(
  companyId: number,
  query: DocumentListQuery,
): string {
  assertPublicCompanyId(companyId);
  const validated = DocumentListQuerySchema.parse(query);
  const queryString = new URLSearchParams();
  const statuses = validated.status === undefined
    ? []
    : Array.isArray(validated.status) ? validated.status : [validated.status];
  const documentTypes = validated.documentType === undefined
    ? []
    : Array.isArray(validated.documentType) ? validated.documentType : [validated.documentType];

  if (validated.search) queryString.set("search", validated.search);
  for (const value of statuses) queryString.append("status", value);
  for (const value of documentTypes) queryString.append("documentType", String(value));
  if (validated.createdByUid) queryString.set("createdByUid", validated.createdByUid);
  if (validated.dateFrom) queryString.set("dateFrom", validated.dateFrom);
  if (validated.dateTo) queryString.set("dateTo", validated.dateTo);
  if (validated.pageSize !== undefined) queryString.set("pageSize", String(validated.pageSize));
  if (validated.afterCursor) queryString.set("afterCursor", validated.afterCursor);

  const suffix = queryString.toString();
  return `/api/v1/companies/${companyId}/documents${suffix ? `?${suffix}` : ""}`;
}

export function buildDocumentsPageHref(
  companyId: number,
  filters: DocumentsFilterValues = EMPTY_FILTERS,
  afterCursor?: Cursor | null,
): string {
  assertPublicCompanyId(companyId);
  const queryString = new URLSearchParams();
  if (filters.search) queryString.set("search", filters.search);
  if (filters.status) queryString.set("status", filters.status);
  if (filters.documentType) queryString.set("documentType", filters.documentType);
  if (filters.dateFrom) queryString.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) queryString.set("dateTo", filters.dateTo);
  if (afterCursor) queryString.set("afterCursor", afterCursor);

  const suffix = queryString.toString();
  return `/app/c/${companyId}/documents${suffix ? `?${suffix}` : ""}`;
}

export function buildDocumentDownloadHref(companyId: number, documentId: string): string {
  assertPublicCompanyId(companyId);
  return `/api/companies/${companyId}/documents/${encodeURIComponent(documentId)}/download`;
}

export function hasActiveDocumentsFilters(filters: DocumentsFilterValues): boolean {
  return Boolean(
    filters.search
    || filters.status
    || filters.documentType
    || filters.dateFrom
    || filters.dateTo,
  );
}
