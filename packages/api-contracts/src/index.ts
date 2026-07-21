import {
  AccountType,
  DocType,
  JobStatus,
  RegistrationMode,
  Role,
  SubStatus,
  TaxAuthorityStatus as CanonicalTaxAuthorityStatus,
  TaxSubmissionMode as CanonicalTaxSubmissionMode,
  TIER_VALUES,
  UPGRADEABLE_TIERS,
  type AccountTypeValue,
  type DocTypeCode,
  type JobStatusValue,
  type RegistrationModeValue,
  type RoleTitle,
  type TierValue,
} from "@smart-job/contracts";
import { z } from "zod";

function stringEnumSchema<T extends string>(values: readonly T[]) {
  if (values.length === 0) {
    throw new Error("A canonical enum must contain at least one value");
  }

  return z.enum(values as [T, ...T[]]);
}

/** Runtime schemas are derived from @smart-job/contracts, the canonical value source. */
export const RoleSchema: z.ZodType<RoleTitle> = stringEnumSchema(Object.values(Role));
export const AccountTypeSchema: z.ZodType<AccountTypeValue> = stringEnumSchema(Object.values(AccountType));
export const RegistrationModeSchema: z.ZodType<RegistrationModeValue> = stringEnumSchema(
  Object.values(RegistrationMode),
);
export const TierSchema: z.ZodType<TierValue> = stringEnumSchema(TIER_VALUES);
export const SubscriptionStatusSchema = stringEnumSchema(Object.values(SubStatus));
export const JobStatusSchema: z.ZodType<JobStatusValue> = stringEnumSchema(Object.values(JobStatus));
export const JobCreateStatusSchema = stringEnumSchema([
  JobStatus.Pending,
  JobStatus.Finished,
] as const);
export const JobUpdateStatusSchema = stringEnumSchema([
  JobStatus.Pending,
  JobStatus.Waiting,
  JobStatus.Denied,
] as const);
const docTypeLiterals = Object.values(DocType).map((value) => z.literal(value)) as [
  z.ZodLiteral<DocTypeCode>,
  z.ZodLiteral<DocTypeCode>,
  ...z.ZodLiteral<DocTypeCode>[],
];
export const DocTypeSchema: z.ZodType<DocTypeCode> = z.union(docTypeLiterals);

export const RequestIdSchema = z.string().trim().min(1).max(128);
export const CursorSchema = z.string().trim().min(1).max(2048).brand<"Cursor">();
export const EntityVersionSchema = z.string().trim().min(1).max(512).brand<"EntityVersion">();

export type Cursor = z.infer<typeof CursorSchema>;
export type EntityVersion = z.infer<typeof EntityVersionSchema>;

export const ApiErrorSchema = z.object({
  code: z.string().trim().min(1).max(128),
  message: z.string().min(1).max(2_000),
  retryable: z.boolean(),
  fieldErrors: z.record(z.string(), z.array(z.string().min(1))).optional(),
}).strict();

export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ApiSuccessMetaSchema = z.object({
  requestId: RequestIdSchema,
  nextCursor: CursorSchema.nullable().optional(),
}).strict();

export const ApiErrorMetaSchema = z.object({
  requestId: RequestIdSchema,
}).strict();

export type ApiResponse<T> =
  | {
      ok: true;
      data: T;
      meta: { requestId: string; nextCursor?: Cursor | null };
    }
  | {
      ok: false;
      error: ApiError;
      meta: { requestId: string };
    };

export function createApiSuccessResponseSchema<TSchema extends z.ZodType>(dataSchema: TSchema) {
  return z.object({
    ok: z.literal(true),
    data: dataSchema,
    meta: ApiSuccessMetaSchema,
  }).strict();
}

export const ApiFailureResponseSchema = z.object({
  ok: z.literal(false),
  error: ApiErrorSchema,
  meta: ApiErrorMetaSchema,
}).strict();

export function createApiResponseSchema<TSchema extends z.ZodType>(dataSchema: TSchema) {
  return z.discriminatedUnion("ok", [
    createApiSuccessResponseSchema(dataSchema),
    ApiFailureResponseSchema,
  ]);
}

export const WorkspaceSummarySchema = z.object({
  companyId: z.number().int().positive(),
  name: z.string().trim().min(1).max(200),
  accountType: AccountTypeSchema,
  role: RoleSchema,
  memberNo: z.number().int().positive().nullable(),
  enabledModules: z.array(z.string().trim().min(1).max(100)).max(100),
}).strict();

export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;

const OptionalRegistrationEmailSchema = z.union([
  z.literal(""),
  z.string().trim().toLowerCase().pipe(z.email().max(320)),
]).optional();

export const BusinessRegistrationProfileSchema = z.object({
  name: z.string().trim().max(200).optional(),
  englishName: z.string().trim().max(200).optional(),
  vatNumber: z.string().trim().max(32).optional(),
  businessType: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  address: z.string().trim().max(500).optional(),
  phone: z.string().trim().max(40).optional(),
  fax: z.string().trim().max(40).optional(),
  accountantName: z.string().trim().max(200).optional(),
  accountantEmail: OptionalRegistrationEmailSchema,
  accountantPhone: z.string().trim().max(40).optional(),
}).strict();

export const BusinessRegistrationRequestSchema = z.object({
  workspaceMode: RegistrationModeSchema,
  displayName: z.string().trim().min(2).max(200),
  phoneNumber: z.string().trim().min(6).max(40),
  businessProfile: BusinessRegistrationProfileSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.workspaceMode !== RegistrationMode.Business) return;

  const requiredFields = [
    ["name", value.businessProfile?.name],
    ["vatNumber", value.businessProfile?.vatNumber],
    ["businessType", value.businessProfile?.businessType],
    ["address", value.businessProfile?.address],
    ["phone", value.businessProfile?.phone],
  ] as const;
  for (const [field, fieldValue] of requiredFields) {
    if (!fieldValue?.trim()) {
      context.addIssue({
        code: "custom",
        message: `${field} is required for a business workspace`,
        path: ["businessProfile", field],
      });
    }
  }
});

export const BusinessRegistrationResultSchema = z.object({
  workspace: WorkspaceSummarySchema,
  tier: TierSchema,
}).strict();

export type BusinessRegistrationProfile = z.infer<typeof BusinessRegistrationProfileSchema>;
export type BusinessRegistrationRequest = z.infer<typeof BusinessRegistrationRequestSchema>;
export type BusinessRegistrationResult = z.infer<typeof BusinessRegistrationResultSchema>;

export const InvitationTargetRoleSchema = stringEnumSchema([
  Role.manager,
  Role.worker,
  Role.user,
  Role.basic,
] as const);

export const InvitationCreateRequestSchema = z.object({
  targetRole: InvitationTargetRoleSchema,
  targetEmail: z.string().trim().toLowerCase().pipe(z.email().max(320)).optional(),
  expiresInDays: z.number().int().min(1).max(365).default(30),
}).strict();

export const InvitationCreateResultSchema = z.object({
  inviteId: z.uuid(),
  inviteCode: z.string().trim().min(4).max(80),
  targetRole: InvitationTargetRoleSchema,
  status: z.literal("active"),
  expiresAt: z.iso.datetime({ offset: true }),
  createdAt: z.iso.datetime({ offset: true }),
}).strict();

export const InvitationRedeemRequestSchema = z.object({
  companyId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  inviteCode: z.string().trim().toUpperCase().min(4).max(80),
  displayName: z.string().trim().min(1).max(200).optional(),
  phoneNumber: z.string().trim().min(3).max(40).optional(),
}).strict();

