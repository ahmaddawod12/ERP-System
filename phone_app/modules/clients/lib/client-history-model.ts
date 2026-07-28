import type { Language } from '../../../types';
import type { MobileClientSummary } from './client-list-model';

export type ClientHistoryView = 'finishedJobs' | 'documents';

type DateLikeValue = Date | string | number | { toDate: () => Date };

export type ClientHistoryEntry =
  | {
      id: string;
      kind: 'job';
      title: string;
      status: string | null;
      occurredAt: DateLikeValue | null;
      location: string | null;
      partNames: string[];
    }
  | {
      id: string;
      kind: 'document';
      documentType: string | number | undefined;
      documentNumber: string | null;
      occurredAt: DateLikeValue | null;
      clientName: string | null;
      total: number;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function dateLike(value: unknown): DateLikeValue | null {
  if (value instanceof Date || typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  if (isRecord(value) && typeof value.toDate === 'function') {
    return value as { toDate: () => Date };
  }
  return null;
}

export function clientHistoryTime(value: DateLikeValue | null): number {
  if (!value) return 0;
  const date = typeof value === 'object' && !(value instanceof Date) && 'toDate' in value
    ? value.toDate()
    : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
}

function lineTotal(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.reduce((sum, candidate) => {
    if (!isRecord(candidate)) return sum;
    const price = Number.parseFloat(String(candidate.price ?? 0));
    const quantity = Number.parseFloat(String(candidate.quantity ?? 1));
    return sum + (Number.isFinite(price) ? price : 0) * (Number.isFinite(quantity) ? quantity : 1);
  }, 0);
}

function recordMatchesClient(record: Record<string, unknown>, client: MobileClientSummary): boolean {
  const clientIds = new Set(
    [client.id, client.cid]
      .filter((value) => value !== undefined && value !== null)
      .map(String),
  );
  const recordClientId = record.cid ?? record.clientId;
  if (recordClientId !== undefined && recordClientId !== null && clientIds.has(String(recordClientId))) {
    return true;
  }
  const clientName = (client.name ?? '').trim().toLocaleLowerCase();
  const recordName = optionalString(record.cname ?? record.customerName)?.toLocaleLowerCase();
  return Boolean(clientName && recordName === clientName);
}

function normalizeJob(record: Record<string, unknown>, index: number): ClientHistoryEntry {
  const parts = Array.isArray(record.parts)
    ? record.parts.flatMap((candidate) => {
        if (!isRecord(candidate)) return [];
        const name = optionalString(candidate.partName ?? candidate.name);
        return name ? [name] : [];
      })
    : [];
  const occurredAt = dateLike(record.finishedAt ?? record.completedAt);
  return {
    id: optionalString(record.id) ?? `job-${clientHistoryTime(occurredAt)}-${index}`,
    kind: 'job',
    title: optionalString(record.title ?? record.jobTitle ?? record.description) ?? '—',
    status: optionalString(record.status),
    occurredAt,
    location: optionalString(record.location),
    partNames: parts,
  };
}

function normalizeDocument(record: Record<string, unknown>, index: number): ClientHistoryEntry {
  const totals = isRecord(record.totals) ? Number(record.totals.grandTotal) : Number.NaN;
  const occurredAt = dateLike(record.createdAt);
  const type = typeof record.type === 'string' || typeof record.type === 'number'
    ? record.type
    : undefined;
  return {
    id: optionalString(record.id) ?? `document-${clientHistoryTime(occurredAt)}-${index}`,
    kind: 'document',
    documentType: type,
    documentNumber: record.documentNumber === undefined || record.documentNumber === null
      ? null
      : String(record.documentNumber),
    occurredAt,
    clientName: optionalString(record.cname),
    total: Number.isFinite(totals) ? totals : lineTotal(record.income ?? record.items),
  };
}

export function buildClientHistoryEntries(
  values: readonly unknown[],
  client: MobileClientSummary,
  view: ClientHistoryView,
): ClientHistoryEntry[] {
  return values
    .filter(isRecord)
    .filter((record) => recordMatchesClient(record, client))
    .map((record, index) => (
      view === 'documents' ? normalizeDocument(record, index) : normalizeJob(record, index)
    ))
    .sort((a, b) => clientHistoryTime(b.occurredAt) - clientHistoryTime(a.occurredAt));
}

function localeFor(language: Language): string {
  if (language === 'he') return 'he-IL';
  if (language === 'ar') return 'ar';
  return 'en-US';
}

export function formatClientHistoryDate(value: DateLikeValue | null, language: Language): string {
  const time = clientHistoryTime(value);
  if (!time) return '—';
  return new Intl.DateTimeFormat(localeFor(language), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(time));
}

export function formatClientHistoryMonth(value: Date, language: Language): string {
  return new Intl.DateTimeFormat(localeFor(language), {
    month: 'long',
    year: 'numeric',
  }).format(value);
}
