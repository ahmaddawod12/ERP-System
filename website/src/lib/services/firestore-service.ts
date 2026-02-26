"use client";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentSnapshot,
  type QueryConstraint,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase/client";
import {
  companyBusinessInfoRef,
  companyDocumentsCollection,
  companyClientsCollection,
  companyFinishedJobsCollection,
  companyInventoryRef,
  companyPendingJobsCollection,
  companyWorkersCollection,
  userInventoryRef,
} from "@/lib/firestore-paths";
import type {
  AccountType,
  BusinessInfo,
  DocumentRecord,
  ClientRecord,
  InventoryDoc,
  InventoryPart,
  JobRecord,
  Role,
  UserProfile,
  WorkerProfile,
} from "@/lib/types";

/* ─── helpers ─── */

/**
 * Company scope is always based on the profile companyId
 * returned by backend registration flows.
 */
export function resolveCompanyScope(companyId: string | null): string | null {
  const normalized = companyId?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

/* ─── Profile ─── */

/**
 * Profile writes are now handled by Cloud Functions:
 * - registerBusinessV1 (initial profile + company creation)
 * - updateProfileV1 (name/phoneNumber changes only)
 * Direct client writes to profile are blocked by Firestore rules.
 */

/* ─── Subscription ─── */

/**
 * Subscription writes are now handled by Cloud Functions:
 * - registerBusinessV1 (initial subscription creation)
 * Direct client writes to subscription are blocked by Firestore rules.
 */


/**
 * Company creation is now handled by registerBusinessV1 Cloud Function.
 * This prevents clients from forging companyIds, roles, or document numbers.
 */

/* ─── Workers ─── */

export async function listWorkers(companyId: string): Promise<WorkerProfile[]> {
  const snap = await getDocs(query(companyWorkersCollection(companyId), orderBy("createdAt", "desc")));
  return snap.docs.map((docSnap) => docSnap.data() as WorkerProfile);
}

/**
 * Update worker role via manageWorker Cloud Function (admin-only rules block direct writes).
 * Fetches the worker doc first to get the email (required by manageWorker).
 */
export async function updateWorkerRole(companyId: string, workerId: string, role: Role) {
  // Get the worker's email from their worker doc
  const workerSnap = await getDoc(doc(db, "companies", companyId, "workers", workerId));
  const workerEmail = workerSnap.exists() ? (workerSnap.data() as WorkerProfile).email : "";

  const manageWorkerFn = httpsCallable<
    Record<string, unknown>,
    { success: boolean }
  >(functions, "manageWorker");
  await manageWorkerFn({
    action: "edit",
    companyId,
    workerUid: workerId,
    email: workerEmail,
    role,
  });
}

/* ─── Jobs (company-scoped — used for both team and solo) ─── */

const DEFAULT_PAGE_SIZE = 50;

export async function listJobs(
  companyId: string,
  opts?: {
    role?: Role;
    uid?: string;
    pageSize?: number;
    lastPendingDoc?: DocumentSnapshot;
    lastFinishedDoc?: DocumentSnapshot;
  },
) {
  const pageSize = opts?.pageSize || DEFAULT_PAGE_SIZE;
  let pendingConstraints: QueryConstraint[] = [orderBy("createdAt", "desc"), limit(pageSize)];
  let finishedConstraints: QueryConstraint[] = [orderBy("createdAt", "desc"), limit(pageSize)];

  if (opts?.role === "worker" && opts.uid) {
    // Worker queries use completedBy (canonical field matching phone app + trigger)
    pendingConstraints = [where("completedBy", "==", opts.uid), orderBy("createdAt", "desc"), limit(pageSize)];
    finishedConstraints = [where("completedBy", "==", opts.uid), orderBy("createdAt", "desc"), limit(pageSize)];
  }

  // Cursor-based pagination
  if (opts?.lastPendingDoc) {
    pendingConstraints.push(startAfter(opts.lastPendingDoc));
  }
  if (opts?.lastFinishedDoc) {
    finishedConstraints.push(startAfter(opts.lastFinishedDoc));
  }

  const pendingSnap = await getDocs(query(companyPendingJobsCollection(companyId), ...pendingConstraints));
  const finishedSnap = await getDocs(query(companyFinishedJobsCollection(companyId), ...finishedConstraints));

  return {
    pending: pendingSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<JobRecord, "id">) })),
    finished: finishedSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<JobRecord, "id">) })),
    lastPendingDoc: pendingSnap.docs[pendingSnap.docs.length - 1] ?? null,
    lastFinishedDoc: finishedSnap.docs[finishedSnap.docs.length - 1] ?? null,
    hasMorePending: pendingSnap.docs.length === pageSize,
    hasMoreFinished: finishedSnap.docs.length === pageSize,
  };
}

/** Creates a pending job via createJobV1 Cloud Function (sequential jid). */
export async function createJob(
  companyId: string,
  payload: Omit<JobRecord, "id" | "createdAt" | "updatedAt">,
) {
  const createJobFn = httpsCallable<
    Record<string, unknown>,
    { success: boolean; jobId: string; jid: number }
  >(functions, "createJobV1");
  const result = await createJobFn({ companyId, type: "pending", ...payload });
  return result.data.jobId;
}