export const InvitationMembershipSchema = z.object({
  memberNo: z.number().int().positive(),
  role: InvitationTargetRoleSchema,
  displayName: z.string().trim().min(1).max(200).nullable(),
  status: z.literal("active"),
  joinedAt: z.iso.datetime({ offset: true }),
}).strict();

export const InvitationRedemptionResultSchema = z.object({
  workspace: WorkspaceSummarySchema,
  membership: InvitationMembershipSchema,
}).strict();

export type InvitationTargetRole = z.infer<typeof InvitationTargetRoleSchema>;
export type InvitationCreateRequest = z.input<typeof InvitationCreateRequestSchema>;
export type InvitationCreateResult = z.infer<typeof InvitationCreateResultSchema>;
export type InvitationRedeemRequest = z.infer<typeof InvitationRedeemRequestSchema>;
export type InvitationMembership = z.infer<typeof InvitationMembershipSchema>;
export type InvitationRedemptionResult = z.infer<typeof InvitationRedemptionResultSchema>;

export const ViewerSchema = z.object({
  uid: z.uuid(),
  email: z.email().nullable(),
  displayName: z.string().trim().min(1).max(200).nullable(),
  emailVerified: z.boolean(),
  workspaces: z.array(WorkspaceSummarySchema),
}).strict();

export type Viewer = z.infer<typeof ViewerSchema>;

const NullableTrimmedProfileField = (maximum: number) => z.union([
  z.null(),
  z.string().trim().min(1).max(maximum),
]);

export const ViewerProfileUpdateRequestSchema = z.object({
  companyId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  displayName: NullableTrimmedProfileField(200).optional(),
  phoneNumber: NullableTrimmedProfileField(40).optional(),
}).strict().superRefine((value, context) => {
  if (value.displayName === undefined && value.phoneNumber === undefined) {
    context.addIssue({
      code: "custom",
      message: "Provide displayName or phoneNumber",
      path: [],
    });
  }
});

export const ViewerProfileSchema = z.object({
  uid: z.uuid(),
  email: z.email().max(320),
  displayName: z.string().trim().min(1).max(200).nullable(),
  phoneNumber: z.string().trim().min(1).max(40).nullable(),
  systemRole: z.literal(Role.dev).nullable(),
  companyId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

const NullableBusinessEmailSchema = z.union([
  z.null(),
  z.string().trim().toLowerCase().pipe(z.email().max(320)),
]);

export const BusinessProfileUpdateRequestSchema = z.object({
  entityVersion: EntityVersionSchema,
  heName: NullableTrimmedProfileField(200).optional(),
  enName: NullableTrimmedProfileField(200).optional(),
  businessType: NullableTrimmedProfileField(120).optional(),
  city: NullableTrimmedProfileField(120).optional(),
  address: NullableTrimmedProfileField(500).optional(),
  businessEmail: NullableBusinessEmailSchema.optional(),
  businessPhone: NullableTrimmedProfileField(40).optional(),
  businessFax: NullableTrimmedProfileField(40).optional(),
  accountantName: NullableTrimmedProfileField(200).optional(),
  accountantEmail: NullableBusinessEmailSchema.optional(),
  accountantPhone: NullableTrimmedProfileField(40).optional(),
}).strict().superRefine((value, context) => {
  if (Object.entries(value).every(([key, field]) => key === "entityVersion" || field === undefined)) {
    context.addIssue({
      code: "custom",
      message: "Provide at least one company profile field",
      path: [],
    });
  }
});

export const BusinessProfileSchema = z.object({
  companyId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  heName: z.string().max(200).nullable(),
  enName: z.string().max(200).nullable(),
  vatNumber: z.string().max(32).nullable(),
  businessType: z.string().max(120).nullable(),
  city: z.string().max(120).nullable(),
  address: z.string().max(500).nullable(),
  businessEmail: z.email().max(320).nullable(),
  businessPhone: z.string().max(40).nullable(),
  businessFax: z.string().max(40).nullable(),
  accountantName: z.string().max(200).nullable(),
  accountantEmail: z.email().max(320).nullable(),
  accountantPhone: z.string().max(40).nullable(),
  entityVersion: EntityVersionSchema,
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

export type ViewerProfileUpdateRequest = z.infer<typeof ViewerProfileUpdateRequestSchema>;
export type ViewerProfile = z.infer<typeof ViewerProfileSchema>;
export type BusinessProfileUpdateRequest = z.infer<typeof BusinessProfileUpdateRequestSchema>;
export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;

export const WebSessionTokenSchema = z.string()
  .regex(/^[A-Za-z0-9_-]{43}$/, "Invalid opaque session token")
  .brand<"WebSessionToken">();

export const WebSessionCsrfTokenSchema = z.string()
  .regex(/^[A-Za-z0-9_-]{43}$/, "Invalid CSRF token")
  .brand<"WebSessionCsrfToken">();

export const WebSessionCreateRequestSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
  password: z.string().min(1).max(1_024),
}).strict();

export const WebSessionCreatedSchema = z.object({
  sessionToken: WebSessionTokenSchema,
  csrfToken: WebSessionCsrfTokenSchema,
  absoluteExpiresAt: z.iso.datetime({ offset: true }),
  viewer: ViewerSchema,
}).strict();

export const WebSessionCurrentSchema = z.object({
  absoluteExpiresAt: z.iso.datetime({ offset: true }),
  viewer: ViewerSchema,
}).strict();

export const WebSessionRevokedSchema = z.object({
  revoked: z.literal(true),
}).strict();

export type WebSessionToken = z.infer<typeof WebSessionTokenSchema>;
export type WebSessionCsrfToken = z.infer<typeof WebSessionCsrfTokenSchema>;
export type WebSessionCreateRequest = z.input<typeof WebSessionCreateRequestSchema>;
export type WebSessionCreated = z.infer<typeof WebSessionCreatedSchema>;
export type WebSessionCurrent = z.infer<typeof WebSessionCurrentSchema>;
export type WebSessionRevoked = z.infer<typeof WebSessionRevokedSchema>;

export const CompanySyncStateSchema = z.object({
  jobsVersion: z.number().int().nonnegative(),
  documentsVersion: z.number().int().nonnegative(),
  clientsVersion: z.number().int().nonnegative(),
  workersVersion: z.number().int().nonnegative(),
  companyInventoryVersion: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

export type CompanySyncState = z.infer<typeof CompanySyncStateSchema>;

export const BootstrapCountsSchema = z.object({
  jobs: z.number().int().nonnegative(),
  clients: z.number().int().nonnegative(),
  inventoryParts: z.number().int().nonnegative(),
  documents: z.number().int().nonnegative(),
  pendingDocumentTasks: z.number().int().nonnegative(),
}).strict();

export const CompanySubscriptionSummarySchema = z.object({
  tier: TierSchema,
  status: SubscriptionStatusSchema,
  enabledModules: z.array(z.string().trim().min(1).max(100)).max(100),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

export const TaxSubmissionModeSchema = stringEnumSchema(
  Object.values(CanonicalTaxSubmissionMode),
);

export const BootstrapCapabilitiesSchema = z.object({
  taxSubmissionMode: TaxSubmissionModeSchema,
}).strict();

export const CompanyBootstrapSchema = z.object({
  workspace: WorkspaceSummarySchema,
  subscription: CompanySubscriptionSummarySchema.nullable(),
  syncState: CompanySyncStateSchema,
  counts: BootstrapCountsSchema,
  capabilities: BootstrapCapabilitiesSchema,
}).strict();

export type BootstrapCounts = z.infer<typeof BootstrapCountsSchema>;
export type CompanySubscriptionSummary = z.infer<typeof CompanySubscriptionSummarySchema>;
export type TaxSubmissionMode = z.infer<typeof TaxSubmissionModeSchema>;
export type BootstrapCapabilities = z.infer<typeof BootstrapCapabilitiesSchema>;
export type CompanyBootstrap = z.infer<typeof CompanyBootstrapSchema>;

export const CursorPageSchema = <TSchema extends z.ZodType>(itemSchema: TSchema) => z.object({
  items: z.array(itemSchema),
  nextCursor: CursorSchema.nullable(),
}).strict();

export const createCursorPageSchema = CursorPageSchema;

export type CursorPage<T> = {
  items: T[];
  nextCursor: Cursor | null;
};

export const DEFAULT_JOB_PAGE_SIZE = 50;
export const MAX_JOB_PAGE_SIZE = 200;

const JobStatusFilterSchema = z.union([
  JobStatusSchema,
  z.array(JobStatusSchema).min(1).max(Object.keys(JobStatus).length),
]);

export const JobListQuerySchema = z.object({
  status: JobStatusFilterSchema.optional(),
  dateField: z.enum(["createdAt", "updatedAt", "finishedAt", "dueAt"]).optional(),
  dateFrom: z.iso.datetime({ offset: true }).optional(),
  dateTo: z.iso.datetime({ offset: true }).optional(),
  creatorUid: z.uuid().optional(),
  search: z.string().trim().min(1).max(80).optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_JOB_PAGE_SIZE).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_JOB_PAGE_SIZE).optional(),
  afterCursor: CursorSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.pageSize !== undefined && value.limit !== undefined) {
    context.addIssue({
      code: "custom",
      message: "Use either pageSize or limit, not both",
      path: ["limit"],
    });
  }
  if (
    value.dateFrom !== undefined
    && value.dateTo !== undefined
    && Date.parse(value.dateTo) < Date.parse(value.dateFrom)
  ) {
    context.addIssue({
      code: "custom",
      message: "dateTo cannot be earlier than dateFrom",
      path: ["dateTo"],
    });
  }
});

export type JobListQuery = z.infer<typeof JobListQuerySchema>;

export const JobClientSummarySchema = z.object({
  id: z.uuid().nullable(),
  name: z.string().max(240).nullable(),
  phone: z.string().max(40).nullable(),
}).strict();

export const JobAssigneeSummarySchema = z.object({
  memberNo: z.number().int().positive(),
  displayName: z.string().max(200).nullable(),
}).strict();

export const JobCreatorSummarySchema = z.object({
  uid: z.uuid().nullable(),
  memberNo: z.number().int().positive().nullable(),
  displayName: z.string().max(200).nullable(),
}).strict();

export const JobSummarySchema = z.object({
  jobId: z.uuid(),
  jobNo: z.number().int().positive(),
  status: JobStatusSchema,
  title: z.string().max(240),
  description: z.string().max(50_000),
  notes: z.string().max(50_000).nullable(),
  location: z.string().max(240).nullable(),
  address: z.string().max(500).nullable(),
  category: z.string().max(120).nullable(),
  priority: z.string().max(40).nullable(),
  dueAt: z.iso.datetime({ offset: true }).nullable(),
  client: JobClientSummarySchema.nullable(),
  assignee: JobAssigneeSummarySchema.nullable(),
  creator: JobCreatorSummarySchema.nullable(),
  isCertificate: z.boolean(),
  timeFrom: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/).nullable(),
  timeTo: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/).nullable(),
  signingPerson: z.string().max(200).nullable(),
  travelDistance: z.number().nonnegative().max(10_000_000).nullable(),
  entityVersion: EntityVersionSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
  deniedAt: z.iso.datetime({ offset: true }).nullable(),
}).strict();

export const JobListPageSchema = CursorPageSchema(JobSummarySchema);

export type JobClientSummary = z.infer<typeof JobClientSummarySchema>;
export type JobAssigneeSummary = z.infer<typeof JobAssigneeSummarySchema>;
export type JobCreatorSummary = z.infer<typeof JobCreatorSummarySchema>;
export type JobSummary = z.infer<typeof JobSummarySchema>;

export const DEFAULT_CLIENT_PAGE_SIZE = 50;
export const MAX_CLIENT_PAGE_SIZE = 200;

export const ClientStatusSchema = z.enum(["active", "archived"]);
export const ClientStatusFilterSchema = z.enum(["active", "archived", "all"]);

export const ClientListQuerySchema = z.object({
  search: z.string().trim().min(1).max(80).optional(),
  status: ClientStatusFilterSchema.optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_CLIENT_PAGE_SIZE).optional(),
  afterCursor: CursorSchema.optional(),
}).strict();

