"use client";

import {
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
  companyDocumentsCollection,
  companyClientsCollection,
  companyJobsCollection,
  companyInventoryRef,
  companyWorkersCollection,
  userInventoryRef,
} from "@/lib/firestore-paths";
import type {
  DocumentRecord,
  ClientRecord,
  InventoryDoc,
  InventoryPart,
  JobRecord,
  Role,
  WorkerProfile,
} from "@/lib/types";

/* ─── helpers ─── */

/**
 * Thin wrapper around the canonical resolveCompanyScope from @smart-job/contracts.
 * The contracts version throws on empty input; this wrapper returns null instead
 * to keep the website's existing null-check pattern working.
 */
export function resolveCompanyScope(companyId: string | null | undefined): string | null {
  const normalized = (companyId ?? "").trim();
  return normalized || null;
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
export async function updateWorkerRole(companyId: string, wid: string, role: Role) {
  const workerSnap = await getDoc(doc(db, "companies", companyId, "workers", wid));
  if (!workerSnap.exists()) {
    throw new Error("Worker record not found");
  }
  const workerData = workerSnap.data() as WorkerProfile;
  if (!workerData.uid) {
    throw new Error("Worker UID is missing from worker record");
  }

  const manageWorkerFn = httpsCallable<
    Record<string, unknown>,
    { success: boolean }
  >(functions, "manageWorker");
  await manageWorkerFn({
    action: "edit",
    companyId,
    workerUid: workerData.uid,
    wid,
    email: workerData.email,
    role,
  });
}

/* ─── Jobs (company-scoped — used for both team and solo) ─── */

const DEFAULT_PAGE_SIZE = 50;

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
  const pageSize = opts?.pageSize || DEFAULT_PAGE_SIZE;
  const constraints: QueryConstraint[] = [orderBy("createdAt", "desc"), limit(pageSize)];

  if (opts?.role === "worker" && opts.wid) {
    constraints.unshift(where("wid", "==", opts.wid));
  }

  if (opts?.lastDoc) {
    constraints.push(startAfter(opts.lastDoc));
  }

  const snap = await getDocs(query(companyJobsCollection(companyId), ...constraints));
  const allJobs = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<JobRecord, "id">) }));

  return {
    jobs: allJobs,
    pending: allJobs.filter((j) => isPendingLikeStatus(j.status)),
    finished: allJobs.filter((j) => isClosedJobStatus(j.status)),
    lastDoc: snap.docs[snap.docs.length - 1] ?? null,
    hasMore: snap.docs.length === pageSize,
  };
}

/** Creates a job via createJobV1 Cloud Function (sequential jid). */
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

/** Solo users create finished jobs directly via createJobV1 (status: finished in jobs collection). */
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
  // When marking as finished, use acceptJobV1 Cloud Function to set status in place.
  if (payload.status === "finished") {
    const acceptJobFn = httpsCallable<
      Record<string, unknown>,
      { success: boolean; jobId: string }
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
    { success: boolean; jobId: string }
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
  const clients = snap.docs.map((docSnap) => {
    const raw = docSnap.data() as Record<string, unknown>;
    const createdAt =
      typeof raw.createdAt === "string" && raw.createdAt.trim()
        ? raw.createdAt
        : new Date().toISOString();

    return {
      id: docSnap.id,
      numericId:
        typeof raw.cid === "number"
          ? raw.cid
          : Number.isFinite(Number(docSnap.id))
            ? Number(docSnap.id)
            : undefined,
      name: String(raw.name ?? raw.cname ?? ""),
      email: typeof raw.email === "string" ? raw.email : undefined,
      phone: typeof raw.phone === "string" ? raw.phone : (typeof raw.cphone === "string" ? raw.cphone : undefined),
      address: typeof raw.address === "string" ? raw.address : undefined,
      notes: typeof raw.notes === "string" ? raw.notes : undefined,
      city: typeof raw.city === "string" ? raw.city : undefined,
      vatNumber: typeof raw.vatNumber === "string" ? raw.vatNumber : undefined,
      createdAt,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
    } satisfies ClientRecord;
  });
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