/** Solo users create finished jobs directly via createJobV1 Cloud Function. */
export async function createFinishedJob(
  companyId: string,
  payload: Omit<JobRecord, "id" | "createdAt" | "updatedAt" | "status">,
) {
  const createJobFn = httpsCallable<
    Record<string, unknown>,
    { success: boolean; jobId: string; jid: number }
  >(functions, "createJobV1");
  const result = await createJobFn({ companyId, type: "finished", ...payload });
  return result.data.jobId;
}

export async function updateJob(companyId: string, jobId: string, payload: Partial<JobRecord>) {
  // When marking as finished, ONLY use acceptJobV1 Cloud Function for atomic move.
  if (payload.status === "finished") {
    const acceptJobFn = httpsCallable<
      Record<string, unknown>,
      { success: boolean; finishedJobId: string }
    >(functions, "acceptJobV1");
    await acceptJobFn({ companyId, jobId });
    return;
  }

  // All other job updates go through updateJobV1 Cloud Function
  const updateJobFn = httpsCallable<
    Record<string, unknown>,
    { success: boolean; jobId: string }
  >(functions, "updateJobV1");
  await updateJobFn({ companyId, jobId, ...payload });
}

/** Delete a job via deleteJobV1 Cloud Function (enforces isCert check). */
export async function deleteJob(companyId: string, jobId: string) {
  const deleteJobFn = httpsCallable<
    Record<string, unknown>,
    { success: boolean; collection: string }
  >(functions, "deleteJobV1");
  await deleteJobFn({ companyId, jobId });
}

/* ─── Company Inventory (single-doc with parts array) ─── */
/* All mutations via updateInventoryV1 Cloud Function */

export async function getCompanyInventory(companyId: string): Promise<InventoryDoc> {
  const snap = await getDoc(companyInventoryRef(companyId));
  if (!snap.exists()) return { parts: [], nextId: 1, lastUpdated: new Date().toISOString() };
  return snap.data() as InventoryDoc;
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

/* ─── Personal / User Inventory (single-doc with parts array) ─── */

export async function getUserInventory(uid: string): Promise<InventoryDoc> {
  const snap = await getDoc(userInventoryRef(uid));
  if (!snap.exists()) return { parts: [], nextId: 1, lastUpdated: new Date().toISOString() };
  return snap.data() as InventoryDoc;
}

export async function addUserInventoryPart(
  uid: string,
  part: Omit<InventoryPart, "id" | "dateAdded">,
  companyId?: string,
) {
  const fn = httpsCallable(functions, "updateInventoryV1");
  await fn({
    companyId: companyId || uid,
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
  companyId?: string,
) {
  const fn = httpsCallable(functions, "updateInventoryV1");
  await fn({
    companyId: companyId || uid,
    action: "updatePart",
    scope: "user",
    targetUid: uid,
    partId,
    partName: updates.name,
    quantity: updates.quantity,
    lowThreshold: updates.lowThreshold,
  });
}

export async function removeUserInventoryPart(uid: string, partId: number, companyId?: string) {
  const fn = httpsCallable(functions, "updateInventoryV1");
  await fn({
    companyId: companyId || uid,
    action: "removePart",
    scope: "user",
    targetUid: uid,
    partId,
  });
}

/**
 * Worker picks parts from company inventory and adds to personal inventory.
 * Matches the phone app WorkerInventory flow.
 */
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

/* ─── Clients (always company-scoped) ─── */

export async function listClients(
  companyId: string,
  opts?: { pageSize?: number; lastDoc?: DocumentSnapshot },
): Promise<{
  clients: ClientRecord[];
  lastDoc: DocumentSnapshot | null;
  hasMore: boolean;
}> {
  const pageSize = opts?.pageSize || 100;
  const constraints: QueryConstraint[] = [limit(pageSize)];
  if (opts?.lastDoc) {
    constraints.push(startAfter(opts.lastDoc));
  }

  const snap = await getDocs(query(companyClientsCollection(companyId), ...constraints));
  const clients = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<ClientRecord, "id">) }));
  // Sort by numeric document ID — matches phone app behaviour where doc ID = String(cid)
  clients.sort((a, b) => parseInt(a.id) - parseInt(b.id));
  return {
    clients,
    lastDoc: snap.docs[snap.docs.length - 1] ?? null,
    hasMore: snap.docs.length === pageSize,
  };
}

export async function updateClient(companyId: string, clientId: string, payload: Partial<ClientRecord>) {
  const fn = httpsCallable<
    Record<string, unknown>,
    { success: boolean; clientId: string }
  >(functions, "updateClientV1");
  await fn({ companyId, clientId, ...payload });
}

/* ─── Documents ─── */

export async function listDocuments(companyId: string): Promise<DocumentRecord[]> {
  const snap = await getDocs(query(companyDocumentsCollection(companyId), orderBy("createdAt", "desc")));
  return snap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() as Omit<DocumentRecord, "id">),
  }));
}