export const ClientSummarySchema = z.object({
  clientId: z.uuid(),
  clientNo: z.number().int().positive(),
  status: ClientStatusSchema,
  name: z.string().min(1).max(240),
  phone: z.string().max(40).nullable(),
  email: z.email().max(320).nullable(),
  address: z.string().max(500).nullable(),
  city: z.string().max(120).nullable(),
  vatNumber: z.string().max(32).nullable(),
  notes: z.string().max(50_000).nullable(),
  entityVersion: EntityVersionSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  archivedAt: z.iso.datetime({ offset: true }).nullable(),
}).strict();

export const ClientListPageSchema = CursorPageSchema(ClientSummarySchema);

const NullableClientFieldSchema = (maximum: number) => z.union([
  z.null(),
  z.string().trim().min(1).max(maximum),
]);
const NullableClientEmailSchema = z.union([
  z.null(),
  z.string().trim().toLowerCase().pipe(z.email().max(320)),
]);
const NullableClientVatNumberSchema = z.union([
  z.null(),
  z.string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[^\u0000-\u001F\u007F]+$/u, "VAT number cannot contain control characters"),
]);
const ClientNameSchema = z.string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[^\u0000-\u001F\u007F]+$/u, "Client name cannot contain control characters");

const clientWritableFields = {
  phone: NullableClientFieldSchema(40).optional(),
  email: NullableClientEmailSchema.optional(),
  address: NullableClientFieldSchema(500).optional(),
  city: NullableClientFieldSchema(120).optional(),
  vatNumber: NullableClientVatNumberSchema.optional(),
  notes: NullableClientFieldSchema(2_000).optional(),
} as const;

export const ClientCreateRequestSchema = z.object({
  name: ClientNameSchema,
  ...clientWritableFields,
}).strict();

export const ClientUpdateRequestSchema = z.object({
  entityVersion: EntityVersionSchema,
  name: ClientNameSchema.optional(),
  status: ClientStatusSchema.optional(),
  ...clientWritableFields,
}).strict().superRefine((value, context) => {
  if (Object.entries(value).every(([key, field]) => key === "entityVersion" || field === undefined)) {
    context.addIssue({
      code: "custom",
      message: "Provide at least one client field",
      path: [],
    });
  }
});

export const ClientDeleteRequestSchema = z.object({
  entityVersion: EntityVersionSchema,
}).strict();

export const ClientDeleteDispositionSchema = z.enum(["deleted", "archived"]);
export const ClientDeleteResultSchema = z.object({
  clientId: z.uuid(),
  clientNo: z.number().int().positive(),
  disposition: ClientDeleteDispositionSchema,
  entityVersion: EntityVersionSchema.nullable(),
  archivedAt: z.iso.datetime({ offset: true }).nullable(),
}).strict();

