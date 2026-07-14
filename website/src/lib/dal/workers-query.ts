import {
  WorkerListQuerySchema,
  type Cursor,
  type WorkerDirectoryRole,
  type WorkerListQuery,
  type WorkerMembershipStatus,
} from "@smart-job/api-contracts";

export const WEBSITE_WORKERS_PAGE_SIZE = 25;

export interface WorkersFilterValues {
  search: string;
  role: "" | WorkerDirectoryRole;
  status: "" | WorkerMembershipStatus;
}

export type WorkersSearchParams = Record<string, string | string[] | undefined>;

export type ParsedWorkersSearchParams =
  | {
      ok: true;
      filters: WorkersFilterValues;
      query: WorkerListQuery;
      afterCursor: Cursor | null;
    }
  | {
      ok: false;
      filters: WorkersFilterValues;
      message: string;
    };

export const EMPTY_WORKERS_FILTERS: WorkersFilterValues = {
  search: "",
  role: "",
  status: "",
};

function readSingleValue(
  searchParams: WorkersSearchParams,
  key: string,
): { value: string; duplicate: boolean } {
  const rawValue = searchParams[key];
  if (rawValue === undefined) return { value: "", duplicate: false };
  if (Array.isArray(rawValue)) {
    return { value: rawValue[0] ?? "", duplicate: true };
  }
  return { value: rawValue, duplicate: false };
}

export function parseWorkersSearchParams(
  searchParams: WorkersSearchParams,
): ParsedWorkersSearchParams {
  const search = readSingleValue(searchParams, "search");
  const role = readSingleValue(searchParams, "role");
  const status = readSingleValue(searchParams, "status");
  const afterCursor = readSingleValue(searchParams, "afterCursor");
  const filters = {
    search: search.value.trim(),
    role: role.value.trim(),
    status: status.value.trim(),
  } as WorkersFilterValues;

  if (search.duplicate || role.duplicate || status.duplicate || afterCursor.duplicate) {
    return {
      ok: false,
      filters,
      message: "Only one value is allowed for each team filter. Return to the first page and try again.",
    };
  }

  const candidate = {
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(afterCursor.value.trim() ? { afterCursor: afterCursor.value.trim() } : {}),
    pageSize: WEBSITE_WORKERS_PAGE_SIZE,
  };
  const parsed = WorkerListQuerySchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      filters,
      message: "The team filters or pagination cursor are invalid. Check the values or return to the first page.",
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

function addFilter(
  queryString: URLSearchParams,
  name: string,
  value: string | string[] | undefined,
): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => queryString.append(name, entry));
  } else if (value) {
    queryString.set(name, value);
  }
}

export function buildCompanyWorkersApiPath(
  companyId: number,
  query: WorkerListQuery,
): string {
  assertPublicCompanyId(companyId);
  const validated = WorkerListQuerySchema.parse(query);
  const queryString = new URLSearchParams();
  if (validated.search) queryString.set("search", validated.search);
  addFilter(queryString, "role", validated.role);
  addFilter(queryString, "status", validated.status);
  if (validated.pageSize !== undefined) queryString.set("pageSize", String(validated.pageSize));
  if (validated.afterCursor) queryString.set("afterCursor", validated.afterCursor);

  const suffix = queryString.toString();
  return `/api/v1/companies/${companyId}/workers${suffix ? `?${suffix}` : ""}`;
}

export function buildWorkersPageHref(
  companyId: number,
  filters: WorkersFilterValues = EMPTY_WORKERS_FILTERS,
  afterCursor?: Cursor | null,
): string {
  assertPublicCompanyId(companyId);
  const queryString = new URLSearchParams();
  if (filters.search) queryString.set("search", filters.search);
  if (filters.role) queryString.set("role", filters.role);
  if (filters.status) queryString.set("status", filters.status);
  if (afterCursor) queryString.set("afterCursor", afterCursor);

  const suffix = queryString.toString();
  return `/app/c/${companyId}/workers${suffix ? `?${suffix}` : ""}`;
}

export function hasActiveWorkersFilters(filters: WorkersFilterValues): boolean {
  return filters.search !== "" || filters.role !== "" || filters.status !== "";
}
