import { isUuidLike, normalizeIsoString } from "./filters.ts";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export function parsePageSize(raw: unknown): number {
  const value = Number(raw || DEFAULT_PAGE_SIZE);
  if (!Number.isFinite(value)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(value)));
}

export function parseReadLimit(body: Record<string, unknown>): number {
  const raw = body.limit ?? body.pageSize;
  const value = Number(raw || DEFAULT_PAGE_SIZE);
  if (!Number.isFinite(value)) return DEFAULT_PAGE_SIZE;
  const max = body.limit != null ? 10_000 : MAX_PAGE_SIZE;
  return Math.min(max, Math.max(1, Math.floor(value)));
}

export function makeCursor(createdAt: unknown, id: unknown): string {
  return `${String(createdAt || "")}|${String(id || "")}`;
}

export function parseCursor(cursorRaw: unknown): { createdAt: string; id: string } | null {
  const raw = String(cursorRaw || "").trim();
  if (!raw || !raw.includes("|")) return null;
  const [createdAt, id] = raw.split("|");
  if (!createdAt || !id) return null;
  const normalizedCreatedAt = normalizeIsoString(createdAt);
  if (!normalizedCreatedAt || !isUuidLike(String(id))) return null;
  return { createdAt: normalizedCreatedAt, id: String(id) };
}