export type ClientStatus = z.infer<typeof ClientStatusSchema>;
export type ClientStatusFilter = z.infer<typeof ClientStatusFilterSchema>;
export type ClientListQuery = z.infer<typeof ClientListQuerySchema>;
export type ClientSummary = z.infer<typeof ClientSummarySchema>;
export type ClientCreateRequest = z.infer<typeof ClientCreateRequestSchema>;
export type ClientUpdateRequest = z.infer<typeof ClientUpdateRequestSchema>;
export type ClientDeleteRequest = z.infer<typeof ClientDeleteRequestSchema>;
export type ClientDeleteDisposition = z.infer<typeof ClientDeleteDispositionSchema>;
export type ClientDeleteResult = z.infer<typeof ClientDeleteResultSchema>;

export const DEFAULT_WORKER_PAGE_SIZE = 50;
export const MAX_WORKER_PAGE_SIZE = 200;

export const WorkerDirectoryRoleSchema = stringEnumSchema([
  Role.worker,
  Role.user,
  Role.basic,
] as const);
export const WorkerMembershipStatusSchema = z.enum(["active", "disabled", "pending"]);

const WorkerDirectoryRoleFilterSchema = z.union([
  WorkerDirectoryRoleSchema,
  z.array(WorkerDirectoryRoleSchema).min(1).max(WorkerDirectoryRoleSchema.options.length),
]);
const WorkerMembershipStatusFilterSchema = z.union([
  WorkerMembershipStatusSchema,
  z.array(WorkerMembershipStatusSchema).min(1).max(WorkerMembershipStatusSchema.options.length),
]);

export const WorkerListQuerySchema = z.object({
  search: z.string().trim().min(1).max(80).optional(),
  role: WorkerDirectoryRoleFilterSchema.optional(),
  status: WorkerMembershipStatusFilterSchema.optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_WORKER_PAGE_SIZE).optional(),
  afterCursor: CursorSchema.optional(),
}).strict();

export const WorkerSummarySchema = z.object({
  memberNo: z.number().int().positive(),
  role: WorkerDirectoryRoleSchema,
  status: WorkerMembershipStatusSchema,
  displayName: z.string().trim().min(1).max(200).nullable(),
  email: z.email().max(320).nullable(),
  phoneNumber: z.string().max(40).nullable(),
  entityVersion: EntityVersionSchema,
  joinedAt: z.iso.datetime({ offset: true }),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

export const WorkerListPageSchema = CursorPageSchema(WorkerSummarySchema);

const NullableWorkerFieldSchema = (maximum: number) => z.union([
  z.null(),
  z.string().trim().min(1).max(maximum),
]);

export const WorkerUpdateRequestSchema = z.object({
  entityVersion: EntityVersionSchema,
  displayName: NullableWorkerFieldSchema(200).optional(),
  phoneNumber: NullableWorkerFieldSchema(40).optional(),
  role: WorkerDirectoryRoleSchema.optional(),
  status: z.enum(["active", "disabled"]).optional(),
}).strict().superRefine((value, context) => {
  if (Object.entries(value).every(([key, field]) => key === "entityVersion" || field === undefined)) {
    context.addIssue({
      code: "custom",
      message: "Provide at least one worker membership field",
      path: [],
    });
  }
});

export const WorkerDisableRequestSchema = z.object({
  entityVersion: EntityVersionSchema,
}).strict();

export type WorkerDirectoryRole = z.infer<typeof WorkerDirectoryRoleSchema>;
export type WorkerMembershipStatus = z.infer<typeof WorkerMembershipStatusSchema>;
export type WorkerListQuery = z.infer<typeof WorkerListQuerySchema>;
export type WorkerSummary = z.infer<typeof WorkerSummarySchema>;
export type WorkerUpdateRequest = z.infer<typeof WorkerUpdateRequestSchema>;
export type WorkerDisableRequest = z.infer<typeof WorkerDisableRequestSchema>;

export const DEFAULT_INVENTORY_PAGE_SIZE = 50;
export const MAX_INVENTORY_PAGE_SIZE = 200;

export const InventoryPartStatusSchema = z.enum(["active", "inactive", "archived"]);

const InventoryPartStatusFilterSchema = z.union([
  InventoryPartStatusSchema,
  z.array(InventoryPartStatusSchema).min(1).max(InventoryPartStatusSchema.options.length),
]);

export const InventoryListQuerySchema = z.object({
  status: InventoryPartStatusFilterSchema.optional(),
  search: z.string().trim().min(1).max(80).optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_INVENTORY_PAGE_SIZE).optional(),
  afterCursor: CursorSchema.optional(),
}).strict();

export const InventoryPartSummarySchema = z.object({
  partId: z.uuid(),
  partNo: z.number().int().positive(),
  status: InventoryPartStatusSchema,
  name: z.string().min(1).max(240),
  active: z.boolean(),
  quantity: z.number().finite().nonnegative(),
  lowThreshold: z.number().finite().nonnegative(),
  unit: z.string().max(40).nullable(),
  entityVersion: EntityVersionSchema,
  stockEntityVersion: EntityVersionSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  archivedAt: z.iso.datetime({ offset: true }).nullable(),
}).strict();

export const InventoryListPageSchema = CursorPageSchema(InventoryPartSummarySchema);

export type InventoryPartStatus = z.infer<typeof InventoryPartStatusSchema>;
export type InventoryListQuery = z.infer<typeof InventoryListQuerySchema>;
export type InventoryPartSummary = z.infer<typeof InventoryPartSummarySchema>;

export const MAX_INVENTORY_MUTATION_QUANTITY = 99_999_999_999.999;
export const MAX_INVENTORY_PICK_ITEMS = 100;

const InventoryQuantitySchema = z.number()
  .finite()
  .nonnegative()
  .max(MAX_INVENTORY_MUTATION_QUANTITY)
  .multipleOf(0.001);
const PositiveInventoryQuantitySchema = InventoryQuantitySchema.refine(
  (value) => value > 0,
  "Quantity must be greater than zero",
);
const InventoryNameSchema = z.string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[^\u0000-\u001F\u007F]+$/u, "Part name cannot contain control characters");
const NullableInventoryUnitSchema = z.union([
  z.null(),
  z.string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[^\u0000-\u001F\u007F]+$/u, "Unit cannot contain control characters"),
]);
const NullableInventoryNoteSchema = z.union([
  z.null(),
  z.string().trim().min(1).max(500),
]);

export const InventoryPartCreateRequestSchema = z.object({
  name: InventoryNameSchema,
  initialQuantity: InventoryQuantitySchema.optional().default(0),
  lowThreshold: InventoryQuantitySchema.optional().default(0),
  unit: NullableInventoryUnitSchema.optional().default(null),
}).strict();

export const InventoryPartUpdateRequestSchema = z.object({
  entityVersion: EntityVersionSchema,
  name: InventoryNameSchema.optional(),
  active: z.boolean().optional(),
  lowThreshold: InventoryQuantitySchema.optional(),
  unit: NullableInventoryUnitSchema.optional(),
}).strict().superRefine((value, context) => {
  if (Object.entries(value).every(([key, field]) => key === "entityVersion" || field === undefined)) {
    context.addIssue({
      code: "custom",
      message: "Provide at least one inventory part field",
      path: [],
    });
  }
});

export const InventoryPartArchiveRequestSchema = z.object({
  entityVersion: EntityVersionSchema,
}).strict();

