"use client";

import { getClientApiErrorMessage, type ClientApiResponse } from "@/lib/api/client";
import { buildAuthedJsonHeaders } from "@/lib/firebase/client-auth";
import { canListCompanyJobs } from "@/lib/job-access";
import type {
  ClientRecord,
  DocumentRecord,
  InventoryDoc,
  InventoryPart,
  JobRecord,
  Role,
  UserProfile,
  UserSubscription,
  WorkerProfile,
} from "@/lib/types";

interface BootstrapReadModel {
  profile: UserProfile | null;
  subscription: UserSubscription | null;
  businessInfo: Record<string, unknown> | null;
  inventory: InventoryDoc;
  companyInventory: InventoryDoc;
  workers: WorkerProfile[];
  clients: ClientRecord[];
  clientsNextCursor?: string | null;
  jobs: JobRecord[];
  documents: DocumentRecord[];
  jobsNextCursor?: string | null;
  documentsNextCursor?: string | null;
  counts?: {
    jobs: number;
    clients: number;
    documents: number;
    inventoryParts: number;
    companyInventoryParts: number;
    workers: number;
  };
}

type CallableOperation =
  | "manageWorker"
  | "createJobV1"
  | "updateJobV1"
  | "deleteJobV1"
  | "acceptJobV1"
  | "updateInventoryV1"
  | "addClientV1"
  | "deleteClientV1"
  | "updateClientV1"
  | "createDocumentDownloadUrlV1"
  | "updateProfileV1";

export function resolveCompanyScope(companyId: string | null | undefined): string | null {
  const normalized = (companyId ?? "").trim();
  return normalized || null;
}

async function fetchReadModel<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/read-model", {
    method: "POST",
    headers: await buildAuthedJsonHeaders(),
    body: JSON.stringify(body),
    signal,
  });
  const payload = (await response.json()) as ClientApiResponse<T>;
  if (!response.ok || !payload.ok) {
    throw new Error(getClientApiErrorMessage(payload, "Read model request failed"));
  }
  return payload.data;
}

async function callServerCallable<T>(
  operation: CallableOperation,
  payload: Record<string, unknown>,
): Promise<T> {
  const response = await fetch("/api/callable", {
    method: "POST",
    headers: await buildAuthedJsonHeaders(),
    body: JSON.stringify({ operation, payload }),
  });

  const bodyPayload = (await response.json()) as ClientApiResponse<T>;
  if (!response.ok || !bodyPayload.ok) {
    throw new Error(getClientApiErrorMessage(bodyPayload, "Callable request failed"));
  }
  return bodyPayload.data;
}

export async function loadBootstrapReadModel(companyId?: string | null, includeCollections = false) {
  return fetchReadModel<BootstrapReadModel>({
    kind: "bootstrap",
    ...(companyId ? { companyId } : {}),
    includeCollections,
  });
}

export async function loadOverviewCounts(companyId: string) {
  const payload = await fetchReadModel<BootstrapReadModel | NonNullable<BootstrapReadModel["counts"]>>({
    kind: "bootstrap",
    companyId,
    includeCollections: false,
    countOnly: true,
  });
  if ("counts" in payload && payload.counts) {
    return payload.counts;
  }
  return payload as NonNullable<BootstrapReadModel["counts"]>;
}

export async function listWorkers(companyId: string): Promise<WorkerProfile[]> {
  return fetchReadModel<WorkerProfile[]>({ kind: "workers", companyId });
}

export async function updateWorkerRole(companyId: string, workerUid: string, wid: string, role: Role) {
  if (!workerUid) {
    throw new Error("Worker UID is required");
  }

  await callServerCallable<{ success: boolean }>("manageWorker", {
    action: "edit",
    companyId,
    workerUid,
    wid,
    role,
  });
}

function isPendingLikeStatus(status: JobRecord["status"] | string | undefined) {
  const normalized = String(status ?? "").toLowerCase();
  return normalized === "pending" || normalized === "waiting";
}

function isClosedJobStatus(status: JobRecord["status"] | string | undefined) {
  const normalized = String(status ?? "").toLowerCase();
  return normalized === "finished" || normalized === "denied";
}

