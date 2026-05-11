export function normalizeIsoString(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) return null;
  return new Date(ts).toISOString();
}

export function normalizeStringList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return Array.from(new Set(
    values
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean),
  ));
}

export function normalizeDateFilter(value: unknown): string | null {
  const normalized = normalizeIsoString(value);
  return normalized || null;
}

export function resolveJobDateField(value: unknown): "created_at" | "updated_at" | "finished_at" | "due_at" {
  switch (String(value || "").trim()) {
    case "updatedAt":
      return "updated_at";
    case "finishedAt":
      return "finished_at";
    case "dueAt":
      return "due_at";
    default:
      return "created_at";
  }
}

export function resolveDocumentDateField(value: unknown): "created_at" | "updated_at" | "document_date" {
  switch (String(value || "").trim()) {
    case "updatedAt":
      return "updated_at";
    case "documentDate":
      return "document_date";
    default:
      return "created_at";
  }
}

export function getRowDateValue(row: any, field: string): unknown {
  return row?.[field] || row?.created_at || "";
}

export function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

