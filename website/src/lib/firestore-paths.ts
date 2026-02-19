import { collection, doc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";

/* ── User-scoped refs ── */

export const userProfileRef = (uid: string) => doc(db, "users", uid, "data", "profile");

/** Single-document personal inventory (parts array inside). Matches phone app. */
export const userInventoryRef = (uid: string) => doc(db, "users", uid, "data", "inventory");

export const userCacheRef = (uid: string) => doc(db, "users", uid, "data", "cache");

/* ── Company-scoped refs ── */

export const companyBusinessInfoRef = (companyId: string) =>
  doc(db, "companies", companyId, "business_data", "business_info");

export const companySubscriptionRef = (companyId: string) =>
  doc(db, "companies", companyId, "business_data", "subscription");

/** Single-document company inventory (parts array inside). Matches phone app. */
export const companyInventoryRef = (companyId: string) =>
  doc(db, "companies", companyId, "business_data", "inventory");

export const companyCacheRef = (companyId: string) =>
  doc(db, "companies", companyId, "business_data", "cache");

export const companyWorkersCollection = (companyId: string) =>
  collection(db, "companies", companyId, "workers");

export const companyClientsCollection = (companyId: string) =>
  collection(db, "companies", companyId, "clients");

export const companyPendingJobsCollection = (companyId: string) =>
  collection(db, "companies", companyId, "PendingJobs");

export const companyFinishedJobsCollection = (companyId: string) =>
  collection(db, "companies", companyId, "finishedJobs");

export const companyCertificationsCollection = (companyId: string) =>
  collection(db, "companies", companyId, "certifications");

export const companyInvitesCollection = (companyId: string) =>
  collection(db, "companies", companyId, "invites");