export async function listJobs(
  companyId: string,
  opts?: {
    role?: Role;
    wid?: string;
    pageSize?: number;
    afterCursor?: string;
  },
  signal?: AbortSignal,
) {
  if (!canListCompanyJobs(opts?.role, opts?.wid ?? null)) {
    return {
      jobs: [],
      pending: [],
      finished: [],
      nextCursor: null,
      hasMore: false,
    };
  }

  const body: Record<string, unknown> = { kind: "jobs", companyId };
  if (opts?.pageSize) body.pageSize = opts.pageSize;
  if (opts?.afterCursor) body.afterCursor = opts.afterCursor;

  const result = await fetchReadModel<{ items: JobRecord[]; nextCursor: string | null }>(body, signal);
  const allJobs = result.items ?? [];
  return {
    jobs: allJobs,
    pending: allJobs.filter((job) => isPendingLikeStatus(job.status)),
    finished: allJobs.filter((job) => isClosedJobStatus(job.status)),
    nextCursor: result.nextCursor ?? null,
    hasMore: Boolean(result.nextCursor),
  };
}

export async function createJob(
  companyId: string,
  payload: Omit<JobRecord, "id" | "createdAt" | "updatedAt">,
) {
  const result = await callServerCallable<{ success: boolean; jobId: string; jobNo: number }>("createJobV1", {
    companyId,
    type: "pending",
    ...payload,
  });
  return result.jobId;
}

export async function createFinishedJob(
  companyId: string,
  payload: Omit<JobRecord, "id" | "createdAt" | "updatedAt" | "status">,
) {
  const result = await callServerCallable<{ success: boolean; jobId: string; jobNo: number }>("createJobV1", {
    companyId,
    type: "finished",
    ...payload,
  });
  return result.jobId;
}

export async function updateJob(companyId: string, jobId: string, payload: Partial<JobRecord>) {
  if (payload.status === "finished") {
    await callServerCallable<{ success: boolean; jobId: string }>("acceptJobV1", { companyId, jobId });
    return;
  }

  await callServerCallable<{ success: boolean; jobId: string }>("updateJobV1", {
    companyId,
    jobId,
    ...payload,
  });
}

export async function deleteJob(companyId: string, jobId: string) {
  await callServerCallable<{ success: boolean; jobId: string }>("deleteJobV1", { companyId, jobId });
}

export async function getCompanyInventory(companyId: string): Promise<InventoryDoc> {
  return fetchReadModel<InventoryDoc>({ kind: "inventory", companyId, scope: "company" });
}

export async function addCompanyInventoryPart(
  companyId: string,
  part: Omit<InventoryPart, "id" | "dateAdded">,
) {
  await callServerCallable<{ success: boolean }>("updateInventoryV1", {
    companyId,
    action: "addPart",
    scope: "company",
    partName: part.name,
    active: part.active ?? true,
  });
}

export async function toggleCompanyInventoryPart(companyId: string, partId: number) {
  await callServerCallable<{ success: boolean }>("updateInventoryV1", {
    companyId,
    action: "togglePart",
    scope: "company",
    partId,
  });
}

export async function removeCompanyInventoryPart(companyId: string, partId: number) {
  await callServerCallable<{ success: boolean }>("updateInventoryV1", {
    companyId,
    action: "removePart",
    scope: "company",
    partId,
  });
}

export async function getUserInventory(companyId: string, uid: string): Promise<InventoryDoc> {
  return fetchReadModel<InventoryDoc>({
    kind: "inventory",
    companyId,
    scope: "user",
    targetUid: uid,
  });
}

export async function addUserInventoryPart(
  uid: string,
  part: Omit<InventoryPart, "id" | "dateAdded">,
  companyId: string,
) {
  await callServerCallable<{ success: boolean }>("updateInventoryV1", {
    companyId,
    action: "addPart",
    scope: "user",
    targetUid: uid,
    partName: part.name,
    quantity: part.quantity ?? 0,
    lowThreshold: part.lowThreshold ?? 0,
  });
}

export async function updateUserInventoryPart(
  uid: string,
  partId: number,
  updates: Partial<Pick<InventoryPart, "name" | "quantity" | "lowThreshold">>,
  companyId: string,
) {
  await callServerCallable<{ success: boolean }>("updateInventoryV1", {
    companyId,
    action: "updatePart",
    scope: "user",
    targetUid: uid,
    partId,
    partName: updates.name,
    quantity: updates.quantity,
    lowThreshold: updates.lowThreshold,
  });
}

