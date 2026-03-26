import {
  paths,
  resolveCompanyScope,
} from "@smart-job/contracts";

export { paths, resolveCompanyScope };

export const ROLES = ["manager", "worker", "user", "basic", "dev"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Website-specific tiers (marketing names).
 * Maps to contracts Tier: Basic→Basic, Solo→User, Team→Team, Enterprise→Dev.
 * These are display labels for the website pricing page; the contracts Tier
 * enum holds the canonical runtime values stored in Firestore.
 */
export const TIERS = ["Basic", "Solo", "Team", "Enterprise"] as const;
export type Tier = (typeof TIERS)[number];

export type SubscriptionStatus = "active" | "inactive" | "pending" | "trial";
export type AccountType = "solo" | "business";

export interface UserProfile {
  uid: string;
  email: string;
  role: Role;
  companyId: string | null;
  wid?: string | number;
  mid?: string | number;
  name: string;
  phoneNumber: string;
  accountType: AccountType;
  createdAt: string;
  updatedAt?: string;
  pushToken?: string;
  pushTokenUpdatedAt?: string;
  pushTokenPlatform?: string;
  pushTokenType?: string;
}

/** Matches phone app subscription at companies/{id}/data/subscription */
export interface UserSubscription {
  tier: Tier;
  status: SubscriptionStatus;
  expiresAt?: string;
  enabledModules: EnabledModules;
  updatedAt: string;
}

export interface EnabledModules {
  team: boolean;
  solojob: boolean;
  documents: boolean;
  teaminventory: boolean;
  companyinventory: boolean;
  inventory: boolean;
}

/** Matches phone app business_info at companies/{id}/data/business_info */
export interface BusinessInfo {
  he_name: string;
  en_name: string;
  city: string;
  address: string;
  vat_number: string;
  business_type: string;
  document_numbers: Record<string, number>;
  business_email?: string;
  business_phone?: string;
  business_fax?: string;
  accountant_name?: string;
  accountant_email?: string;
  accountant_phone?: string;
  registered_at?: string;
  registered_by?: string;
  registered_by_role?: string;
  last_updated?: string;
}

export interface WorkerProfile {
  wid: string | number;
  uid?: string;
  email: string;
  role: Role;
  name: string;
  phoneNumber: string;
  /** @deprecated Use wid instead */
  workerId?: string;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Matches phone app job structure.
 * All jobs live in a single 'jobs' collection; status determines lifecycle phase.
 */
export interface JobRecord {
  id: string;
  title: string;
  description: string;
  location?: string;
  cname: string;
  cphone?: string;
  clientId?: string;
  /**
   * Canonical statuses: pending → waiting → finished | denied
   */
  status: "pending" | "waiting" | "denied" | "finished";
  wid: string | null;
  name?: string;
  wname?: string | null;
  mname?: string | null;
  mid?: string | null;
  createdAt: string;
  updatedAt?: string;
  /** Worker-submitted fields */
  timeFrom?: string;
  timeTo?: string;
  signingPerson?: string;
  photos?: string[];
  signature?: string;
  partsUsed?: Array<{ id: number; name: string; quantity: number }>;
  travelDistance?: number | null;
  finishedAt?: string;
  deniedAt?: string;
  deniedBy?: string;
  approvedBy?: string;
  isCert?: boolean;
}

/**
 * Single inventory part — stored inside the `parts` array of the
 * inventory document (NOT as a separate Firestore document).
 * Matches phone app pattern:
 *   Company parts: { id, name, active, dateAdded }
 *   User parts:    { id, name, quantity, lowThreshold, dateAdded }
 */
export interface InventoryPart {
  id: number;
  name: string;
  active?: boolean;
  quantity?: number;
  lowThreshold?: number;
  dateAdded: string;
}

/**
 * The inventory document stored at:
 *   companies/{companyId}/data/inventory  (company inventory)
 *   users/{uid}/data/inventory                     (personal inventory)
 */
export interface InventoryDoc {
  parts: InventoryPart[];
  nextId: number;
  lastUpdated: string;
}

export interface ClientRecord {
  id: string;
  /** Stored for website ordering when available. */
  numericId?: number;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  city?: string;
  vatNumber?: string;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Matches phone app document at companies/{id}/documents/{documentId}.
 * Document type codes: 10 (Price Proposal), 200 (Delivery Note),
 * 210 (Return Certificate), 305 (Tax Invoice), 330 (Refund), 400 (Receipt).
 */
export interface DocumentRecord {
  id: string;
  type: string | number;
  documentType?: number;
  documentNumber?: string | number;
  documentId?: string;
  cname?: string;
  clientId?: string;
  cphone?: string;
  clientCity?: string;
  clientVatNumber?: string;
  createdAt: string;
  downloadURL?: string;
  url?: { origin?: string; he?: string; en?: string };
  notes?: string;
  confirmationNumber?: string;
  items?: Array<{
    description: string;
    price: number;
    quantity: number;
    partId?: number;
  }>;
  totalBeforeVat?: number;
  vatAmount?: number;
  totalWithVat?: number;
  documentData?: Record<string, unknown>;
  paymentMethod?: string;
  paymentInfo?: Record<string, unknown> | string;
  createdByUid?: string;
  language?: string;
  date?: string;
  jobId?: string;
  jobsData?: Array<{ jobId: string }>;
  priceProposalId?: string;
  status?: "queued" | "generated" | "failed" | "completed";
  isCert?: boolean;
}