export const InventoryAdjustmentRequestSchema = z.object({
  stockEntityVersion: EntityVersionSchema,
  quantityDelta: z.number()
    .finite()
    .min(-MAX_INVENTORY_MUTATION_QUANTITY)
    .max(MAX_INVENTORY_MUTATION_QUANTITY)
    .multipleOf(0.001)
    .refine((value) => value !== 0, "Quantity delta cannot be zero"),
  note: NullableInventoryNoteSchema.optional(),
}).strict();

export const InventoryTransferDirectionSchema = z.enum([
  "company_to_member",
  "member_to_company",
]);
export const InventoryTransferRequestSchema = z.object({
  partId: z.uuid(),
  memberNo: z.number().int().positive().max(2_147_483_647),
  direction: InventoryTransferDirectionSchema,
  quantity: PositiveInventoryQuantitySchema,
  sourceStockEntityVersion: EntityVersionSchema,
  note: NullableInventoryNoteSchema.optional(),
}).strict();

export const InventoryPickItemSchema = z.object({
  partId: z.uuid(),
  quantity: PositiveInventoryQuantitySchema,
  stockEntityVersion: EntityVersionSchema,
}).strict();
export const InventoryPickRequestSchema = z.object({
  memberNo: z.number().int().positive().max(2_147_483_647),
  items: z.array(InventoryPickItemSchema).min(1).max(MAX_INVENTORY_PICK_ITEMS),
}).strict().superRefine((value, context) => {
  const partIds = new Set<string>();
  value.items.forEach((item, index) => {
    if (partIds.has(item.partId)) {
      context.addIssue({
        code: "custom",
        message: "Each part can be picked only once",
        path: ["items", index, "partId"],
      });
    }
    partIds.add(item.partId);
  });
});

export const InventoryMovementResultSchema = z.object({
  movementId: z.uuid(),
  partId: z.uuid(),
  partNo: z.number().int().positive(),
  quantity: z.number().finite().positive(),
  sourceQuantity: z.number().finite().nonnegative(),
  sourceStockEntityVersion: EntityVersionSchema,
  destinationQuantity: z.number().finite().nonnegative(),
  destinationStockEntityVersion: EntityVersionSchema,
}).strict();
export const InventoryTransferResultSchema = z.object({
  movement: InventoryMovementResultSchema,
}).strict();
export const InventoryPickResultSchema = z.object({
  movements: z.array(InventoryMovementResultSchema).min(1).max(MAX_INVENTORY_PICK_ITEMS),
}).strict();

export type InventoryPartCreateRequest = z.infer<typeof InventoryPartCreateRequestSchema>;
export type InventoryPartUpdateRequest = z.infer<typeof InventoryPartUpdateRequestSchema>;
export type InventoryPartArchiveRequest = z.infer<typeof InventoryPartArchiveRequestSchema>;
export type InventoryAdjustmentRequest = z.infer<typeof InventoryAdjustmentRequestSchema>;
export type InventoryTransferDirection = z.infer<typeof InventoryTransferDirectionSchema>;
export type InventoryTransferRequest = z.infer<typeof InventoryTransferRequestSchema>;
export type InventoryPickItem = z.infer<typeof InventoryPickItemSchema>;
export type InventoryPickRequest = z.infer<typeof InventoryPickRequestSchema>;
export type InventoryMovementResult = z.infer<typeof InventoryMovementResultSchema>;
export type InventoryTransferResult = z.infer<typeof InventoryTransferResultSchema>;
export type InventoryPickResult = z.infer<typeof InventoryPickResultSchema>;

export const UploadAttachmentKindSchema = z.enum(["photo", "signature"]);
export const JobAttachmentPurposeSchema = z.enum([
  "job.create_finished",
  "job.complete_assigned",
]);
export const JobAttachmentMimeTypeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export const MAX_JOB_ATTACHMENT_BYTES = 10 * 1_024 * 1_024;
export const MAX_JOB_ATTACHMENT_TOTAL_BYTES = 50 * 1_024 * 1_024;

