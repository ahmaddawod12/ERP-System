import {
  ClientListQuerySchema,
  type ClientListQuery,
  type Cursor,
} from "@smart-job/api-contracts";

export const WEBSITE_CLIENTS_PAGE_SIZE = 25;

export interface ClientsFilterValues {
  search: string;
}

export type ClientsSearchParams = Record<string, string | string[] | undefined>;

export type ParsedClientsSearchParams =
  | {
      ok: true;
      filters: ClientsFilterValues;
      query: ClientListQuery;
      afterCursor: Cursor | null;
    }
  | {
      ok: false;
      filters: ClientsFilterValues;
      message: string;
    };

const EMPTY_FILTERS: ClientsFilterValues = { search: "" };

function readSingleValue(
  searchParams: ClientsSearchParams,
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

export function parseClientsSearchParams(
  searchParams: ClientsSearchParams,
): ParsedClientsSearchParams {
  const search = readSingleValue(searchParams, "search");
  const afterCursor = readSingleValue(searchParams, "afterCursor");
  const filters: ClientsFilterValues = { search: search.value.trim() };

  if (search.duplicate || afterCursor.duplicate) {
    return {
      ok: false,
      filters,
      message: "Only one value is allowed for each client filter. Return to the first page and try again.",
    };
  }

  const candidate = {
    ...(filters.search ? { search: filters.search } : {}),
    ...(afterCursor.value.trim() ? { afterCursor: afterCursor.value.trim() } : {}),
    pageSize: WEBSITE_CLIENTS_PAGE_SIZE,
  };
  const parsed = ClientListQuerySchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      filters,
      message: "The client search or pagination cursor is invalid. Shorten the search or return to the first page.",
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

export function buildCompanyClientsApiPath(
  companyId: number,
  query: ClientListQuery,
): string {
  assertPublicCompanyId(companyId);
  const validated = ClientListQuerySchema.parse(query);
  const queryString = new URLSearchParams();
  if (validated.search) queryString.set("search", validated.search);
  if (validated.pageSize !== undefined) queryString.set("pageSize", String(validated.pageSize));
  if (validated.afterCursor) queryString.set("afterCursor", validated.afterCursor);

  const suffix = queryString.toString();
  return `/api/v1/companies/${companyId}/clients${suffix ? `?${suffix}` : ""}`;
}

export function buildClientsPageHref(
  companyId: number,
  filters: ClientsFilterValues = EMPTY_FILTERS,
  afterCursor?: Cursor | null,
): string {
  assertPublicCompanyId(companyId);
  const queryString = new URLSearchParams();
  if (filters.search) queryString.set("search", filters.search);
  if (afterCursor) queryString.set("afterCursor", afterCursor);

  const suffix = queryString.toString();
  return `/app/c/${companyId}/clients${suffix ? `?${suffix}` : ""}`;
}

export function hasActiveClientsFilters(filters: ClientsFilterValues): boolean {
  return filters.search !== "";
}
