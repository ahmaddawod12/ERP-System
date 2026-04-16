/**
 * @module types
 * Central TypeScript type definitions for the Smart-Job ERP mobile app.
 *
 * Rules:
 * - Shared enums/constants come from @smart-job/contracts — do NOT duplicate.
 * - Domain entity shapes live here alongside utility types.
 * - Keep this file the single import target for cross-cutting types.
 */

import type {
  RoleTitle,
  JobStatusValue,
  DocTypeCode,
  TierValue,
  SubStatusValue,
} from '@smart-job/contracts';

// Re-export contract types so consumers can import from one place
export type { RoleTitle, JobStatusValue, DocTypeCode, TierValue, SubStatusValue };

// ── Language ───────────────────────────────────────────────────────────────
export type Language = 'en' | 'he' | 'ar';

// ── Firestore helpers ──────────────────────────────────────────────────────
/** A Firestore Timestamp-like object (from @react-native-firebase). */
export interface FirestoreTimestamp {
  seconds: number;
  nanoseconds: number;
  toDate(): Date;
  toMillis(): number;
}

/** Fields that may arrive as either a Firestore Timestamp or an ISO string. */
export type DateLike = FirestoreTimestamp | string | Date;

/** Nullable shorthand for optional backend fields. */
export type Maybe<T> = T | null | undefined;

export interface JobFileRef {
  storagePath?: string;
  uri?: string;
}

// ── User / Profile ─────────────────────────────────────────────────────────
export interface UserProfile {
  uid: string;
  email: string;
  role: RoleTitle;
  companyId: string;
  displayName?: string;
  /** Preferred display name (used by some modules) */
  name?: string;
  he_name?: string;
  en_name?: string;
  phone?: string;
  pushToken?: string;
  photoURL?: string;
  /** Worker sequential ID (only present for worker role). */
  wid?: string | number;
  /** Manager sequential ID (only present for manager role). */
  mid?: string | number;
  createdAt?: DateLike;
  updatedAt?: DateLike;
}

// ── Subscription ───────────────────────────────────────────────────────────
export interface Subscription {
  status: SubStatusValue;
  tier: TierValue;
  expiresAt?: DateLike;
  enabledModules: Record<string, boolean>;
  createdAt?: DateLike;
  updatedAt?: DateLike;
}

// ── Client ─────────────────────────────────────────────────────────────────
export interface Client {
  id: string;
  cname: string;
  cphone?: string;
  /** @deprecated Legacy alias — read cname instead */
  name?: string;
  /** @deprecated Legacy alias — read cphone instead */
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  vatNumber?: string;
  notes?: string;
  cid?: number;
  createdAt?: DateLike;
  updatedAt?: DateLike;
}

// ── Job ────────────────────────────────────────────────────────────────────
export interface Job {
  id: string;
  status: JobStatusValue;
  title?: string;
  description?: string;
  /** Worker id */
  wid?: string | number;
  /** Worker name */
  wname?: string;
  /** Manager id */
  mid?: string | number;
  /** Manager name */
  mname?: string;
  /** Client id */
  cid?: string;
  /** Client name */
  cname?: string;
  /** Client phone */
  cphone?: string;
  address?: string;
  location?: string;
  date?: DateLike;
  timeFrom?: string;
  timeTo?: string;
  notes?: string;
  photos?: Array<string | JobFileRef>;
  signature?: string | JobFileRef;
  items?: JobItem[];
  createdAt?: DateLike;
  updatedAt?: DateLike;
  finishedAt?: DateLike;
  /** @deprecated use wid */ workerId?: string;
  /** @deprecated use wname */ workerName?: string;
  /** @deprecated use wname */ MName?: string;
  /** Solo-job extra fields */
  signingPerson?: string;
  customer?: string;
}

export interface JobItem {
  partId?: string | number;
  name: string;
  quantity: number;
  unit?: string;
}

// ── Inventory ──────────────────────────────────────────────────────────────
export interface InventoryPart {
  id: number;
  name: string;
  he_name?: string;
  en_name?: string;
  quantity: number;
  unit?: string;
  minStock?: number;
  price?: number;
}

export interface InventoryData {
  parts: InventoryPart[];
  nextId: number;
}

// ── Document (invoices, proposals, etc.) ───────────────────────────────────
export interface AppDocument {
  id: string;
  type: DocTypeCode;
  status?: string;
  /** Client id */
  cid?: string;
  /** Client name */
  cname?: string;
  totalAmount?: number;
  vatAmount?: number;
  netAmount?: number;
  items?: DocumentItem[];
  createdAt?: DateLike;
  updatedAt?: DateLike;
}

export interface DocumentItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

// ── Worker ─────────────────────────────────────────────────────────────────
export interface Worker {
  wid: string | number;
  uid?: string;
  name: string;
  /** @deprecated use name */ he_name?: string;
  phone?: string;
  /** @deprecated use phone */ phoneNumber?: string;
  email?: string;
  status?: string;
  createdAt?: DateLike;
}

// ── Cache versions ─────────────────────────────────────────────────────────
export interface CacheVersions {
  jobsVersion?: number;
  documentsVersion?: number;
  clientsVersion?: number;
  workersVersion?: number;
  updatedAt?: DateLike;
}

// ── Cloud Function payloads ────────────────────────────────────────────────
export interface CloudFunctionResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { message: string; code?: string };
}

export interface HttpFunctionOptions {
  requireAuth?: boolean;
}

// ── Alert system ───────────────────────────────────────────────────────────
export type AlertType = 'success' | 'error' | 'failed' | 'waiting' | 'info' | 'confirm';

