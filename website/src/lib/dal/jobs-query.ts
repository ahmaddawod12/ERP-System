import {
  JobListQuerySchema,
  type Cursor,
  type JobListQuery,
} from "@smart-job/api-contracts";

export const WEBSITE_JOBS_PAGE_SIZE = 25;

export interface JobsFilterValues {
  status: "" | "pending" | "waiting" | "finished" | "denied";
  search: string;
  dateFrom: string;
  dateTo: string;
}

export type JobsSearchParams = Record<string, string | string[] | undefined>;

export type ParsedJobsSearchParams =
  | {
      ok: true;
      filters: JobsFilterValues;
      query: JobListQuery;
      afterCursor: Cursor | null;
    }
  | {
      ok: false;
      filters: JobsFilterValues;
      message: string;
    };

const EMPTY_FILTERS: JobsFilterValues = {
  status: "",
  search: "",
  dateFrom: "",
  dateTo: "",
};

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const VALID_STATUSES = new Set<JobsFilterValues["status"]>([
  "",
  "pending",
  "waiting",
  "finished",
  "denied",
]);

function readSingleValue(
  searchParams: JobsSearchParams,
  key: string,
): { value: string; duplicate: boolean } {
  const rawValue = searchParams[key];
  if (rawValue === undefined) {
    return { value: "", duplicate: false };
  }
  if (Array.isArray(rawValue)) {
    return { value: rawValue[0] ?? "", duplicate: true };
  }
  return { value: rawValue, duplicate: false };
}

function isCalendarDate(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

function startOfUtcDay(value: string): string {
  return `${value}T00:00:00.000Z`;
}

function endOfUtcDay(value: string): string {
  return `${value}T23:59:59.999Z`;
}

export function parseJobsSearchParams(
  searchParams: JobsSearchParams,
): ParsedJobsSearchParams {
  const status = readSingleValue(searchParams, "status");
  const search = readSingleValue(searchParams, "search");
  const dateFrom = readSingleValue(searchParams, "dateFrom");
  const dateTo = readSingleValue(searchParams, "dateTo");
  const afterCursor = readSingleValue(searchParams, "afterCursor");
  const hasDuplicate = [status, search, dateFrom, dateTo, afterCursor]
    .some((entry) => entry.duplicate);

  const normalizedStatus = status.value.trim().toLowerCase();
  const filters: JobsFilterValues = {
    status: VALID_STATUSES.has(normalizedStatus as JobsFilterValues["status"])
      ? normalizedStatus as JobsFilterValues["status"]
      : "",
    search: search.value.trim(),
    dateFrom: dateFrom.value.trim(),
    dateTo: dateTo.value.trim(),
  };

  if (
    hasDuplicate
    || !VALID_STATUSES.has(normalizedStatus as JobsFilterValues["status"])
    || (filters.dateFrom !== "" && !isCalendarDate(filters.dateFrom))
    || (filters.dateTo !== "" && !isCalendarDate(filters.dateTo))
  ) {
    return {
      ok: false,
      filters,
      message: "One or more job filters are invalid. Review the status and date fields, then try again.",
    };
  }

  const candidate = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.dateFrom ? { dateFrom: startOfUtcDay(filters.dateFrom) } : {}),
    ...(filters.dateTo ? { dateTo: endOfUtcDay(filters.dateTo) } : {}),
    ...(afterCursor.value.trim() ? { afterCursor: afterCursor.value.trim() } : {}),
    pageSize: WEBSITE_JOBS_PAGE_SIZE,
  };
  const parsed = JobListQuerySchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      filters,
      message: "One or more job filters are invalid. Shorten the search or restart from the first page.",
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

export function buildCompanyJobsApiPath(
  companyId: number,
  query: JobListQuery,
): string {
  assertPublicCompanyId(companyId);
  const validated = JobListQuerySchema.parse(query);
  const queryString = new URLSearchParams();
  const statuses = validated.status === undefined
    ? []
    : Array.isArray(validated.status)
      ? validated.status
      : [validated.status];
  for (const status of statuses) {
    queryString.append("status", status);
  }
  if (validated.dateFrom) queryString.set("dateFrom", validated.dateFrom);
  if (validated.dateTo) queryString.set("dateTo", validated.dateTo);
  if (validated.creatorUid) queryString.set("creatorUid", validated.creatorUid);
  if (validated.search) queryString.set("search", validated.search);
  if (validated.pageSize !== undefined) queryString.set("pageSize", String(validated.pageSize));
  if (validated.limit !== undefined) queryString.set("limit", String(validated.limit));
  if (validated.afterCursor) queryString.set("afterCursor", validated.afterCursor);

  const suffix = queryString.toString();
  return `/api/v1/companies/${companyId}/jobs${suffix ? `?${suffix}` : ""}`;
}

export function buildJobsPageHref(
  companyId: number,
  filters: JobsFilterValues = EMPTY_FILTERS,
  afterCursor?: Cursor | null,
): string {
  assertPublicCompanyId(companyId);
  const queryString = new URLSearchParams();
  if (filters.status) queryString.set("status", filters.status);
  if (filters.search) queryString.set("search", filters.search);
  if (filters.dateFrom) queryString.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) queryString.set("dateTo", filters.dateTo);
  if (afterCursor) queryString.set("afterCursor", afterCursor);

  const suffix = queryString.toString();
  return `/app/c/${companyId}/jobs${suffix ? `?${suffix}` : ""}`;
}

export function hasActiveJobsFilters(filters: JobsFilterValues): boolean {
  return Boolean(filters.status || filters.search || filters.dateFrom || filters.dateTo);
}
