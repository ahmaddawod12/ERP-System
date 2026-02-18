export const ROLES = ["Manager", "Worker", "User", "Basic", "Dev"] as const;
export type Role = (typeof ROLES)[number];

export const TIERS = ["Basic", "Solo", "Team", "Enterprise"] as const;
export type Tier = (typeof TIERS)[number];

export type SubscriptionStatus = "active" | "inactive" | "pending";
export type AccountType = "solo" | "business";

export interface UserProfile {
  uid: string;
  email: string;
  role: Role;
  companyId: string | null;
  name: string;
  phoneNumber: string;
  accountType: AccountType;
  createdAt: string;
}

export interface UserSubscription {
  tier: Tier;
  status: SubscriptionStatus;
  updatedAt: string;
}

export interface BusinessInfo {
  name: string;
  number: string;
  address: string;
  phone: string;
}

export interface WorkerProfile {
  workerId: string;
  email: string;
  role: Role;
  name: string;
  phoneNumber: string;
  createdAt: string;
}

export interface JobRecord {
  id: string;
  title: string;
  clientName: string;
  description: string;
  status: "pending" | "in_progress" | "completed";
  workerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  lowThreshold: number;
  updatedAt: string;
}

export interface ClientRecord {
  id: string;
  numericId: number;
  name: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CertificationRecord {
  id: string;
  type: string;
  jobId: string;
  status: "queued" | "generated" | "failed";
  createdAt: string;
  downloadUrl: string;
}