export interface AlertButton {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

export interface AlertConfig {
  visible: boolean;
  type: AlertType;
  title: string;
  message: string;
  buttons: AlertButton[];
  icon: string | null;
}

export interface LoadingConfig {
  visible: boolean;
  title: string;
  message: string;
}

export interface AlertContextValue {
  show: (config: Partial<AlertConfig> & { type?: AlertType; title?: string; message?: string; buttons?: AlertButton[] }) => void;
  success: (title: string, message?: string, buttons?: AlertButton[]) => void;
  error: (title: string, message?: string, buttons?: AlertButton[]) => void;
  failed: (title: string, message?: string, buttons?: AlertButton[]) => void;
  waiting: (title: string, message?: string, buttons?: AlertButton[]) => void;
  info: (title: string, message?: string, buttons?: AlertButton[]) => void;
  confirm: (title: string, message?: string, buttons?: AlertButton[]) => void;
  warning: (title: string, message?: string, buttons?: AlertButton[]) => void;
  loading: (title?: string, message?: string) => void;
  hideLoading: () => void;
}

// ── Theme ──────────────────────────────────────────────────────────────────
export interface ThemeContextValue {
  isDarkMode: boolean;
  setTheme: (isDark: boolean) => void;
  toggleTheme: () => void;
  isLoading: boolean;
}

// ── Language context ───────────────────────────────────────────────────────
export interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  isLoading: boolean;
}

// ── Header context ─────────────────────────────────────────────────────────
export interface HeaderContextValue {
  headerAnimatedValue: import('react-native').Animated.Value;
  handleScroll: (currentScrollY: number) => void;
  resetHeader: () => void;
  showHeader: () => void;
  hideHeader: () => void;
}

// ── Cache context ──────────────────────────────────────────────────────────
export interface CacheContextValue {
  // State
  isInitialized: boolean;
  isLoading: boolean;
  profile: Maybe<UserProfile>;
  inventory: InventoryPart[];
  jobs: Job[];
  workers: Record<string, Worker>;
  companyJobs: Job[];
  documents: AppDocument[];
  clients: Client[];
  subscription: Maybe<Subscription>;
  companyInventory: InventoryPart[];

  // Getters
  getUid: () => Maybe<string>;
  getUserRole: () => string | null;
  getCompanyId: () => Maybe<string>;

  // Initialization
  initializeCache: (uid: string) => Promise<any>;
  clearCache: () => void;

  // Profile & Inventory
  updateProfile: (data: any) => Promise<void>;
  updateInventory: (data: any) => Promise<void>;

  // Jobs
  addJob: (data: any) => void;
  updateJob: (jobId: string, data: any) => void;
  removeJob: (jobId: string) => void;
  acceptJob: (jobId: string, updates?: any) => void;

  // Workers
  updateWorkers: (data: any) => Promise<void>;
  addWorker: (wid: string, data: any) => Promise<any>;
  editWorker: (wid: string, data: any) => Promise<void>;
  deleteWorker: (wid: string) => Promise<void>;

  // Documents
  addDocument: (data: any) => Promise<any>;

  // Clients
  fetchClients: (companyId?: string) => Promise<any>;
  addClient: (data: any) => Promise<any>;
  updateClient: (clientId: string, data: any) => Promise<void>;
  deleteClient: (clientId: string) => Promise<void>;

  // Data queries
  getDataForMonth: (monthDate: Date, dataType: string) => Promise<any[]>;
  getDataForDateRange: (startDate: Date, endDate: Date, dataType: string) => Promise<any[]>;
  fetchFromArchive: (companyId: string, year: number, month: number, dataType: string) => Promise<any[]>;
  isWithinCacheRange: (date: DateLike) => boolean;
  getCacheStartDate: () => Date;

  // Utilities
  refreshCache: (field: string) => Promise<void>;
  preIncrementVersion: (field: string, isCompanyCache?: boolean) => void;
  storage: any;
}

// ── withGate HOC ───────────────────────────────────────────────────────────
export type ModuleName =
  | 'team'
  | 'solojob'
  | 'teaminventory'
  | 'companyinventory'
  | 'inventory'
  | 'documents'
  | 'clients'
  | 'support';

export interface GateOptions {
  module?: ModuleName | ModuleName[];
  roles?: RoleTitle[];
  roleModules?: Partial<Record<RoleTitle, ModuleName[]>>;
}

// ── Route params ───────────────────────────────────────────────────────────
/** All route param shapes for type-safe navigation. Values are always string. */
export interface RouteParams {
  /** JSON-serialized job */
  job?: string;
  /** JSON-serialized document */
  document?: string;
  /** Job ID */
  jobId?: string;
  /** Document ID */
  docId?: string;
  /** Client ID */
  clientId?: string;
  /** Worker ID */
  wid?: string;
  /** Document type code */
  docType?: string;
  /** Prefilled client as JSON */
  client?: string;
  /** Return screen name */
  returnTo?: string;
}

// ── Async loading state ────────────────────────────────────────────────────
export interface AsyncState<T> {
  data: Maybe<T>;
  loading: boolean;
  error: Maybe<Error>;
}

// ── MMKV helpers ───────────────────────────────────────────────────────────
export interface MmkvHelpers {
  getString: (key: string) => string | null;
  setString: (key: string, value: string) => boolean;
  getObject: <T = unknown>(key: string) => T | null;
  setObject: (key: string, value: unknown) => boolean;
  delete: (key: string) => boolean;
  clearAll: () => boolean;
}

// ── Cache identity ─────────────────────────────────────────────────────────
export interface CachedSessionIdentity {
  uid: string | null;
  role: string | null;
  companyId: string | null;
  canReadScopedCache: boolean;
  identityMismatch: boolean;
}