export const UploadAttachmentManifestSchema = z.object({
  attachmentId: z.uuid(),
  kind: UploadAttachmentKindSchema,
  fileName: z.string().trim().min(1).max(255),
  mimeType: JobAttachmentMimeTypeSchema,
  sizeBytes: z.number().int().positive().max(MAX_JOB_ATTACHMENT_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();

export type UploadAttachmentManifest = z.infer<typeof UploadAttachmentManifestSchema>;

const UploadAttachmentManifestListSchema = z.array(UploadAttachmentManifestSchema)
  .min(1)
  .max(20)
  .superRefine((attachments, context) => {
    const attachmentIds = new Set<string>();
    let totalBytes = 0;
    attachments.forEach((attachment, index) => {
      totalBytes += attachment.sizeBytes;
      if (attachmentIds.has(attachment.attachmentId)) {
        context.addIssue({
          code: "custom",
          message: "Each attachment can appear only once",
          path: [index, "attachmentId"],
        });
      }
      attachmentIds.add(attachment.attachmentId);
    });
    if (totalBytes > MAX_JOB_ATTACHMENT_TOTAL_BYTES) {
      context.addIssue({
        code: "custom",
        message: "The combined attachment size is too large",
        path: [],
      });
    }
  });

export const JobAttachmentUploadSessionRequestSchema = z.object({
  companyId: z.number().int().positive(),
  purpose: JobAttachmentPurposeSchema,
  jobId: z.uuid().nullable().optional(),
  attachments: UploadAttachmentManifestListSchema,
}).strict().superRefine((value, context) => {
  const hasJobId = Boolean(value.jobId);
  if (value.purpose === "job.complete_assigned" && !hasJobId) {
    context.addIssue({
      code: "custom",
      message: "An assigned job is required for completion uploads",
      path: ["jobId"],
    });
  }
  if (value.purpose === "job.create_finished" && hasJobId) {
    context.addIssue({
      code: "custom",
      message: "Finished-job creation uploads cannot target an existing job",
      path: ["jobId"],
    });
  }
});

export type JobAttachmentUploadSessionRequest = z.input<
  typeof JobAttachmentUploadSessionRequestSchema
>;

export const SignedUploadTargetSchema = UploadAttachmentManifestSchema.extend({
  objectPath: z.string().trim().min(1).max(1_024),
  uploadUrl: z.url(),
  requiredHeaders: z.record(z.string(), z.string()).default({}),
}).strict();

export type SignedUploadTarget = z.infer<typeof SignedUploadTargetSchema>;

export const JobAttachmentUploadSessionSchema = z.object({
  uploadSessionId: z.uuid(),
  companyId: z.number().int().positive(),
  jobId: z.uuid().nullable(),
  expiresAt: z.iso.datetime({ offset: true }),
  attachments: z.array(SignedUploadTargetSchema).min(1).max(20),
}).strict();

export type JobAttachmentUploadSession = z.infer<typeof JobAttachmentUploadSessionSchema>;

const MAX_QUANTITY = 99_999_999_999.999;
const JobTimeSchema = z.string()
  .trim()
  .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "Use a valid 24-hour time")
  .nullable()
  .optional();

export const JobPartUsageSchema = z.object({
  partId: z.number().int().positive().max(2_147_483_647),
  quantity: z.number().positive().max(MAX_QUANTITY).multipleOf(0.001),
}).strict();

const JobPartsSchema = z.array(JobPartUsageSchema).max(500).superRefine((parts, context) => {
  const seen = new Set<number>();
  parts.forEach((part, index) => {
    if (seen.has(part.partId)) {
      context.addIssue({
        code: "custom",
        message: "Each part can appear only once",
        path: [index, "partId"],
      });
    }
    seen.add(part.partId);
  });
});

const jobDetailsShape = {
  timeFrom: JobTimeSchema,
  timeTo: JobTimeSchema,
  signingPerson: z.string().trim().min(1).max(200).nullable().optional(),
  travelDistance: z.number().nonnegative().max(10_000_000).multipleOf(0.001).nullable().optional(),
  partsUsed: JobPartsSchema.optional(),
  uploadSessionId: z.uuid().nullable().optional(),
} as const;

function clockMinutes(value: string): number {
  const [hours = 0, minutes = 0] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function validateJobTimeRange(
  value: {
    readonly timeFrom?: string | null | undefined;
    readonly timeTo?: string | null | undefined;
  },
  context: z.RefinementCtx,
): void {
  if (
    value.timeFrom
    && value.timeTo
    && clockMinutes(value.timeTo) < clockMinutes(value.timeFrom)
  ) {
    context.addIssue({
      code: "custom",
      message: "End time cannot be earlier than start time",
      path: ["timeTo"],
    });
  }
}

export const JobCreateRequestSchema = z.object({
  ...jobDetailsShape,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10_000),
  location: z.string().trim().max(240).nullable().optional(),
  clientId: z.string().trim().min(1).max(160).nullable().optional(),
  assigneeMemberNo: z.number().int().positive().nullable().optional(),
  status: JobCreateStatusSchema,
}).strict().superRefine(validateJobTimeRange);

export type JobCreateRequest = z.input<typeof JobCreateRequestSchema>;

export const JobCreateResultSchema = z.object({
  jobId: z.uuid(),
  jobNo: z.number().int().positive(),
  status: JobCreateStatusSchema,
  entityVersion: EntityVersionSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

export type JobCreateResult = z.infer<typeof JobCreateResultSchema>;

export const JobUpdateRequestSchema = z.object({
  entityVersion: EntityVersionSchema,
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(10_000).nullable().optional(),
  notes: z.string().trim().max(10_000).nullable().optional(),
  location: z.string().trim().max(240).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  category: z.string().trim().max(120).nullable().optional(),
  priority: z.string().trim().max(40).nullable().optional(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  clientId: z.uuid().nullable().optional(),
  assigneeMemberNo: z.number().int().positive().max(2_147_483_647).nullable().optional(),
  status: JobUpdateStatusSchema.optional(),
}).strict().refine(
  (value) => Object.keys(value).some((key) => key !== "entityVersion"),
  { message: "At least one job field must be updated" },
);

export type JobUpdateRequest = z.input<typeof JobUpdateRequestSchema>;

export const JobUpdateResultSchema = JobSummarySchema;
export type JobUpdateResult = z.infer<typeof JobUpdateResultSchema>;

export const JobAcceptRequestSchema = z.object({
  entityVersion: EntityVersionSchema,
}).strict();

export type JobAcceptRequest = z.input<typeof JobAcceptRequestSchema>;

export const JobAcceptResultSchema = JobSummarySchema;
export type JobAcceptResult = z.infer<typeof JobAcceptResultSchema>;

export const JobDeleteRequestSchema = z.object({
  entityVersion: EntityVersionSchema,
}).strict();

export type JobDeleteRequest = z.input<typeof JobDeleteRequestSchema>;

export const JobDeleteResultSchema = z.object({
  jobId: z.uuid(),
  jobNo: z.number().int().positive(),
  deleted: z.literal(true),
}).strict();

export type JobDeleteResult = z.infer<typeof JobDeleteResultSchema>;

export const JobCompletionRequestSchema = z.object({
  ...jobDetailsShape,
  entityVersion: EntityVersionSchema,
}).strict().superRefine(validateJobTimeRange);

export type JobCompletionRequest = z.input<typeof JobCompletionRequestSchema>;

export const JobCompletionResultSchema = z.object({
  jobId: z.uuid(),
  jobNo: z.number().int().positive(),
  status: z.literal(JobStatus.Finished),
  entityVersion: EntityVersionSchema,
  finishedAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

export type JobCompletionResult = z.infer<typeof JobCompletionResultSchema>;

export const DocumentGenerationStatusSchema = z.enum([
  "pending",
  "queued",
  "processing",
  "completed",
  "failed",
]);

export const TaxAuthorityStatusSchema = stringEnumSchema(
  Object.values(CanonicalTaxAuthorityStatus),
);

export const EmailDeliveryStatusSchema = z.enum([
  "queued",
  "sending",
  "sent",
  "failed",
  "delivery_unknown",
]);

export const TaxSubmissionStatusSchema = z.enum([
  "queued",
  "submitting",
  "submitted",
  "approved",
  "rejected",
  "failed",
  "submission_unknown",
]);

export const DocumentDispatchMessageSchema = z.object({
  taskId: z.string().trim().min(1).max(160),
}).strict();

export const EmailDispatchMessageSchema = z.object({
  deliveryId: z.uuid(),
}).strict();

export const DEFAULT_DOCUMENT_PAGE_SIZE = 50;
export const MAX_DOCUMENT_PAGE_SIZE = 200;
const CoercedDocTypeSchema = z.preprocess(
  (value) => typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value,
  DocTypeSchema,
);

export const DocumentListQuerySchema = z.object({
  search: z.string().trim().min(1).max(80).optional(),
  status: z.union([
    DocumentGenerationStatusSchema,
    z.array(DocumentGenerationStatusSchema).min(1).max(DocumentGenerationStatusSchema.options.length),
  ]).optional(),
  documentType: z.union([
    CoercedDocTypeSchema,
    z.array(CoercedDocTypeSchema).min(1).max(Object.keys(DocType).length),
  ]).optional(),
  createdByUid: z.uuid().optional(),
  dateFrom: z.iso.datetime({ offset: true }).optional(),
  dateTo: z.iso.datetime({ offset: true }).optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_DOCUMENT_PAGE_SIZE).optional(),
  afterCursor: CursorSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.dateFrom && value.dateTo && Date.parse(value.dateFrom) > Date.parse(value.dateTo)) {
    context.addIssue({
      code: "custom",
      message: "dateFrom must not be after dateTo",
      path: ["dateFrom"],
    });
  }
});

export const DocumentClientSummarySchema = z.object({
  clientId: z.uuid().nullable(),
  name: z.string().max(240).nullable(),
  phone: z.string().max(40).nullable(),
  city: z.string().max(120).nullable(),
  vatNumber: z.string().max(32).nullable(),
}).strict();

export const DocumentCreatorSummarySchema = z.object({
  uid: z.uuid().nullable(),
  memberNo: z.number().int().positive().nullable(),
  displayName: z.string().max(320).nullable(),
}).strict();

export const DocumentSummarySchema = z.object({
  documentId: z.uuid(),
  documentCode: z.string().trim().min(1).max(64),
  documentType: DocTypeSchema,
  documentNumber: z.number().int().positive(),
  generationStatus: DocumentGenerationStatusSchema,
  taxAuthorityStatus: TaxAuthorityStatusSchema,
  client: DocumentClientSummarySchema.nullable(),
  creator: DocumentCreatorSummarySchema.nullable(),
  language: z.string().trim().min(1).max(8).nullable(),
  notes: z.string().max(20_000).nullable(),
  totalBeforeVat: z.number().finite().nonnegative(),
  vatAmount: z.number().finite().nonnegative(),
  totalWithVat: z.number().finite().nonnegative(),
  confirmationNumber: z.string().max(128).nullable(),
  documentDate: z.iso.datetime({ offset: true }).nullable(),
  hasFile: z.boolean(),
  emailSent: z.boolean(),
  emailDeliveryStatus: EmailDeliveryStatusSchema.nullable(),
  entityVersion: EntityVersionSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

export const DocumentListPageSchema = CursorPageSchema(DocumentSummarySchema);

export const DocumentDetailSchema = DocumentSummarySchema.extend({
  taxSubmissionStatus: TaxSubmissionStatusSchema.nullable(),
}).strict();

export const DocumentDownloadAccessSchema = z.object({
  documentId: z.uuid(),
  documentCode: z.string().trim().min(1).max(64),
  downloadURL: z.url(),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();

export type DocumentGenerationStatus = z.infer<typeof DocumentGenerationStatusSchema>;
export type TaxAuthorityStatus = z.infer<typeof TaxAuthorityStatusSchema>;
export type EmailDeliveryStatus = z.infer<typeof EmailDeliveryStatusSchema>;
export type TaxSubmissionStatus = z.infer<typeof TaxSubmissionStatusSchema>;
export type DocumentDispatchMessage = z.infer<typeof DocumentDispatchMessageSchema>;
export type EmailDispatchMessage = z.infer<typeof EmailDispatchMessageSchema>;
export type DocumentListQuery = z.infer<typeof DocumentListQuerySchema>;
export type DocumentClientSummary = z.infer<typeof DocumentClientSummarySchema>;
export type DocumentCreatorSummary = z.infer<typeof DocumentCreatorSummarySchema>;
export type DocumentSummary = z.infer<typeof DocumentSummarySchema>;
export type DocumentDetail = z.infer<typeof DocumentDetailSchema>;
export type DocumentDownloadAccess = z.infer<typeof DocumentDownloadAccessSchema>;

export const DocumentTaskStatusSchema = DocumentGenerationStatusSchema;

export const DocumentTaskTypeSchema = z.enum(["preview", "generate"]);

export const DocumentTaskSchema = z.object({
  taskId: z.string().trim().min(1).max(160),
  taskType: DocumentTaskTypeSchema,
  status: DocumentTaskStatusSchema,
  documentId: z.string().trim().min(1).max(160).nullable(),
  previewURL: z.url().nullable(),
  downloadURL: z.url().nullable(),
  pdfSize: z.number().int().nonnegative().nullable(),
  error: z.string().max(2_000).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

export type DocumentTask = z.infer<typeof DocumentTaskSchema>;

const DocumentBoundedMoneySchema = z.number().finite().nonnegative().max(99_999_999_999.99);
const DocumentBoundedQuantitySchema = z.number().finite().positive().max(99_999_999_999.999);

export const DocumentLineItemInputSchema = z.object({
  description: z.string().trim().min(1).max(240),
  quantity: DocumentBoundedQuantitySchema,
  price: DocumentBoundedMoneySchema,
  partNo: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict();

export const DocumentClientInputSchema = z.object({
  clientId: z.uuid().optional(),
  name: z.string().trim().min(1).max(240),
  email: z.email().max(320).optional(),
  phone: z.string().trim().min(1).max(40).optional(),
  address: z.string().trim().min(1).max(500).optional(),
  city: z.string().trim().min(1).max(120).optional(),
  clientVatNumber: z.string().trim().min(1).max(32).optional(),
}).strict();

export const DocumentPaymentInfoSchema = z.union([
  z.string().trim().min(1).max(1_000),
  z.record(z.string().trim().min(1).max(64), z.string().max(500)),
]);

export const DocumentDataInputSchema = z.object({
  client: DocumentClientInputSchema,
  items: z.array(DocumentLineItemInputSchema).min(1).max(100),
  language: z.enum(["he", "ar", "en"]).default("he"),
  date: z.union([
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    z.iso.datetime({ offset: true }),
  ]),
  notes: z.string().trim().max(4_000).optional(),
  paymentMethod: z.string().trim().min(1).max(80).optional(),
  paymentInfo: DocumentPaymentInfoSchema.optional(),
  invoiceReference: z.string().trim().min(1).max(128).optional(),
}).strict();

export const DocumentPreviewRequestSchema = z.object({
  documentType: DocTypeSchema,
  documentData: DocumentDataInputSchema,
}).strict();

export const DocumentGenerateRequestSchema = DocumentPreviewRequestSchema.superRefine(
  (request, context) => {
    if (request.documentType === DocType.TaxInvoice) {
      context.addIssue({
        code: "custom",
        path: ["documentType"],
        message: "Tax invoices must use the tax approval workflow.",
      });
    }
  },
);

export const DocumentTaskAcceptedSchema = z.object({
  taskId: z.string().trim().min(1).max(160),
  status: z.enum(["pending", "queued"]),
  documentId: z.uuid().nullable(),
  documentCode: z.string().trim().min(1).max(64).nullable(),
  entityVersion: EntityVersionSchema.nullable(),
}).strict();

export const DocumentDeleteRequestSchema = z.object({
  entityVersion: EntityVersionSchema,
}).strict();

export const DocumentDeleteResultSchema = z.object({
  documentId: z.uuid(),
  documentCode: z.string().trim().min(1).max(64),
  disposition: z.literal("deleted"),
}).strict();

export const DocumentEmailRetryResultSchema = z.object({
  documentId: z.uuid(),
  deliveryId: z.uuid(),
  emailDeliveryStatus: z.literal("queued"),
}).strict();

export const TaxInvoiceAcceptedSchema = z.object({
  documentId: z.uuid(),
  documentCode: z.string().trim().min(1).max(64),
  documentNumber: z.number().int().positive(),
  taxAuthorityStatus: z.literal("reserved"),
  submissionStatus: z.literal("queued"),
}).strict();

export const TaxInvoiceCreateRequestSchema = DocumentDataInputSchema.superRefine(
  (request, context) => {
    request.items.forEach((item, index) => {
      if (item.price <= 0) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "price"],
          message: "Tax-invoice item prices must be positive.",
        });
      }
    });
  },
);

export type DocumentLineItemInput = z.infer<typeof DocumentLineItemInputSchema>;
export type DocumentClientInput = z.infer<typeof DocumentClientInputSchema>;
export type DocumentDataInput = z.infer<typeof DocumentDataInputSchema>;
export type DocumentPreviewRequest = z.infer<typeof DocumentPreviewRequestSchema>;
export type DocumentGenerateRequest = z.infer<typeof DocumentGenerateRequestSchema>;
export type DocumentTaskAccepted = z.infer<typeof DocumentTaskAcceptedSchema>;
export type DocumentDeleteRequest = z.infer<typeof DocumentDeleteRequestSchema>;
export type DocumentDeleteResult = z.infer<typeof DocumentDeleteResultSchema>;
export type DocumentEmailRetryResult = z.infer<typeof DocumentEmailRetryResultSchema>;
export type TaxInvoiceAccepted = z.infer<typeof TaxInvoiceAcceptedSchema>;
export type TaxInvoiceCreateRequest = z.infer<typeof TaxInvoiceCreateRequestSchema>;

export const TaxInvoicePreviewRequestSchema = DocumentDataInputSchema.superRefine(
  (request, context) => {
    request.items.forEach((item, index) => {
      if (item.price <= 0) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "price"],
          message: "Tax-invoice item prices must be positive.",
        });
      }
    });
  },
);

export type TaxInvoicePreviewRequest = z.infer<typeof TaxInvoicePreviewRequestSchema>;

export const ArchiveContentQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(9999),
  month: z.coerce.number().int().min(1).max(12),
  dataType: z.enum(["documents", "finishedJobs"]),
}).strict();

export const ArchiveContentResponseSchema = z.object({
  year: z.number().int().min(2000).max(9999),
  month: z.number().int().min(1).max(12),
  dataType: z.string().min(1).max(32),
  items: z.array(z.record(z.string(), z.unknown())),
}).strict();

export type ArchiveContentQuery = z.infer<typeof ArchiveContentQuerySchema>;
export type ArchiveContentResponse = z.infer<typeof ArchiveContentResponseSchema>;

// Authenticated viewer push-token mutations. Tokens are write-only API data and
// intentionally have no response schema field.
export const PushTokenPlatformSchema = z.enum(["ios", "android"]);
export const PushDeviceIdSchema = z.string()
  .trim()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const PushTokenUpsertRequestSchema = z.object({
  deviceId: PushDeviceIdSchema,
  token: z.string().trim().min(8).max(500),
  platform: PushTokenPlatformSchema,
}).strict();

export const PushTokenClearRequestSchema = z.object({
  deviceId: PushDeviceIdSchema,
}).strict();

export const PushTokenUpsertResultSchema = z.object({
  registered: z.literal(true),
  platform: PushTokenPlatformSchema,
  pushTokenUpdatedAt: z.iso.datetime({ offset: true }),
}).strict();

export const PushTokenClearResultSchema = z.object({
  cleared: z.literal(true),
}).strict();

export type PushTokenPlatform = z.infer<typeof PushTokenPlatformSchema>;
export type PushTokenUpsertRequest = z.input<typeof PushTokenUpsertRequestSchema>;
export type PushTokenClearRequest = z.infer<typeof PushTokenClearRequestSchema>;
export type PushTokenUpsertResult = z.infer<typeof PushTokenUpsertResultSchema>;
export type PushTokenClearResult = z.infer<typeof PushTokenClearResultSchema>;

export const SupportCategorySchema = z.enum([
  "general",
  "bug",
  "opinion",
  "suggestion",
  "support",
  "freeChat",
]);
export const SupportConversationStatusSchema = z.enum(["open", "closed"]);
export const SupportSenderRoleSchema = z.enum(["user", "dev"]);

export const SupportConversationCreateRequestSchema = z.object({
  companyId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  category: SupportCategorySchema.default("general"),
}).strict();

export const SupportConversationSummarySchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  userName: z.string().trim().min(1).max(320),
  companyId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  category: SupportCategorySchema,
  status: SupportConversationStatusSchema,
  lastMessage: z.string().max(4_000),
  lastMessageAt: z.iso.datetime({ offset: true }),
  unreadForUser: z.number().int().nonnegative(),
  unreadForDev: z.number().int().nonnegative(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

export const SupportConversationListQuerySchema = z.object({
  status: SupportConversationStatusSchema.optional(),
  category: SupportCategorySchema.optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  afterCursor: CursorSchema.optional(),
}).strict();

export const SupportConversationListPageSchema = CursorPageSchema(
  SupportConversationSummarySchema,
);

export const SupportMessageCreateRequestSchema = z.object({
  text: z.string().trim().min(1).max(4_000),
}).strict();

export const SupportMessageSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  senderUid: z.union([z.uuid(), z.literal("dev")]),
  senderRole: SupportSenderRoleSchema,
  senderName: z.string().trim().min(1).max(320),
  text: z.string().min(1).max(4_000),
  createdAt: z.iso.datetime({ offset: true }),
}).strict();

export const SupportMessageListQuerySchema = z.object({
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  afterCursor: CursorSchema.optional(),
}).strict();

export const SupportConversationThreadSchema = z.object({
  conversation: SupportConversationSummarySchema,
  messages: z.array(SupportMessageSchema),
  nextCursor: CursorSchema.nullable(),
}).strict();

export const SupportConversationReadResultSchema = z.object({
  conversationId: z.uuid(),
  unreadForUser: z.number().int().nonnegative(),
  unreadForDev: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

export const SupportConversationClosedResultSchema = z.object({
  conversationId: z.uuid(),
  status: z.literal("closed"),
  closedAt: z.iso.datetime({ offset: true }),
}).strict();

export type SupportCategory = z.infer<typeof SupportCategorySchema>;
export type SupportConversationStatus = z.infer<typeof SupportConversationStatusSchema>;
export type SupportConversationCreateRequest = z.input<typeof SupportConversationCreateRequestSchema>;
export type SupportConversationSummary = z.infer<typeof SupportConversationSummarySchema>;
export type SupportConversationListQuery = z.infer<typeof SupportConversationListQuerySchema>;
export type SupportMessageCreateRequest = z.infer<typeof SupportMessageCreateRequestSchema>;
export type SupportMessage = z.infer<typeof SupportMessageSchema>;
export type SupportMessageListQuery = z.infer<typeof SupportMessageListQuerySchema>;
export type SupportConversationThread = z.infer<typeof SupportConversationThreadSchema>;

export const UpgradeRequestStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
]);

export const UpgradeRequestCreateRequestSchema = z.object({
  companyId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  requestedTier: stringEnumSchema(UPGRADEABLE_TIERS),
  message: z.string().trim().min(10).max(2_000),
}).strict();

export const UpgradeRequestSummarySchema = z.object({
  requestId: z.uuid(),
  requesterUid: z.uuid(),
  requesterEmail: z.email().max(320).nullable(),
  companyId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  role: RoleSchema,
  currentTier: TierSchema,
  requestedTier: stringEnumSchema(UPGRADEABLE_TIERS),
  message: z.string().min(1).max(2_000),
  status: UpgradeRequestStatusSchema,
  moderationNote: z.string().max(1_000).nullable(),
  moderatedAt: z.iso.datetime({ offset: true }).nullable(),
  moderatedByName: z.string().trim().min(1).max(200).nullable(),
  appliedAt: z.iso.datetime({ offset: true }).nullable(),
  entityVersion: EntityVersionSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

export const UpgradeRequestListQuerySchema = z.object({
  status: UpgradeRequestStatusSchema.optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  afterCursor: CursorSchema.optional(),
}).strict();

export const UpgradeRequestListPageSchema = CursorPageSchema(
  UpgradeRequestSummarySchema,
);

export const UpgradeRequestModerationRequestSchema = z.object({
  status: UpgradeRequestStatusSchema,
  moderationNote: z.string().trim().max(1_000).nullable().optional(),
  entityVersion: EntityVersionSchema,
}).strict();

export type UpgradeRequestStatus = z.infer<typeof UpgradeRequestStatusSchema>;
export type UpgradeRequestCreateRequest = z.infer<typeof UpgradeRequestCreateRequestSchema>;
export type UpgradeRequestSummary = z.infer<typeof UpgradeRequestSummarySchema>;
export type UpgradeRequestListQuery = z.infer<typeof UpgradeRequestListQuerySchema>;
export type UpgradeRequestModerationRequest = z.infer<
  typeof UpgradeRequestModerationRequestSchema
>;

export const ContactRequestCreateRequestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
  company: z.string().trim().min(2).max(140),
  subject: z.string().trim().min(2).max(500).nullable().optional(),
  message: z.string().trim().min(8).max(2_000),
}).strict();

export const ContactRequestCreatedResultSchema = z.object({
  requestId: z.uuid(),
  status: z.literal("received"),
  createdAt: z.iso.datetime({ offset: true }),
}).strict();

export type ContactRequestCreateRequest = z.infer<typeof ContactRequestCreateRequestSchema>;
export type ContactRequestCreatedResult = z.infer<typeof ContactRequestCreatedResultSchema>;
