import {
  InventoryListQuerySchema,
  type Cursor,
  type InventoryListQuery,
  type InventoryPartStatus,
} from "@smart-job/api-contracts";

export const WEBSITE_INVENTORY_PAGE_SIZE = 25;

export type InventoryReadScope = "company" | "member";

export interface InventoryFilterValues {
  status: "" | InventoryPartStatus;
  search: string;
}

export type InventorySearchParams = Record<string, string | string[] | undefined>;

export type ParsedInventorySearchParams =
  | {
      ok: true;
      filters: InventoryFilterValues;
      query: InventoryListQuery;
      afterCursor: Cursor | null;
    }
  | {
      ok: false;
      filters: InventoryFilterValues;
      message: string;
    };

const EMPTY_FILTERS: InventoryFilterValues = { status: "", search: "" };
const VALID_STATUSES = new Set<InventoryFilterValues["status"]>([
  "",
  "active",
  "inactive",
  "archived",
]);

function readSingleValue(
  searchParams: InventorySearchParams,
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

export function parseInventorySearchParams(
  searchParams: InventorySearchParams,
): ParsedInventorySearchParams {
  const status = readSingleValue(searchParams, "status");
  const search = readSingleValue(searchParams, "search");
  const afterCursor = readSingleValue(searchParams, "afterCursor");
  const normalizedStatus = status.value.trim().toLowerCase();
  const filters: InventoryFilterValues = {
    status: VALID_STATUSES.has(normalizedStatus as InventoryFilterValues["status"])
      ? normalizedStatus as InventoryFilterValues["status"]
      : "",
    search: search.value.trim(),
  };

  if (
    status.duplicate
    || search.duplicate
    || afterCursor.duplicate
    || !VALID_STATUSES.has(normalizedStatus as InventoryFilterValues["status"])
  ) {
    return {
      ok: false,
      filters,
      message: "One or more inventory filters are invalid. Review the status and search fields, then try again.",
    };
  }

  const candidate = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.search ? { search: filters.search } : {}),
    ...(afterCursor.value.trim() ? { afterCursor: afterCursor.value.trim() } : {}),
    pageSize: WEBSITE_INVENTORY_PAGE_SIZE,
  };
  const parsed = InventoryListQuerySchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      filters,
      message: "The inventory search or pagination cursor is invalid. Shorten the search or return to the first page.",
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

export function buildCompanyInventoryApiPath(
  companyId: number,
  scope: InventoryReadScope,
  query: InventoryListQuery,
): string {
  assertPublicCompanyId(companyId);
  const validated = InventoryListQuerySchema.parse(query);
  const queryString = new URLSearchParams();
  const statuses = validated.status === undefined
    ? []
    : Array.isArray(validated.status)
      ? validated.status
      : [validated.status];
  for (const status of statuses) {
    queryString.append("status", status);
  }
  if (validated.search) queryString.set("search", validated.search);
  if (validated.pageSize !== undefined) queryString.set("pageSize", String(validated.pageSize));
  if (validated.afterCursor) queryString.set("afterCursor", validated.afterCursor);

  const suffix = queryString.toString();
  const scopePath = scope === "member" ? "/me" : "";
  return `/api/v1/companies/${companyId}/inventory${scopePath}${suffix ? `?${suffix}` : ""}`;
}

export function buildInventoryPageHref(
  companyId: number,
  filters: InventoryFilterValues = EMPTY_FILTERS,
  afterCursor?: Cursor | null,
): string {
  assertPublicCompanyId(companyId);
  const queryString = new URLSearchParams();
  if (filters.status) queryString.set("status", filters.status);
  if (filters.search) queryString.set("search", filters.search);
  if (afterCursor) queryString.set("afterCursor", afterCursor);

  const suffix = queryString.toString();
  return `/app/c/${companyId}/inventory${suffix ? `?${suffix}` : ""}`;
}

export function hasActiveInventoryFilters(filters: InventoryFilterValues): boolean {
  return Boolean(filters.status || filters.search);
}
