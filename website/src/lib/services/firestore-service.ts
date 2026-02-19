"use client";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
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
  companyInventoryCollection,
  companyPendingJobsCollection,
  companyWorkersCollection,
  userPersonalInventoryCollection,
} from "@/lib/firestore-paths";
import { defaultTierForRole } from "@/lib/access";
import { generateCompanySlug } from "@/lib/utils";
import type {
  AccountType,
  BusinessInfo,
  ClientRecord,
  InventoryItem,
  JobRecord,
  Role,
  UserProfile,
  WorkerProfile,
} from "@/lib/types";

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

export async function writeCompanySubscription(
  companyId: string,
  payload: { role: Role; accountType: AccountType; tier?: "Basic" | "Solo" | "Team" | "Enterprise" },
) {
  const ref = doc(db, "companies", companyId, "business_data", "subscription");
  await setDoc(
    ref,
    {
      tier: payload.tier ?? defaultTierForRole(payload.role, payload.accountType),
      status: "active",
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

export async function createCompanyForManager(params: {
  uid: string;
  email: string;
  name: string;
  phoneNumber: string;
  businessInfo: BusinessInfo;
}) {
  const companyId = generateCompanySlug(params.businessInfo.name);
  const companyRef = doc(db, "companies", companyId);

  await setDoc(companyRef, {
    companyId,
    createdBy: params.uid,
    createdAt: new Date().toISOString(),
  });

  await setDoc(doc(db, "companies", companyId, "workers", params.uid), {
    workerId: params.uid,
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
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  await setDoc(doc(db, "companies", companyId, "counters", "clients"), { lastNumber: 0 }, { merge: true });

  return companyId;
}

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

export async function listJobs(companyId: string, opts?: { role?: Role; uid?: string }) {
  let constraints: QueryConstraint[] = [orderBy("updatedAt", "desc")];
  if (opts?.role === "Worker" && opts.uid) {
    constraints = [where("workerId", "==", opts.uid), orderBy("updatedAt", "desc")];
  }
  const pendingSnap = await getDocs(query(companyPendingJobsCollection(companyId), ...constraints));
  const finishedConstraints =
    opts?.role === "Worker" && opts.uid
      ? [where("workerId", "==", opts.uid), orderBy("updatedAt", "desc")]
      : [orderBy("updatedAt", "desc")];
  const finishedSnap = await getDocs(query(companyFinishedJobsCollection(companyId), ...finishedConstraints));

  return {
    pending: pendingSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<JobRecord, "id">) })),
    finished: finishedSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<JobRecord, "id">) })),
  };
}

export async function createJob(companyId: string, payload: Omit<JobRecord, "id" | "createdAt" | "updatedAt">) {
  await addDoc(companyPendingJobsCollection(companyId), {
    ...payload,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

export async function updateJob(companyId: string, jobId: string, payload: Partial<JobRecord>) {
  const pendingRef = doc(db, "companies", companyId, "PendingJobs", jobId);
  const pendingSnap = await getDoc(pendingRef);
  if (!pendingSnap.exists()) return;

  const merged = { ...pendingSnap.data(), ...payload, updatedAt: new Date().toISOString() };
  await updateDoc(pendingRef, merged);

  if (payload.status === "completed") {
    await setDoc(doc(db, "companies", companyId, "finishedJobs", jobId), merged, { merge: true });
    await deleteDoc(pendingRef);
  }
}

export async function listCompanyInventory(companyId: string): Promise<InventoryItem[]> {
  const snap = await getDocs(query(companyInventoryCollection(companyId), orderBy("updatedAt", "desc")));
  return snap.docs.map((itemSnap) => ({ id: itemSnap.id, ...(itemSnap.data() as Omit<InventoryItem, "id">) }));
}

export async function addInventoryItem(companyId: string, payload: Omit<InventoryItem, "id" | "updatedAt">) {
  await addDoc(companyInventoryCollection(companyId), {
    ...payload,
    updatedAt: new Date().toISOString(),
  });
}

export async function updateInventoryItem(
  companyId: string,
  itemId: string,
  payload: Partial<Pick<InventoryItem, "name" | "sku" | "quantity" | "lowThreshold">>,
) {
  await updateDoc(doc(db, "companies", companyId, "business_data", "inventory", "parts", itemId), {
    ...payload,
    updatedAt: new Date().toISOString(),
  });
}

export async function deleteInventoryItem(companyId: string, itemId: string) {
  await deleteDoc(doc(db, "companies", companyId, "business_data", "inventory", "parts", itemId));
}

export async function addInventoryPick(companyId: string, uid: string, payload: { itemId: string; quantity: number }) {
  const partRef = doc(db, "companies", companyId, "business_data", "inventory", "parts", payload.itemId);
  const partSnap = await getDoc(partRef);
  if (!partSnap.exists()) return;
  const current = partSnap.data() as InventoryItem;
  const nextQty = Math.max((current.quantity ?? 0) - payload.quantity, 0);
  await updateDoc(partRef, { quantity: nextQty, updatedAt: new Date().toISOString() });
  await addDoc(collection(db, "companies", companyId, "inventory_picks"), {
    workerId: uid,
    itemId: payload.itemId,
    quantity: payload.quantity,
    createdAt: new Date().toISOString(),
  });
}

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

export async function listCertifications(companyId: string) {
  const snap = await getDocs(query(companyCertificationsCollection(companyId), orderBy("createdAt", "desc")));
  return snap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  })) as Array<{
    id: string;
    type: string;
    jobId: string;
    status: "queued" | "generated" | "failed";
    createdAt: string;
    downloadUrl: string;
  }>;
}

export async function listPersonalInventory(uid: string): Promise<InventoryItem[]> {
  const snap = await getDocs(query(userPersonalInventoryCollection(uid), orderBy("updatedAt", "desc")));
  return snap.docs.map((itemSnap) => ({ id: itemSnap.id, ...(itemSnap.data() as Omit<InventoryItem, "id">) }));
}

export async function addPersonalInventoryItem(uid: string, payload: Omit<InventoryItem, "id" | "updatedAt">) {
  await addDoc(userPersonalInventoryCollection(uid), { ...payload, updatedAt: new Date().toISOString() });
}

export async function updatePersonalInventoryItem(
  uid: string,
  itemId: string,
  payload: Partial<Pick<InventoryItem, "name" | "sku" | "quantity" | "lowThreshold">>,
) {
  await updateDoc(doc(db, "users", uid, "personal_inventory", itemId), {
    ...payload,
    updatedAt: new Date().toISOString(),
  });
}

export async function deletePersonalInventoryItem(uid: string, itemId: string) {
  await deleteDoc(doc(db, "users", uid, "personal_inventory", itemId));
}

export async function listUserJobs(uid: string): Promise<JobRecord[]> {
  const snap = await getDocs(query(collection(db, "users", uid, "jobs"), orderBy("updatedAt", "desc")));
  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<JobRecord, "id">) }));
}

export async function addUserJob(uid: string, payload: Omit<JobRecord, "id" | "createdAt" | "updatedAt">) {
  await addDoc(collection(db, "users", uid, "jobs"), {
    ...payload,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

export async function updateUserJob(uid: string, jobId: string, payload: Partial<JobRecord>) {
  await updateDoc(doc(db, "users", uid, "jobs", jobId), {
    ...payload,
    updatedAt: new Date().toISOString(),
  });
}

export async function deleteUserJob(uid: string, jobId: string) {
  await deleteDoc(doc(db, "users", uid, "jobs", jobId));
}