export async function removeUserInventoryPart(uid: string, partId: number, companyId: string) {
  await callServerCallable<{ success: boolean }>("updateInventoryV1", {
    companyId,
    action: "removePart",
    scope: "user",
    targetUid: uid,
    partId,
  });
}

export async function pickCompanyParts(
  companyId: string,
  uid: string,
  partsToPick: Array<{ id: number; name: string; quantity: number }>,
) {
  await callServerCallable<{ success: boolean }>("updateInventoryV1", {
    companyId,
    action: "pickParts",
    scope: "company",
    targetUid: uid,
    partsToPick,
  });
}

export async function listClients(
  companyId: string,
  opts?: { pageSize?: number; afterCursor?: string | null; lastDoc?: string | null; search?: string },
): Promise<{
  clients: ClientRecord[];
  items: ClientRecord[];
  nextCursor: string | null;
  lastDoc: string | null;
  hasMore: boolean;
}> {
  const wantsSinglePage = Boolean(opts?.pageSize || opts?.afterCursor || opts?.lastDoc || opts?.search);
  const fetchClientPage = async (afterCursor?: string | null) => {
    const body: Record<string, unknown> = {
      kind: "clients",
      companyId,
      pageSize: opts?.pageSize ?? 200,
    };
    const cursor = afterCursor || opts?.afterCursor || opts?.lastDoc || null;
    if (cursor) body.afterCursor = cursor;
    if (opts?.search) body.search = opts.search;
    const result = await fetchReadModel<{ items: ClientRecord[]; nextCursor: string | null }>(body);
    const items = result.items ?? [];
    const nextCursor = result.nextCursor ?? null;
    return {
      clients: items,
      items,
      nextCursor,
      lastDoc: nextCursor,
      hasMore: Boolean(nextCursor),
    };
  };

  if (wantsSinglePage) {
    return fetchClientPage();
  }

  const clients: ClientRecord[] = [];
  let afterCursor: string | null = null;
  const seenCursors = new Set<string>();

  do {
    const page = await fetchClientPage(afterCursor);
    clients.push(...page.clients);
    const nextCursor = page.nextCursor && page.nextCursor.trim() ? page.nextCursor.trim() : null;
    if (!nextCursor || seenCursors.has(nextCursor)) {
      afterCursor = null;
      continue;
    }
    seenCursors.add(nextCursor);
    afterCursor = nextCursor;
  } while (afterCursor);

  return {
    clients,
    items: clients,
    nextCursor: null,
    lastDoc: null,
    hasMore: false,
  };
}

export async function updateClient(companyId: string, clientId: string, payload: Partial<ClientRecord>) {
  await callServerCallable<{ success: boolean; clientId: string }>("updateClientV1", {
    companyId,
    clientId,
    ...payload,
  });
}

export async function createClient(companyId: string, payload: object) {
  await callServerCallable<{ success: boolean; clientId: string }>("addClientV1", {
    companyId,
    ...(payload as Record<string, unknown>),
  });
}

export async function deleteClient(companyId: string, clientId: string) {
  await callServerCallable<{ success: boolean; clientId: string }>("deleteClientV1", { companyId, clientId });
}

export async function listDocuments(
  companyId: string,
  opts?: { pageSize?: number; afterCursor?: string },
  signal?: AbortSignal,
): Promise<{ items: DocumentRecord[]; nextCursor: string | null }> {
  const body: Record<string, unknown> = { kind: "documents", companyId };
  if (opts?.pageSize) body.pageSize = opts.pageSize;
  if (opts?.afterCursor) body.afterCursor = opts.afterCursor;
  return fetchReadModel<{ items: DocumentRecord[]; nextCursor: string | null }>(body, signal);
}

export async function getDocumentDownloadUrl(companyId: string, documentId: string): Promise<string> {
  const result = await callServerCallable<{ success: boolean; downloadURL?: string }>(
    "createDocumentDownloadUrlV1",
    { companyId, documentId },
  );
  if (!result.success || !result.downloadURL) {
    throw new Error("Document download URL is unavailable");
  }
  return result.downloadURL;
}

export async function updateProfile(values: { name: string; phoneNumber: string }) {
  await callServerCallable<{ success: boolean }>("updateProfileV1", values);
}
