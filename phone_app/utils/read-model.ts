import { callHttpFunction } from './httpFunctions';

type ReadModelListOptions = {
  limit?: number;
  pageSize?: number;
  afterCursor?: string;
  status?: string | string[];
  dateField?: 'createdAt' | 'updatedAt' | 'finishedAt' | 'dueAt' | 'documentDate';
  dateFrom?: string;
  dateTo?: string;
  documentType?: number;
  createdByUid?: string;
};

type ReadModelPage<T = any> = {
  items?: T[];
  nextCursor?: string | null;
};

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

export async function fetchCompanyWorkers(companyId: string) {
  const workers = await callHttpFunction<any[]>('readModelV1', {
    kind: 'workers',
    companyId,
  });

  return (workers || [])
    .map(normalizeWorker)
    .filter((worker) => worker.wid || worker.uid || worker.email);
}

export async function fetchCompanyInventoryParts(companyId: string) {
  const inventory = await callHttpFunction<{ parts?: any[] }>('readModelV1', {
    kind: 'inventory',
    companyId,
    scope: 'company',
  });

  return Array.isArray(inventory?.parts) ? inventory.parts : [];
}

export async function fetchUserInventoryParts(companyId: string, targetUid: string) {
  const inventory = await callHttpFunction<{ parts?: any[] }>('readModelV1', {
    kind: 'inventory',
    companyId,
    scope: 'user',
    targetUid,
  });

  return Array.isArray(inventory?.parts) ? inventory.parts : [];
}

function normalizeListOptions(limitOrOptions?: number | ReadModelListOptions): ReadModelListOptions {
  if (typeof limitOrOptions === 'number') {
    return { limit: limitOrOptions };
  }
  return limitOrOptions || {};
}

export async function fetchCompanyJobs(companyId: string, limitOrOptions?: number | ReadModelListOptions) {
  const options = normalizeListOptions(limitOrOptions);
  if (options.limit && options.limit > 200) {
    return fetchAllReadModelPages('jobs', companyId, options);
  }
  const result = await callHttpFunction<ReadModelPage>('readModelV1', {
    kind: 'jobs',
    companyId,
    ...options,
  });
  return Array.isArray(result?.items) ? result.items : [];
}

export async function fetchCompanyJobsPage(companyId: string, options: ReadModelListOptions = {}) {
  const result = await callHttpFunction<ReadModelPage>('readModelV1', {
    kind: 'jobs',
    companyId,
    ...options,
  });
  return {
    items: Array.isArray(result?.items) ? result.items : [],
    nextCursor: result?.nextCursor || null,
  };
}

export async function fetchCompanyDocuments(companyId: string, limitOrOptions?: number | ReadModelListOptions) {
  const options = normalizeListOptions(limitOrOptions);
  if (options.limit && options.limit > 200) {
    return fetchAllReadModelPages('documents', companyId, options);
  }
  const result = await callHttpFunction<ReadModelPage>('readModelV1', {
    kind: 'documents',
    companyId,
    ...options,
  });
  return Array.isArray(result?.items) ? result.items : [];
}

export async function fetchCompanyDocumentsPage(companyId: string, options: ReadModelListOptions = {}) {
  const result = await callHttpFunction<ReadModelPage>('readModelV1', {
    kind: 'documents',
    companyId,
    ...options,
  });
  return {
    items: Array.isArray(result?.items) ? result.items : [],
    nextCursor: result?.nextCursor || null,
  };
}

async function fetchAllReadModelPages(kind: 'jobs' | 'documents', companyId: string, options: ReadModelListOptions) {
  const targetLimit = Math.min(Number(options.limit || 10_000), 10_000);
  const pageSize = Math.min(Number(options.pageSize || 200), 200);
  const items: any[] = [];
  let afterCursor = options.afterCursor || undefined;

  while (items.length < targetLimit) {
    const result = await callHttpFunction<ReadModelPage>('readModelV1', {
      ...options,
      kind,
      companyId,
      limit: undefined,
      pageSize: Math.min(pageSize, targetLimit - items.length),
      ...(afterCursor ? { afterCursor } : {}),
    });
    const pageItems = Array.isArray(result?.items) ? result.items : [];
    items.push(...pageItems);
    if (!result?.nextCursor || pageItems.length === 0) {
      break;
    }
    afterCursor = result.nextCursor;
  }

  return items;
}

export async function fetchRecordById(companyId: string, recordId: string) {
  return callHttpFunction<any | null>('readModelV1', {
    kind: 'recordById',
    companyId,
    recordId,
  });
}
