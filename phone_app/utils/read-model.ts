/**
 * read-model.ts
 *
 * Transitional read-model wrappers. Migrated callers use the Cloud API
 * directly through their module-specific API clients. These wrappers remain
 * for screens that have not yet been individually cut over.
 */

import { fetchWorkersPage } from '../modules/workers/lib/workers-api';
import { fetchInventoryPage } from '../modules/inventory/lib/inventory-api';
import { normalizeInventoryListFilters } from '../modules/inventory/lib/inventory-list-model';
import { fetchJobsPage as fetchJobsPageApi } from '../modules/jobs/lib/jobs-api';
import { fetchDocumentsPage as fetchDocumentsPageApi } from '../modules/documents/lib/documents-api';
import { mapJobSummary, normalizeJobListFilters } from '../modules/jobs/lib/job-list-model';
import { mapDocumentSummary, normalizeDocumentListFilters } from '../modules/documents/lib/document-history-model';
import { auth } from '../lib/auth/transport';

const MAX_CURSOR_WINDOW_PAGES = 5;
const MAX_CURSOR_WINDOW_ITEMS = 1_000;

function numericCompanyId(companyId: string): number {
  const n = Number(companyId);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error('A valid company is required');
  }
  return n;
}

function currentUid(): string {
  const uid = auth.currentUser?.uid?.trim();
  if (!uid) throw new Error('Authentication is required');
  return uid;
}

function positiveLimit(value: unknown, fallback = MAX_CURSOR_WINDOW_ITEMS): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_CURSOR_WINDOW_ITEMS, Math.max(1, Math.trunc(value)))
    : fallback;
}

function normalizeWorker(worker: any) {
  return {
    ...worker,
    uid: String(worker?.uid ?? '').trim(),
    wid: String(worker?.wid ?? worker?.memberNo ?? '').trim(),
    email: String(worker?.email ?? '').trim(),
    name: String(worker?.name ?? '').trim(),
    phoneNumber: String(worker?.phoneNumber ?? worker?.phone ?? '').trim(),
  };
}

async function fetchCursorWindow<T>(
  fetchPage: (afterCursor: string | null) => Promise<{ items: readonly T[]; nextCursor: string | null }>,
  maximumItems = MAX_CURSOR_WINDOW_ITEMS,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < MAX_CURSOR_WINDOW_PAGES; i++) {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    if (items.length >= maximumItems) return items.slice(0, maximumItems);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return items;
}

export async function fetchCompanyWorkers(companyId: string) {
  const numericId = numericCompanyId(companyId);
  const items = await fetchCursorWindow((cursor) =>
    fetchWorkersPage({ uid: currentUid(), companyId: numericId, afterCursor: cursor }),
  );
  return items.map(normalizeWorker).filter((worker) => worker.wid || worker.uid || worker.email);
}

export async function fetchCompanyInventoryParts(companyId: string) {
  const numericId = numericCompanyId(companyId);
  const filters = normalizeInventoryListFilters({ pageSize: 200 });
  const items = await fetchCursorWindow((cursor) =>
    fetchInventoryPage({ uid: currentUid(), companyId: numericId, scope: 'company', filters, afterCursor: cursor }),
  );
  return items.map((part: any) => ({ ...part, id: part.partId ?? part.id }));
}

export async function fetchUserInventoryParts(companyId: string, targetMemberNo: string | number) {
  const numericId = numericCompanyId(companyId);
  const memberNo = Number(targetMemberNo);
  if (!Number.isSafeInteger(memberNo) || memberNo <= 0) {
    throw new Error('A valid member number is required');
  }
  const filters = normalizeInventoryListFilters({ pageSize: 200 });
  const items = await fetchCursorWindow((cursor) =>
    fetchInventoryPage({
      uid: currentUid(),
      companyId: numericId,
      scope: 'member',
      filters,
      afterCursor: cursor,
      targetMemberNo: memberNo,
    }),
  );
  return items.map((part: any) => ({ ...part, id: part.partId ?? part.id }));
}

export async function fetchCompanyJobs(companyId: string, limitOrOptions?: number | Record<string, any>) {
  const numericId = numericCompanyId(companyId);
  const options = typeof limitOrOptions === 'number' ? { limit: limitOrOptions } : limitOrOptions ?? {};
  const limit = positiveLimit(options.limit);
  const filters = normalizeJobListFilters({
    pageSize: Math.min(200, limit),
    ...(options.status ? { status: options.status } : {}),
    ...(options.dateField ? { dateField: options.dateField } : {}),
    ...(options.dateFrom ? { dateFrom: options.dateFrom } : {}),
    ...(options.dateTo ? { dateTo: options.dateTo } : {}),
    ...(options.creatorUid ? { creatorUid: options.creatorUid } : {}),
    ...(options.search ? { search: options.search } : {}),
  });
  const items = await fetchCursorWindow(
    (cursor) => fetchJobsPageApi({ uid: currentUid(), companyId: numericId, filters, afterCursor: cursor }),
    limit,
  );
  return items.map(mapJobSummary);
}

export async function fetchCompanyJobsPage(companyId: string, options: Record<string, any> = {}) {
  const numericId = numericCompanyId(companyId);
  const filters = normalizeJobListFilters({
    pageSize: options.pageSize ?? 50,
    ...(options.status ? { status: options.status } : {}),
    ...(options.dateField ? { dateField: options.dateField } : {}),
    ...(options.dateFrom ? { dateFrom: options.dateFrom } : {}),
    ...(options.dateTo ? { dateTo: options.dateTo } : {}),
  });
  const page = await fetchJobsPageApi({
    uid: currentUid(),
    companyId: numericId,
    filters,
    afterCursor: options.afterCursor ?? null,
  });
  return { items: page.items.map(mapJobSummary), nextCursor: page.nextCursor };
}

export async function fetchCompanyDocuments(companyId: string, limitOrOptions?: number | Record<string, any>) {
  const numericId = numericCompanyId(companyId);
  const options = typeof limitOrOptions === 'number' ? { limit: limitOrOptions } : limitOrOptions ?? {};
  const limit = positiveLimit(options.limit);
  const filters = normalizeDocumentListFilters({
    pageSize: Math.min(200, limit),
    ...(options.status ? { status: options.status } : {}),
    ...(options.documentType ? { documentType: options.documentType } : {}),
    ...(options.createdByUid ? { createdByUid: options.createdByUid } : {}),
    ...(options.dateFrom ? { dateFrom: options.dateFrom } : {}),
    ...(options.dateTo ? { dateTo: options.dateTo } : {}),
    ...(options.search ? { search: options.search } : {}),
  });
  const items = await fetchCursorWindow(
    (cursor) => fetchDocumentsPageApi({ uid: currentUid(), companyId: numericId, filters, afterCursor: cursor }),
    limit,
  );
  return items.map(mapDocumentSummary);
}

export async function fetchCompanyDocumentsPage(companyId: string, options: Record<string, any> = {}) {
  const numericId = numericCompanyId(companyId);
  const filters = normalizeDocumentListFilters({
    pageSize: options.pageSize ?? 50,
    ...(options.dateFrom ? { dateFrom: options.dateFrom } : {}),
    ...(options.dateTo ? { dateTo: options.dateTo } : {}),
  });
  const page = await fetchDocumentsPageApi({
    uid: currentUid(),
    companyId: numericId,
    filters,
    afterCursor: options.afterCursor ?? null,
  });
  return { items: page.items.map(mapDocumentSummary), nextCursor: page.nextCursor };
}
