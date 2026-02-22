"use client";

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type QueryConstraint,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase/client";
import {
  companyBusinessInfoRef,
  companyCertificationsCollection,
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
  CertificationRecord,
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

export async function listJobs(companyId: string, opts?: { role?: Role; uid?: string }) {
  let constraints: QueryConstraint[] = [orderBy("createdAt", "desc")];
  if (opts?.role === "worker" && opts.uid) {
    // Worker queries use completedBy (canonical field matching phone app + trigger)
    constraints = [where("completedBy", "==", opts.uid), orderBy("createdAt", "desc")];
  }
  const pendingSnap = await getDocs(query(companyPendingJobsCollection(companyId), ...constraints));
  const finishedConstraints =
    opts?.role === "worker" && opts.uid
      ? [where("completedBy", "==", opts.uid), orderBy("createdAt", "desc")]
      : [orderBy("createdAt", "desc")];
  const finishedSnap = await getDocs(query(companyFinishedJobsCollection(companyId), ...finishedConstraints));

  return {
    pending: pendingSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<JobRecord, "id">) })),
    finished: finishedSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<JobRecord, "id">) })),
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
  // Never set status='finished' on the pending doc client-side (leaves invalid state if CF fails).
  if (payload.status === "finished") {
    const acceptJobFn = httpsCallable<
      Record<string, unknown>,
      { success: boolean; finishedJobId: string }
    >(functions, "acceptJobV1");
    await acceptJobFn({ companyId, jobId });
    return;
  }

  const pendingRef = doc(db, "companies", companyId, "PendingJobs", jobId);
  const pendingSnap = await getDoc(pendingRef);
  if (!pendingSnap.exists()) return;

  const merged = { ...pendingSnap.data(), ...payload, updatedAt: new Date().toISOString() };
  await updateDoc(pendingRef, merged);
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

export async function getCompanyInventory(companyId: string): Promise<InventoryDoc> {
  const snap = await getDoc(companyInventoryRef(companyId));
  if (!snap.exists()) return { parts: [], nextId: 1, lastUpdated: new Date().toISOString() };
  return snap.data() as InventoryDoc;
}

export async function addCompanyInventoryPart(
  companyId: string,
  part: Omit<InventoryPart, "id" | "dateAdded">,
) {
  const invRef = companyInventoryRef(companyId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(invRef);
    const data = snap.exists() ? (snap.data() as InventoryDoc) : { parts: [], nextId: 1, lastUpdated: "" };
    const newPart: InventoryPart = {
      id: data.nextId,
      name: part.name,
      active: part.active ?? true,
      dateAdded: new Date().toISOString(),
    };
    tx.set(
      invRef,
      {
        parts: [...data.parts, newPart],
        nextId: data.nextId + 1,
        lastUpdated: new Date().toISOString(),
      },
      { merge: true },
    );
  });
}

export async function toggleCompanyInventoryPart(companyId: string, partId: number) {
  const invRef = companyInventoryRef(companyId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(invRef);
    if (!snap.exists()) return;
    const data = snap.data() as InventoryDoc;
    const updatedParts = data.parts.map((p) =>
      p.id === partId ? { ...p, active: !p.active } : p,
    );
    tx.update(invRef, { parts: updatedParts, lastUpdated: new Date().toISOString() });
  });
}

export async function removeCompanyInventoryPart(companyId: string, partId: number) {
  const invRef = companyInventoryRef(companyId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(invRef);
    if (!snap.exists()) return;
    const data = snap.data() as InventoryDoc;
    tx.update(invRef, {
      parts: data.parts.filter((p) => p.id !== partId),
      lastUpdated: new Date().toISOString(),
    });
  });
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
) {
  const invRef = userInventoryRef(uid);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(invRef);
    const data = snap.exists() ? (snap.data() as InventoryDoc) : { parts: [], nextId: 1, lastUpdated: "" };
    const newPart: InventoryPart = {
      id: data.nextId,
      name: part.name,
      quantity: part.quantity ?? 0,
      lowThreshold: part.lowThreshold ?? 0,
      dateAdded: new Date().toISOString(),
    };
    tx.set(
      invRef,
      {
        parts: [...data.parts, newPart],
        nextId: data.nextId + 1,
        lastUpdated: new Date().toISOString(),
      },
      { merge: true },
    );
  });
}

export async function updateUserInventoryPart(
  uid: string,
  partId: number,
  updates: Partial<Pick<InventoryPart, "name" | "quantity" | "lowThreshold">>,
) {
  const invRef = userInventoryRef(uid);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(invRef);
    if (!snap.exists()) return;
    const data = snap.data() as InventoryDoc;
    const updatedParts = data.parts.map((p) =>
      p.id === partId ? { ...p, ...updates } : p,
    );
    tx.update(invRef, { parts: updatedParts, lastUpdated: new Date().toISOString() });
  });
}

export async function removeUserInventoryPart(uid: string, partId: number) {
  const invRef = userInventoryRef(uid);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(invRef);
    if (!snap.exists()) return;
    const data = snap.data() as InventoryDoc;
    tx.update(invRef, {
      parts: data.parts.filter((p) => p.id !== partId),
      lastUpdated: new Date().toISOString(),
    });
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
  const userInvRef = userInventoryRef(uid);

  await runTransaction(db, async (tx) => {
    const userSnap = await tx.get(userInvRef);
    const userData = userSnap.exists()
      ? (userSnap.data() as InventoryDoc)
      : { parts: [], nextId: 1, lastUpdated: "" };

    let nextId = userData.nextId;
    const updatedParts = [...userData.parts];

    for (const pick of partsToPick) {
      const existing = updatedParts.find((p) => p.id === pick.id);
      if (existing) {
        existing.quantity = (existing.quantity ?? 0) + pick.quantity;
      } else {
        updatedParts.push({
          id: nextId,
          name: pick.name,
          quantity: pick.quantity,
          lowThreshold: 0,
          dateAdded: new Date().toISOString(),
        });
        nextId += 1;
      }
    }

    tx.set(
      userInvRef,
      { parts: updatedParts, nextId, lastUpdated: new Date().toISOString() },
      { merge: true },
    );
  });
}

/* ─── Clients (always company-scoped) ─── */

export async function listClients(companyId: string): Promise<ClientRecord[]> {
  const snap = await getDocs(companyClientsCollection(companyId));
  const clients = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<ClientRecord, "id">) }));
  // Sort by numeric document ID — matches phone app behaviour where doc ID = String(cid)
  clients.sort((a, b) => parseInt(a.id) - parseInt(b.id));
  return clients;
}

export async function updateClient(companyId: string, clientId: string, payload: Partial<ClientRecord>) {
  await updateDoc(doc(db, "companies", companyId, "clients", clientId), {
    ...payload,
    updatedAt: new Date().toISOString(),
  });
}

/* ─── Certifications ─── */

export async function listCertifications(companyId: string): Promise<CertificationRecord[]> {
  const snap = await getDocs(query(companyCertificationsCollection(companyId), orderBy("createdAt", "desc")));
  return snap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() as Omit<CertificationRecord, "id">),
  }));
}
