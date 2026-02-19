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
import { db } from "@/lib/firebase/client";
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
import { defaultTierForRole } from "@/lib/access";
import { generateCompanySlug } from "@/lib/utils";
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

function generatePendingJobId(): string {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let id = "p_";
  for (let i = 0; i < 5; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function convertToFinishedJobId(id: string): string {
  return id.startsWith("p_") ? `f_${id.slice(2)}` : id;
}

/**
 * For solo users (no companyId), use uid as companyId.
 * This matches the phone app behaviour where solo users
 * store data under companies/{uid}/*.
 */
export function resolveCompanyScope(companyId: string | null, uid: string): string {
  return companyId ?? uid;
}

/* ─── Profile ─── */

export async function writeUserProfile(uid: string, profile: Omit<UserProfile, "uid" | "createdAt">) {
  const ref = doc(db, "users", uid, "data", "profile");
  await setDoc(
    ref,
    {
      uid,
      ...profile,
      createdAt: new Date().toISOString(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/* ─── Subscription ─── */

export async function writeCompanySubscription(
  companyId: string,
  payload: { role: Role; accountType: AccountType; tier?: "Basic" | "Solo" | "Team" | "Enterprise" },
) {
  const tier = payload.tier ?? defaultTierForRole(payload.role, payload.accountType);
  const ref = doc(db, "companies", companyId, "business_data", "subscription");
  await setDoc(
    ref,
    {
      tier,
      status: "active",
      enabledModules: defaultEnabledModules(tier),
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

function defaultEnabledModules(tier: string) {
  return {
    team: tier === "Team" || tier === "Enterprise",
    solojob: tier !== "Basic",
    documents: true,
    teaminventory: tier === "Team" || tier === "Enterprise",
    companyinventory: tier === "Team" || tier === "Enterprise",
    inventory: tier !== "Basic",
  };
}

/* ─── Company creation ─── */

export async function createCompanyForManager(params: {
  uid: string;
  email: string;
  name: string;
  phoneNumber: string;
  businessInfo: BusinessInfo;
}) {
  const companyId = generateCompanySlug(params.businessInfo.en_name || params.businessInfo.he_name);
  const companyRef = doc(db, "companies", companyId);

  await setDoc(companyRef, {
    companyId,
    createdBy: params.uid,
    createdAt: new Date().toISOString(),
  });

  await setDoc(doc(db, "companies", companyId, "workers", params.uid), {
    workerId: params.uid,
    uid: params.uid,
    role: "Manager",
    email: params.email,
    name: params.name,
    phoneNumber: params.phoneNumber,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await setDoc(
    companyBusinessInfoRef(companyId),
    {
      ...params.businessInfo,
      last_updated: new Date().toISOString(),
    },
    { merge: true },
  );

  await setDoc(doc(db, "companies", companyId, "counters", "clients"), { lastNumber: 0 }, { merge: true });

  // Initialise empty inventory document (single doc with parts array)
  await setDoc(companyInventoryRef(companyId), {
    parts: [],
    nextId: 1,
    lastUpdated: new Date().toISOString(),
  });

  return companyId;
}

/* ─── Workers ─── */

export async function listWorkers(companyId: string): Promise<WorkerProfile[]> {
  const snap = await getDocs(query(companyWorkersCollection(companyId), orderBy("createdAt", "desc")));
  return snap.docs.map((docSnap) => docSnap.data() as WorkerProfile);
}

export async function updateWorkerRole(companyId: string, workerId: string, role: Role) {
  await updateDoc(doc(db, "companies", companyId, "workers", workerId), {
    role,
    updatedAt: new Date().toISOString(),
  });
}

/* ─── Jobs (company-scoped — used for both team and solo) ─── */

export async function listJobs(companyId: string, opts?: { role?: Role; uid?: string }) {
  let constraints: QueryConstraint[] = [orderBy("createdAt", "desc")];
  if (opts?.role === "Worker" && opts.uid) {
    constraints = [where("workerId", "==", opts.uid), orderBy("createdAt", "desc")];
  }
  const pendingSnap = await getDocs(query(companyPendingJobsCollection(companyId), ...constraints));
  const finishedConstraints =
    opts?.role === "Worker" && opts.uid
      ? [where("workerId", "==", opts.uid), orderBy("createdAt", "desc")]
      : [orderBy("createdAt", "desc")];
  const finishedSnap = await getDocs(query(companyFinishedJobsCollection(companyId), ...finishedConstraints));

  return {
    pending: pendingSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<JobRecord, "id">) })),
    finished: finishedSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<JobRecord, "id">) })),
  };
}

export async function createJob(
  companyId: string,
  payload: Omit<JobRecord, "id" | "createdAt" | "updatedAt">,
) {
  const jobId = generatePendingJobId();
  await setDoc(doc(db, "companies", companyId, "PendingJobs", jobId), {
    id: jobId,
    ...payload,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return jobId;
}

/** Solo users create finished jobs directly (matches phone app FillJob flow). */
export async function createFinishedJob(
  companyId: string,
  payload: Omit<JobRecord, "id" | "createdAt" | "updatedAt" | "status">,
) {
  const tempId = generatePendingJobId();
  const jobId = convertToFinishedJobId(tempId);
  await setDoc(doc(db, "companies", companyId, "finishedJobs", jobId), {
    id: jobId,
    ...payload,
    status: "finished",
    isCert: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return jobId;
}

export async function updateJob(companyId: string, jobId: string, payload: Partial<JobRecord>) {
  const pendingRef = doc(db, "companies", companyId, "PendingJobs", jobId);
  const pendingSnap = await getDoc(pendingRef);
  if (!pendingSnap.exists()) return;

  const merged = { ...pendingSnap.data(), ...payload, updatedAt: new Date().toISOString() };
  await updateDoc(pendingRef, merged);

  // When marking as finished, move to finishedJobs (matches phone app flow)
  if (payload.status === "finished") {
    const finishedId = convertToFinishedJobId(jobId);
    await setDoc(doc(db, "companies", companyId, "finishedJobs", finishedId), {
      ...merged,
      id: finishedId,
      status: "finished",
    });
    await deleteDoc(pendingRef);
  }
}

export async function deleteJob(companyId: string, jobId: string) {
  const pendingRef = doc(db, "companies", companyId, "PendingJobs", jobId);
  const pendingSnap = await getDoc(pendingRef);
  if (pendingSnap.exists()) {
    await deleteDoc(pendingRef);
    return;
  }
  const finishedRef = doc(db, "companies", companyId, "finishedJobs", jobId);
  await deleteDoc(finishedRef);
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
  const snap = await getDocs(query(companyClientsCollection(companyId), orderBy("numericId", "asc")));
  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<ClientRecord, "id">) }));
}

export async function updateClient(companyId: string, clientId: string, payload: Partial<ClientRecord>) {
  await updateDoc(doc(db, "companies", companyId, "clients", clientId), {
    ...payload,
    updatedAt: new Date().toISOString(),
  });
}

export async function deleteClient(companyId: string, clientId: string) {
  await deleteDoc(doc(db, "companies", companyId, "clients", clientId));
}

/* ─── Certifications ─── */

export async function listCertifications(companyId: string): Promise<CertificationRecord[]> {
  const snap = await getDocs(query(companyCertificationsCollection(companyId), orderBy("createdAt", "desc")));
  return snap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() as Omit<CertificationRecord, "id">),
  }));
}
