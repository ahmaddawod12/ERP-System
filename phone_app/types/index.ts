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
import type {
  ClientDeleteResult,
  DocumentPaymentDetails,
  DocumentPaymentMethod,
} from '@smart-job/api-contracts';

// Re-export contract types so consumers can import from one place
export type { RoleTitle, JobStatusValue, DocTypeCode, TierValue, SubStatusValue };

// ── Language ───────────────────────────────────────────────────────────────
export type Language = 'en' | 'he' | 'ar';
export type ThemePreference = 'system' | 'light' | 'dark';
export type HistoricalSource = 'cache' | 'live' | 'archive' | 'mixed';

export interface HistoricalQueryResult<T> {
  items: readonly T[];
  complete: boolean;
  nextCursor: string | null;
  source: HistoricalSource;
}

// ── Firestore helpers ──────────────────────────────────────────────────────
/** Timestamp adapter retained only while legacy cached records remain readable. */
export interface LegacyStoredTimestamp {
  seconds: number;
  nanoseconds: number;
  toDate(): Date;
  toMillis(): number;
}

/** New API values are ISO strings; the object form is legacy cache compatibility. */
export type DateLike = LegacyStoredTimestamp | string | Date;

/** Nullable shorthand for optional backend fields. */
export type Maybe<T> = T | null | undefined;

export interface JobFileRef {
  attachmentId?: string;
  kind?: 'photo' | 'signature';
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
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
  /** Opaque optimistic-concurrency token returned by the API. */
  entityVersion?: string;
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
  /** Public sequential job number. */
  jobNo?: number;
  /** Opaque optimistic-concurrency token returned by the API. */
  entityVersion?: string;
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
  acceptedAt?: DateLike;
  acceptedBy?: string;
  deniedAt?: DateLike;
  pendingSync?: boolean;
  /** Solo-job extra fields */
  signingPerson?: string;
  customer?: string;
  /** Certified / tax-document flag (read-model extension) */
  isCert?: boolean;
  /** Display name of signing person */
  signingPersonName?: string;
  /** Travel distance in km */
  travelDistance?: number | null;
  /** Parts consumed for this job */
  partsUsed?: Array<{ id?: string | number; name?: string; quantity?: number | string }>;
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
  active?: boolean;
  lowThreshold?: number;
  dateAdded?: string;
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
  /** Client phone */
  cphone?: string;
  totalAmount?: number;
  vatAmount?: number;
  netAmount?: number;
  items?: DocumentItem[];
  createdAt?: DateLike;
  updatedAt?: DateLike;
  /** Display / PDF metadata */
  documentId?: string;
  documentNumber?: string | number;
  storagePath?: string;
  taxAuthorityConfirmationNumber?: string;
  paymentMethod?: DocumentPaymentMethod;
  paymentDetails?: DocumentPaymentDetails;
  /** @deprecated Read-only compatibility for documents written before structured payment metadata. */
  paymentInfo?: string;
  invoiceReference?: string;
  totalBeforeVat?: number;
  totalWithVat?: number;
  clientVatNumber?: string;
  createdByName?: string;
  createdByUid?: string;
  notes?: string;
  income?: DocumentItem[];
  /** Used-by receipt flag for price proposals */
  isUsed?: boolean;
  /** Client id for proposals/invoices */
  clientId?: string;
  documentData?: {
    items?: DocumentItem[];
    client?: {
      name?: string;
      phone?: string;
      email?: string;
      address?: string;
      clientVatNumber?: string;
    };
    totalBeforeVat?: number;
    vatAmount?: number;
    totalWithVat?: number;
    paymentMethod?: DocumentPaymentMethod;
    paymentDetails?: DocumentPaymentDetails;
    /** @deprecated Read-only compatibility for legacy stored documents. */
    paymentInfo?: string;
    invoiceReference?: string;
    notes?: string;
  };
}

export interface DocumentItem {
  id?: string | number;
  partId?: string | number | null;
  description?: string;
  quantity?: number | string;
  unitPrice?: number;
  total?: number;
  price?: number | string;
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
  companyInventoryVersion?: number;
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
  signal?: AbortSignal;
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
  themePreference: ThemePreference;
  setTheme: (isDark: boolean) => void;
  setThemePreference: (preference: ThemePreference) => void;
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
export interface CacheLifecycleValue {
  isInitialized: boolean;
  isLoading: boolean;
  profile: Maybe<UserProfile>;
  subscription: Maybe<Subscription>;
  getUid: () => Maybe<string>;
  getUserRole: () => string | null;
  getCompanyId: () => Maybe<string>;
  initializeCache: (
    uid: string,
    companyId: string,
    role: string,
  ) => Promise<{
    uid: string;
    role: string;
    companyId: string;
    hasBusinessInfo: boolean;
  } | null>;
  clearCache: () => void;
  refreshCache: (field: string) => Promise<void>;
}

export interface JobsCacheValue {
  jobs: Job[];
  companyJobs: Job[];
  addJob: (data: Job) => void;
  updateJob: (jobId: string, data: Partial<Job>) => void;
  removeJob: (jobId: string) => void;
  acceptJob: (jobId: string, updates?: Partial<Job>) => void;
}

export interface DirectoryCacheValue {
  workers: Record<string, Worker>;
  clients: Client[];
  updateWorkers: (
    data: Record<string, Worker> | Worker[],
  ) => Promise<void>;
  addWorker: (wid: string, data: Worker) => Promise<void>;
  editWorker: (wid: string, data: Partial<Worker>) => Promise<void>;
  deleteWorker: (wid: string) => Promise<void>;
  fetchClients: (companyId?: string) => Promise<Client[]>;
  addClient: (data: unknown) => Promise<Client>;
  updateClient: (clientId: string, data: unknown) => Promise<Client>;
  deleteClient: (clientId: string, entityVersion?: string) => Promise<ClientDeleteResult>;
}

export interface InventoryCacheValue {
  inventory: InventoryPart[];
  companyInventory: InventoryPart[];
}

export interface DocumentHistoryCacheValue {
  documents: AppDocument[];
  addDocument: (data: AppDocument) => Promise<void>;
  getDataForMonth: (
    monthDate: Date,
    dataType: 'finishedJobs' | 'documents',
  ) => Promise<HistoricalQueryResult<Job | AppDocument>>;
  getDataForDateRange: (
    startDate: Date,
    endDate: Date,
    dataType: 'finishedJobs' | 'documents' | 'pendingJobs',
  ) => Promise<HistoricalQueryResult<Job | AppDocument>>;
  fetchFromArchive: (
    companyId: string,
    year: number,
    month: number,
    dataType: 'finishedJobs' | 'documents',
    signal?: AbortSignal,
  ) => Promise<HistoricalQueryResult<Job | AppDocument>>;
  isWithinCacheRange: (date: DateLike) => boolean;
  getCacheStartDate: () => Date;
}

export type CacheContextValue =
  & CacheLifecycleValue
  & JobsCacheValue
  & DirectoryCacheValue
  & InventoryCacheValue
  & DocumentHistoryCacheValue;

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
