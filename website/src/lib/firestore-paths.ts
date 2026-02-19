import { collection, doc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";

export const userProfileRef = (uid: string) => doc(db, "users", uid, "data", "profile");
export const companyBusinessInfoRef = (companyId: string) =>
  doc(db, "companies", companyId, "business_data", "business_info");
export const companySubscriptionRef = (companyId: string) =>
  doc(db, "companies", companyId, "business_data", "subscription");

export const companyWorkersCollection = (companyId: string) =>
  collection(db, "companies", companyId, "workers");

export const companyClientsCollection = (companyId: string) =>
  collection(db, "companies", companyId, "clients");

export const companyPendingJobsCollection = (companyId: string) =>
  collection(db, "companies", companyId, "PendingJobs");

export const companyFinishedJobsCollection = (companyId: string) =>
  collection(db, "companies", companyId, "finishedJobs");

export const companyInventoryCollection = (companyId: string) =>
  collection(db, "companies", companyId, "business_data", "inventory", "parts");

export const companyCertificationsCollection = (companyId: string) =>
  collection(db, "companies", companyId, "certifications");

export const companyInvitesCollection = (companyId: string) =>
  collection(db, "companies", companyId, "invites");

export const userPersonalInventoryCollection = (uid: string) =>
  collection(db, "users", uid, "personal_inventory");
