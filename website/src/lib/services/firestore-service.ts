"use client";

import type { DocumentSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase/client";
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
  jobs: JobRecord[];
  documents: DocumentRecord[];
}

export function resolveCompanyScope(companyId: string | null | undefined): string | null {
  const normalized = (companyId ?? "").trim();
  return normalized || null;
}

async function fetchReadModel<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/read-model", {
    method: "POST",
    headers: await buildAuthedJsonHeaders(),
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as ClientApiResponse<T>;
  if (!response.ok || !payload.ok) {
    throw new Error(getClientApiErrorMessage(payload, "Read model request failed"));
  }
  return payload.data;
}

export async function loadBootstrapReadModel(companyId?: string | null, includeCollections = false) {
  return fetchReadModel<BootstrapReadModel>({
    kind: "bootstrap",
    ...(companyId ? { companyId } : {}),
    includeCollections,
  });
}

export async function listWorkers(companyId: string): Promise<WorkerProfile[]> {
  return fetchReadModel<WorkerProfile[]>({ kind: "workers", companyId });
}

export async function updateWorkerRole(companyId: string, workerUid: string, wid: string, role: Role) {
  if (!workerUid) {
    throw new Error("Worker UID is required");
  }

  const manageWorkerFn = httpsCallable<Record<string, unknown>, { success: boolean }>(functions, "manageWorker");
  await manageWorkerFn({
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
    lastDoc?: DocumentSnapshot;
  },
) {
  if (!canListCompanyJobs(opts?.role, opts?.wid ?? null)) {
    return {
      jobs: [],
      pending: [],
      finished: [],
      lastDoc: null,
      hasMore: false,
    };
  }

  const allJobs = await fetchReadModel<JobRecord[]>({ kind: "jobs", companyId });
  return {
    jobs: allJobs,
    pending: allJobs.filter((job) => isPendingLikeStatus(job.status)),
    finished: allJobs.filter((job) => isClosedJobStatus(job.status)),
    lastDoc: null as DocumentSnapshot | null,
    hasMore: false,
  };
}

export async function createJob(
  companyId: string,
  payload: Omit<JobRecord, "id" | "createdAt" | "updatedAt">,
) {
  const createJobFn = httpsCallable<Record<string, unknown>, { success: boolean; jobId: string; jid: number }>(functions, "createJobV1");
  const result = await createJobFn({ companyId, type: "pending", ...payload });
  return result.data.jobId;
}

export async function createFinishedJob(
  companyId: string,
  payload: Omit<JobRecord, "id" | "createdAt" | "updatedAt" | "status">,
) {
  const createJobFn = httpsCallable<Record<string, unknown>, { success: boolean; jobId: string; jid: number }>(functions, "createJobV1");
  const result = await createJobFn({ companyId, type: "finished", ...payload });
  return result.data.jobId;
}

export async function updateJob(companyId: string, jobId: string, payload: Partial<JobRecord>) {
  if (payload.status === "finished") {
    const acceptJobFn = httpsCallable<Record<string, unknown>, { success: boolean; jobId: string }>(functions, "acceptJobV1");
    await acceptJobFn({ companyId, jobId });
    return;
  }

  const updateJobFn = httpsCallable<Record<string, unknown>, { success: boolean; jobId: string }>(functions, "updateJobV1");
  await updateJobFn({ companyId, jobId, ...payload });
}

export async function deleteJob(companyId: string, jobId: string) {
  const deleteJobFn = httpsCallable<Record<string, unknown>, { success: boolean; jobId: string }>(functions, "deleteJobV1");
  await deleteJobFn({ companyId, jobId });
}

export async function getCompanyInventory(companyId: string): Promise<InventoryDoc> {
  return fetchReadModel<InventoryDoc>({ kind: "inventory", companyId, scope: "company" });
}

export async function addCompanyInventoryPart(
  companyId: string,
  part: Omit<InventoryPart, "id" | "dateAdded">,
) {
  const fn = httpsCallable(functions, "updateInventoryV1");
  await fn({
    companyId,
    action: "addPart",
    scope: "company",
    partName: part.name,
    active: part.active ?? true,
  });
}

export async function toggleCompanyInventoryPart(companyId: string, partId: number) {
  const fn = httpsCallable(functions, "updateInventoryV1");
  await fn({ companyId, action: "togglePart", scope: "company", partId });
}

export async function removeCompanyInventoryPart(companyId: string, partId: number) {
  const fn = httpsCallable(functions, "updateInventoryV1");
  await fn({ companyId, action: "removePart", scope: "company", partId });
}

export async function getUserInventory(uid: string): Promise<InventoryDoc> {
  return fetchReadModel<InventoryDoc>({ kind: "inventory", scope: "user", targetUid: uid });
}

export async function addUserInventoryPart(
  uid: string,
  part: Omit<InventoryPart, "id" | "dateAdded">,
  companyId: string,
) {
  const fn = httpsCallable(functions, "updateInventoryV1");
  await fn({
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
  const fn = httpsCallable(functions, "updateInventoryV1");
  await fn({
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
  const fn = httpsCallable(functions, "updateInventoryV1");
  await fn({
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
  const fn = httpsCallable(functions, "updateInventoryV1");
  await fn({
    companyId,
    action: "pickParts",
    scope: "company",
    targetUid: uid,
    partsToPick,
  });
}

export async function listClients(
  companyId: string,
  opts?: { pageSize?: number; lastDoc?: DocumentSnapshot },
): Promise<{
  clients: ClientRecord[];
  lastDoc: DocumentSnapshot | null;
  hasMore: boolean;
}> {
  const clients = await fetchReadModel<ClientRecord[]>({ kind: "clients", companyId });
  return {
    clients,
    lastDoc: null,
    hasMore: false,
  };
}

export async function updateClient(companyId: string, clientId: string, payload: Partial<ClientRecord>) {
  const fn = httpsCallable<Record<string, unknown>, { success: boolean; clientId: string }>(functions, "updateClientV1");
  await fn({ companyId, clientId, ...payload });
}

export async function listDocuments(companyId: string): Promise<DocumentRecord[]> {
  return fetchReadModel<DocumentRecord[]>({ kind: "documents", companyId });
}

export async function getDocumentDownloadUrl(companyId: string, documentId: string): Promise<string> {
  const callable = httpsCallable<{ companyId: string; documentId: string }, { success: boolean; downloadURL?: string }>(
    functions,
    "createDocumentDownloadUrlV1",
  );
  const result = await callable({ companyId, documentId });
  if (!result.data.success || !result.data.downloadURL) {
    throw new Error("Document download URL is unavailable");
  }
  return result.data.downloadURL;
}
