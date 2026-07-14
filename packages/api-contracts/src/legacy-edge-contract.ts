/**
 * Frozen characterization of the pre-Cloud-Run Edge surface.
 *
 * These names are migration inputs, not the design for the new resource API.
 * Keep the catalog until every behavior has an API contract and acceptance test.
 */
export const LEGACY_DEFAULT_MUTATION_OPERATIONS = [
  "manageWorker",
  "registerBusinessV1",
  "createJobV1",
  "updateJobV1",
  "deleteJobV1",
  "acceptJobV1",
  "createJobFileDownloadUrlV1",
  "updateInventoryV1",
  "addClientV1",
  "deleteClientV1",
  "updateClientV1",
  "publishPreviewTask",
  "publishGenerateTask",
  "deleteDocumentV1",
  "createDocumentDownloadUrlV1",
  "fetchArchiveMonthV1",
  "updateProfileV1",
  "updatePushTokenV1",
  "clearPushTokenV1",
  "updateBusinessInfoV1",
  "updateCacheV1",
  "createSupportConversationV1",
  "appendSupportMessageV1",
  "markSupportConversationReadV1",
  "closeSupportConversationV1",
  "listSupportConversationsV1",
  "getSupportConversationThreadV1",
  "requestUpgradeV1",
  "listUpgradeRequestsV1",
  "moderateUpgradeRequestV1",
] as const;

export const LEGACY_TAX_MUTATION_OPERATIONS = ["getInvoiceApproval"] as const;

export const LEGACY_MUTATION_OPERATIONS = [
  ...LEGACY_DEFAULT_MUTATION_OPERATIONS,
  ...LEGACY_TAX_MUTATION_OPERATIONS,
] as const;

export type LegacyMutationOperation = (typeof LEGACY_MUTATION_OPERATIONS)[number];

export const LEGACY_READ_KINDS = [
  "bootstrap",
  "workers",
  "clients",
  "jobs",
  "documents",
  "inventory",
  "companySyncState",
  "recordById",
  "documentTask",
  "userSyncState",
] as const;

export type LegacyReadKind = (typeof LEGACY_READ_KINDS)[number];

/** Exact slugs deployed by the manual Supabase Edge workflow. */
export const LEGACY_DEPLOYED_FUNCTION_SLUGS = [
  "mutation-gateway",
  "mutation-gateway-me-west1",
  "read-model",
  "contact-request",
  "invites-create",
  "invites-join",
  "upgrades-request",
  "upgrades-list",
  "upgrades-moderate",
  "tax-callback",
] as const;

export type LegacyDeployedFunctionSlug = (typeof LEGACY_DEPLOYED_FUNCTION_SLUGS)[number];

/** Single-purpose endpoints invoked directly rather than through a gateway. */
export const LEGACY_DIRECT_FUNCTION_SLUGS = [
  "contact-request",
  "invites-create",
  "invites-join",
  "upgrades-request",
  "upgrades-list",
  "upgrades-moderate",
  "tax-callback",
] as const;

export const LEGACY_DIRECT_OPERATION_SLUGS = {
  contactRequestV1: "contact-request",
  createInviteV1: "invites-create",
  joinCompanyV1: "invites-join",
  requestUpgradeV1: "upgrades-request",
  listUpgradeRequestsV1: "upgrades-list",
  moderateUpgradeRequestV1: "upgrades-moderate",
} as const satisfies Record<string, LegacyDeployedFunctionSlug>;

export const LEGACY_GATEWAY_FUNCTION_SLUGS = {
  mutation: "mutation-gateway",
  taxMutation: "mutation-gateway-me-west1",
  read: "read-model",
} as const satisfies Record<string, LegacyDeployedFunctionSlug>;

export interface LegacyHttpExpectation {
  method: "POST";
  authorization: "supabase-bearer" | "public-challenge" | "callback-oidc-or-shared-token";
  acceptedStatus: 200 | 201;
  successEnvelope: "legacy-ok-data";
  missingAuthorizationStatus?: 401;
  insufficientRoleStatus?: 403;
  invalidRequestStatus: 400;
  wrongMethodStatus: 405;
}

/** Shared gateway behavior around every operation-specific handler payload. */
export const LEGACY_MUTATION_GATEWAY_EXPECTATION = {
  method: "POST",
  authorization: "supabase-bearer",
  acceptedStatus: 200,
  successEnvelope: "legacy-ok-data",
  missingAuthorizationStatus: 401,
  invalidRequestStatus: 400,
  wrongMethodStatus: 405,
} as const satisfies LegacyHttpExpectation;

export const LEGACY_READ_GATEWAY_EXPECTATION = {
  method: "POST",
  authorization: "supabase-bearer",
  acceptedStatus: 200,
  successEnvelope: "legacy-ok-data",
  missingAuthorizationStatus: 401,
  invalidRequestStatus: 400,
  wrongMethodStatus: 405,
} as const satisfies LegacyHttpExpectation;

export const LEGACY_DIRECT_HTTP_EXPECTATIONS = {
  contactRequestV1: {
    method: "POST",
    authorization: "public-challenge",
    acceptedStatus: 200,
    successEnvelope: "legacy-ok-data",
    invalidRequestStatus: 400,
    wrongMethodStatus: 405,
  },
  createInviteV1: {
    method: "POST",
    authorization: "supabase-bearer",
    acceptedStatus: 200,
    successEnvelope: "legacy-ok-data",
    missingAuthorizationStatus: 401,
    insufficientRoleStatus: 403,
    invalidRequestStatus: 400,
    wrongMethodStatus: 405,
  },
  joinCompanyV1: {
    method: "POST",
    authorization: "supabase-bearer",
    acceptedStatus: 200,
    successEnvelope: "legacy-ok-data",
    missingAuthorizationStatus: 401,
    invalidRequestStatus: 400,
    wrongMethodStatus: 405,
  },
  requestUpgradeV1: {
    method: "POST",
    authorization: "supabase-bearer",
    acceptedStatus: 201,
    successEnvelope: "legacy-ok-data",
    missingAuthorizationStatus: 401,
    invalidRequestStatus: 400,
    wrongMethodStatus: 405,
  },
  listUpgradeRequestsV1: {
    method: "POST",
    authorization: "supabase-bearer",
    acceptedStatus: 200,
    successEnvelope: "legacy-ok-data",
    missingAuthorizationStatus: 401,
    insufficientRoleStatus: 403,
    invalidRequestStatus: 400,
    wrongMethodStatus: 405,
  },
  moderateUpgradeRequestV1: {
    method: "POST",
    authorization: "supabase-bearer",
    acceptedStatus: 200,
    successEnvelope: "legacy-ok-data",
    missingAuthorizationStatus: 401,
    insufficientRoleStatus: 403,
    invalidRequestStatus: 400,
    wrongMethodStatus: 405,
  },
  taxAuthorityCallback: {
    method: "POST",
    authorization: "callback-oidc-or-shared-token",
    acceptedStatus: 200,
    successEnvelope: "legacy-ok-data",
    missingAuthorizationStatus: 401,
    invalidRequestStatus: 400,
    wrongMethodStatus: 405,
  },
} as const satisfies Record<
  keyof typeof LEGACY_DIRECT_OPERATION_SLUGS | "taxAuthorityCallback",
  LegacyHttpExpectation
>;

type LegacyFixturePayload = Readonly<Record<string, unknown>>;

export interface LegacyClientContractDivergence {
  client: "phone_app" | "website";
  observedPayload: LegacyFixturePayload;
  reason: string;
}

export interface LegacyMutationCharacterizationFixture {
  operation: LegacyMutationOperation;
  functionSlug: (typeof LEGACY_GATEWAY_FUNCTION_SLUGS)["mutation" | "taxMutation"];
  request: Readonly<{
    operation: LegacyMutationOperation;
    payload: LegacyFixturePayload;
  }>;
  /** `clearPushTokenV1` intentionally ignores its payload; every other fixture is representative. */
  payloadContract: "representative" | "ignored";
  evidence: readonly string[];
  knownClientDivergences?: readonly LegacyClientContractDivergence[];
}

export interface LegacyReadCharacterizationFixture {
  kind: LegacyReadKind;
  functionSlug: (typeof LEGACY_GATEWAY_FUNCTION_SLUGS)["read"];
  request: Readonly<{ kind: LegacyReadKind } & LegacyFixturePayload>;
  /** `userSyncState` has no request input beyond the authenticated user and kind. */
  requestContract: "representative" | "kind-only";
  evidence: readonly string[];
}

export interface LegacyDirectFunctionCharacterizationFixture {
  operation: keyof typeof LEGACY_DIRECT_OPERATION_SLUGS | "taxAuthorityCallback";
  functionSlug: (typeof LEGACY_DIRECT_FUNCTION_SLUGS)[number];
  request: LegacyFixturePayload;
  headers?: Readonly<Record<string, string>>;
  evidence: readonly string[];
}

const FIXTURE_COMPANY_ID = "1001";
const FIXTURE_USER_ID = "9b3792bb-8f01-46d8-9817-f552f91e7faa";
const FIXTURE_WORKER_ID = "c7cce4ad-6158-4fd0-a166-e071cc565b71";
const FIXTURE_RECORD_ID = "2ed948f8-e47e-413d-9f1f-792cba30897d";
const FIXTURE_CURSOR_ID = "fd4f98d6-4f1c-43f9-b9e5-f4f52e1a7c8d";

/**
 * Accepted, representative handler payloads for every current gateway operation.
 * Known client/handler mismatches are recorded explicitly instead of being copied
 * into the accepted request and silently treated as supported behavior.
 */
export const LEGACY_MUTATION_CHARACTERIZATION_FIXTURES = [
  {
    operation: "manageWorker",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: {
      operation: "manageWorker",
      payload: {
        action: "edit",
        companyId: FIXTURE_COMPANY_ID,
        workerUid: FIXTURE_WORKER_ID,
        name: "Field Technician",
        phoneNumber: "+972501234567",
        role: "worker",
      },
    },
    payloadContract: "representative",
    evidence: ["supabase/handlers/auth.ts", "website/src/lib/services/backend-service.ts"],
    knownClientDivergences: [{
      client: "phone_app",
      observedPayload: {
        action: "add",
        companyId: FIXTURE_COMPANY_ID,
        email: "technician@example.com",
        name: "Field Technician",
        phoneNumber: "+972501234567",
      },
      reason: "The mobile add flow omits workerUid, which the current handler requires before dispatching any action.",
    }],
  },
  {
    operation: "registerBusinessV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: {
      operation: "registerBusinessV1",
      payload: {
        role: "manager",
        accountType: "business",
        name: "Dana Manager",
        phoneNumber: "+972501112233",
        he_name: "Smart Job Services",
        en_name: "Smart Job Services",
        vat_number: "515123456",
        business_type: "field-service",
        city: "Tel Aviv",
        address: "10 Service Street",
        business_email: "office@example.com",
        business_phone: "+97235551234",
      },
    },
    payloadContract: "representative",
    evidence: ["supabase/handlers/auth.ts", "website/src/app/onboarding/page-client.tsx"],
  },
  {
    operation: "createJobV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: {
      operation: "createJobV1",
      payload: {
        companyId: FIXTURE_COMPANY_ID,
        type: "pending",
        title: "Replace compressor contactor",
        description: "Diagnose the failed contactor and replace it.",
        notes: "Call before arrival.",
        location: "Mechanical room",
        address: "12 Workshop Road",
        category: "repair",
        priority: "high",
        dueAt: "2026-07-14T08:00:00.000Z",
        cid: 17,
        wid: 4,
        partsUsed: [{ id: 12, name: "Contactor", quantity: 1 }],
        idempotencyKey: "job-create-fixture-001",
      },
    },
    payloadContract: "representative",
    evidence: ["supabase/handlers/jobs.ts", "website/src/lib/services/backend-service.ts", "phone_app/modules/jobs/screens/CreateJob.tsx"],
  },
  {
    operation: "updateJobV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: {
      operation: "updateJobV1",
      payload: {
        companyId: FIXTURE_COMPANY_ID,
        jobId: "42",
        title: "Replace compressor contactor",
        status: "waiting",
        priority: "high",
        dueAt: "2026-07-14T10:00:00.000Z",
        partsUsed: [{ id: 12, name: "Contactor", quantity: 1 }],
      },
    },
    payloadContract: "representative",
    evidence: ["supabase/handlers/jobs.ts", "phone_app/modules/jobs/screens/EditJob.tsx"],
  },
  {
    operation: "deleteJobV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: { operation: "deleteJobV1", payload: { companyId: FIXTURE_COMPANY_ID, jobId: "42" } },
    payloadContract: "representative",
    evidence: ["supabase/handlers/jobs.ts", "website/src/lib/services/backend-service.ts"],
  },
  {
    operation: "acceptJobV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: { operation: "acceptJobV1", payload: { companyId: FIXTURE_COMPANY_ID, jobId: "42" } },
    payloadContract: "representative",
    evidence: ["supabase/handlers/jobs.ts", "phone_app/modules/jobs/screens/ManageJobs.tsx"],
  },
  {
    operation: "createJobFileDownloadUrlV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: {
      operation: "createJobFileDownloadUrlV1",
      payload: {
        companyId: FIXTURE_COMPANY_ID,
        jobId: "42",
        storagePath: "companies/1001/jobs/42/photo-1.jpg",
        expirySeconds: 900,
      },
    },
    payloadContract: "representative",
    evidence: ["supabase/handlers/jobs.ts", "phone_app/modules/jobs/lib/job-file-utils.ts"],
  },
  {
    operation: "updateInventoryV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: {
      operation: "updateInventoryV1",
      payload: {
        companyId: FIXTURE_COMPANY_ID,
        action: "pickParts",
        scope: "company",
        targetUid: FIXTURE_WORKER_ID,
        partsToPick: [{ id: 12, name: "Contactor", quantity: 2 }],
      },
    },
    payloadContract: "representative",
    evidence: ["supabase/handlers/inventory.ts", "website/src/lib/services/backend-service.ts"],
  },
  {
    operation: "addClientV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: {
      operation: "addClientV1",
      payload: {
        companyId: FIXTURE_COMPANY_ID,
        name: "Northwind Cooling",
        phone: "+97235550101",
        email: "dispatch@northwind.example",
        address: "20 Industrial Way",
        city: "Haifa",
        vatNumber: "515987654",
        notes: "Commercial maintenance customer",
      },
    },
    payloadContract: "representative",
    evidence: ["supabase/handlers/clients.ts", "phone_app/contexts/use-cache-client-actions.ts"],
  },
  {
    operation: "deleteClientV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: { operation: "deleteClientV1", payload: { companyId: FIXTURE_COMPANY_ID, clientId: FIXTURE_RECORD_ID } },
    payloadContract: "representative",
    evidence: ["supabase/handlers/clients.ts", "website/src/lib/services/backend-service.ts"],
  },
  {
    operation: "updateClientV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: {
      operation: "updateClientV1",
      payload: {
        companyId: FIXTURE_COMPANY_ID,
        clientId: FIXTURE_RECORD_ID,
        name: "Northwind Cooling Ltd.",
        phone: "+97235550102",
        status: "active",
      },
    },
    payloadContract: "representative",
    evidence: ["supabase/handlers/clients.ts", "phone_app/contexts/use-cache-client-actions.ts"],
  },
  {
    operation: "publishPreviewTask",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: {
      operation: "publishPreviewTask",
      payload: {
        companyId: FIXTURE_COMPANY_ID,
        documentType: 10,
        language: "he",
        documentData: {
          client: { name: "Northwind Cooling", phone: "+97235550101" },
          items: [{ description: "Quarterly maintenance", quantity: 1, price: 850 }],
          date: "2026-07-13",
        },
      },
    },
    payloadContract: "representative",
    evidence: ["supabase/handlers/documents.ts", "phone_app/hooks/useDocumentTask.ts"],
  },
  {
    operation: "publishGenerateTask",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: {
      operation: "publishGenerateTask",
      payload: {
        companyId: FIXTURE_COMPANY_ID,
        documentType: 200,
        language: "he",
        idempotencyKey: "document-generate-fixture-001",
        documentData: {
          client: { name: "Northwind Cooling", phone: "+97235550101" },
          items: [{ description: "Replacement contactor", quantity: 1, price: 350 }],
          date: "2026-07-13",
        },
      },
    },
    payloadContract: "representative",
    evidence: ["supabase/handlers/documents.ts", "phone_app/hooks/useDocumentTask.ts"],
  },
  {
    operation: "deleteDocumentV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: { operation: "deleteDocumentV1", payload: { companyId: FIXTURE_COMPANY_ID, documentId: "200-17-1001" } },
    payloadContract: "representative",
    evidence: ["supabase/handlers/documents.ts", "phone_app/modules/documents/screens/DocumentHistory.tsx"],
  },
  {
    operation: "createDocumentDownloadUrlV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: {
      operation: "createDocumentDownloadUrlV1",
      payload: { companyId: FIXTURE_COMPANY_ID, documentId: "200-17-1001", expirySeconds: 900 },
    },
    payloadContract: "representative",
    evidence: ["supabase/handlers/documents.ts", "phone_app/modules/documents/lib/document-download.ts"],
  },
  {
    operation: "fetchArchiveMonthV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: {
      operation: "fetchArchiveMonthV1",
      payload: { companyId: FIXTURE_COMPANY_ID, year: 2026, month: 6, dataType: "finishedJobs" },
    },
    payloadContract: "representative",
    evidence: ["supabase/handlers/documents.ts", "phone_app/hooks/useArchiveQuery.ts"],
  },
  {
    operation: "updateProfileV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: {
      operation: "updateProfileV1",
      payload: { companyId: FIXTURE_COMPANY_ID, displayName: "Dana Manager", phoneNumber: "+972501112233" },
    },
    payloadContract: "representative",
    evidence: ["supabase/handlers/profile.ts", "website/src/lib/services/backend-service.ts"],
    knownClientDivergences: [{
      client: "website",
      observedPayload: { name: "Dana Manager", phoneNumber: "+972501112233" },
      reason: "The website helper sends name, while the handler recognizes displayName.",
    }],
  },
  {
    operation: "updatePushTokenV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: {
      operation: "updatePushTokenV1",
      payload: { token: "fcm-token-fixture-123456789", platform: "android" },
    },
    payloadContract: "representative",
    evidence: ["supabase/handlers/profile.ts", "phone_app/utils/notifications.ts"],
    knownClientDivergences: [{
      client: "phone_app",
      observedPayload: {
        pushToken: "fcm-token-fixture-123456789",
        pushTokenPlatform: "android",
        pushTokenType: "fcm",
      },
      reason: "The mobile helper sends Firebase-style aliases, while the handler requires token and reads platform.",
    }],
  },
  {
    operation: "clearPushTokenV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: { operation: "clearPushTokenV1", payload: {} },
    payloadContract: "ignored",
    evidence: ["supabase/handlers/profile.ts", "phone_app/modules/settings/screens/Settings.tsx"],
  },
  {
    operation: "updateBusinessInfoV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: {
      operation: "updateBusinessInfoV1",
      payload: {
        companyId: FIXTURE_COMPANY_ID,
        he_name: "Smart Job Services",
        en_name: "Smart Job Services",
        business_type: "field-service",
        city: "Tel Aviv",
        address: "10 Service Street",
        business_email: "office@example.com",
        business_phone: "+97235551234",
      },
    },
    payloadContract: "representative",
    evidence: ["supabase/handlers/profile.ts"],
  },
  {
    operation: "updateCacheV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: {
      operation: "updateCacheV1",
      payload: { companyId: FIXTURE_COMPANY_ID, field: "jobs" },
    },
    payloadContract: "representative",
    evidence: ["supabase/handlers/profile.ts", "phone_app/contexts/use-cache-version-actions.ts"],
    knownClientDivergences: [{
      client: "phone_app",
      observedPayload: { field: "jobs", isCompanyCache: false },
      reason: "The mobile version helper omits companyId, which the SQL-backed handler requires.",
    }],
  },
  {
    operation: "createSupportConversationV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: { operation: "createSupportConversationV1", payload: { category: "support" } },
    payloadContract: "representative",
    evidence: ["supabase/handlers/support.ts", "phone_app/modules/support/lib/support-api.ts"],
  },
  {
    operation: "appendSupportMessageV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: {
      operation: "appendSupportMessageV1",
      payload: { conversationId: "support-conversation-123", text: "The assigned job is not visible on my device." },
    },
    payloadContract: "representative",
    evidence: ["supabase/handlers/support.ts", "phone_app/modules/support/lib/support-api.ts"],
  },
  {
    operation: "markSupportConversationReadV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: {
      operation: "markSupportConversationReadV1",
      payload: { conversationId: "support-conversation-123" },
    },
    payloadContract: "representative",
    evidence: ["supabase/handlers/support.ts", "phone_app/modules/support/lib/support-api.ts"],
  },
  {
    operation: "closeSupportConversationV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: {
      operation: "closeSupportConversationV1",
      payload: { conversationId: "support-conversation-123" },
    },
    payloadContract: "representative",
    evidence: ["supabase/handlers/support.ts", "phone_app/modules/support/lib/support-api.ts"],
  },
  {
    operation: "listSupportConversationsV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: { operation: "listSupportConversationsV1", payload: { status: "open", limit: 50 } },
    payloadContract: "representative",
    evidence: ["supabase/handlers/support.ts", "phone_app/modules/support/lib/support-api.ts"],
  },
  {
    operation: "getSupportConversationThreadV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: {
      operation: "getSupportConversationThreadV1",
      payload: { conversationId: "support-conversation-123" },
    },
    payloadContract: "representative",
    evidence: ["supabase/handlers/support.ts", "phone_app/modules/support/lib/support-api.ts"],
  },
  {
    operation: "requestUpgradeV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: {
      operation: "requestUpgradeV1",
      payload: {
        companyId: FIXTURE_COMPANY_ID,
        currentTier: "Basic",
        requestedTier: "Team",
        message: "We need worker dispatch and shared company inventory.",
      },
    },
    payloadContract: "representative",
    evidence: ["supabase/handlers/misc.ts", "website/src/app/app/upgrade/page-client.tsx"],
  },
  {
    operation: "listUpgradeRequestsV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: { operation: "listUpgradeRequestsV1", payload: { limit: 50 } },
    payloadContract: "representative",
    evidence: ["supabase/handlers/misc.ts", "website/src/app/app/admin/page-client.tsx"],
  },
  {
    operation: "moderateUpgradeRequestV1",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.mutation,
    request: {
      operation: "moderateUpgradeRequestV1",
      payload: {
        requestId: "upgrade-request-123",
        status: "approved",
        moderationNote: "Team workflow confirmed.",
      },
    },
    payloadContract: "representative",
    evidence: ["supabase/handlers/misc.ts", "website/src/app/app/admin/page-client.tsx"],
  },
  {
    operation: "getInvoiceApproval",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.taxMutation,
    request: {
      operation: "getInvoiceApproval",
      payload: {
        companyId: FIXTURE_COMPANY_ID,
        idempotencyKey: "tax-invoice-fixture-001",
        language: "he",
        date: "2026-07-13",
        notes: "Payment due in 30 days.",
        client: {
          name: "Northwind Cooling",
          phone: "+97235550101",
          city: "Haifa",
          clientVatNumber: "515987654",
        },
        items: [{ description: "Quarterly maintenance", quantity: 1, price: 850 }],
        jobsData: [{ jobId: "42" }],
      },
    },
    payloadContract: "representative",
    evidence: ["supabase/handlers/tax.ts", "phone_app/modules/documents/hooks/useTaxInvoiceSubmission.ts"],
  },
] as const satisfies readonly LegacyMutationCharacterizationFixture[];

/** Representative requests for every current kind, including SQL-side filters. */
export const LEGACY_READ_CHARACTERIZATION_FIXTURES = [
  {
    kind: "bootstrap",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.read,
    request: { kind: "bootstrap", companyId: FIXTURE_COMPANY_ID, includeCollections: false, countOnly: true },
    requestContract: "representative",
    evidence: ["supabase/functions/read-model/index.ts", "website/src/lib/services/backend-service.ts"],
  },
  {
    kind: "workers",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.read,
    request: { kind: "workers", companyId: FIXTURE_COMPANY_ID },
    requestContract: "representative",
    evidence: ["supabase/functions/read-model/index.ts", "phone_app/utils/read-model.ts"],
  },
  {
    kind: "clients",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.read,
    request: {
      kind: "clients",
      companyId: FIXTURE_COMPANY_ID,
      pageSize: 50,
      afterCursor: `17|${FIXTURE_CURSOR_ID}`,
      search: "Northwind",
    },
    requestContract: "representative",
    evidence: ["supabase/functions/read-model/index.ts", "website/src/lib/services/backend-service.ts"],
  },
  {
    kind: "jobs",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.read,
    request: {
      kind: "jobs",
      companyId: FIXTURE_COMPANY_ID,
      pageSize: 50,
      afterCursor: `2026-07-13T10:00:00.000Z|${FIXTURE_CURSOR_ID}`,
      status: ["pending", "waiting"],
      dateField: "createdAt",
      dateFrom: "2026-07-01T00:00:00.000Z",
      dateTo: "2026-07-31T23:59:59.999Z",
    },
    requestContract: "representative",
    evidence: ["supabase/functions/read-model/index.ts", "phone_app/utils/read-model.ts"],
  },
  {
    kind: "documents",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.read,
    request: {
      kind: "documents",
      companyId: FIXTURE_COMPANY_ID,
      pageSize: 50,
      afterCursor: `2026-07-13T10:00:00.000Z|${FIXTURE_CURSOR_ID}`,
      status: ["pending", "completed"],
      documentType: 305,
      createdByUid: FIXTURE_USER_ID,
      dateField: "documentDate",
      dateFrom: "2026-07-01T00:00:00.000Z",
      dateTo: "2026-07-31T23:59:59.999Z",
    },
    requestContract: "representative",
    evidence: ["supabase/functions/read-model/index.ts", "phone_app/utils/read-model.ts"],
  },
  {
    kind: "inventory",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.read,
    request: {
      kind: "inventory",
      companyId: FIXTURE_COMPANY_ID,
      scope: "user",
      targetUid: FIXTURE_WORKER_ID,
      pageSize: 50,
      afterCursor: `12|${FIXTURE_CURSOR_ID}`,
      search: "Contactor",
    },
    requestContract: "representative",
    evidence: ["supabase/functions/read-model/index.ts", "phone_app/utils/read-model.ts"],
  },
  {
    kind: "companySyncState",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.read,
    request: { kind: "companySyncState", companyId: FIXTURE_COMPANY_ID },
    requestContract: "representative",
    evidence: ["supabase/functions/read-model/index.ts", "phone_app/contexts/cache-fetchers.ts"],
  },
  {
    kind: "recordById",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.read,
    request: { kind: "recordById", companyId: FIXTURE_COMPANY_ID, recordId: FIXTURE_RECORD_ID },
    requestContract: "representative",
    evidence: ["supabase/functions/read-model/index.ts", "phone_app/utils/read-model.ts"],
  },
  {
    kind: "documentTask",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.read,
    request: { kind: "documentTask", companyId: FIXTURE_COMPANY_ID, taskId: "document-task-fixture-123" },
    requestContract: "representative",
    evidence: ["supabase/functions/read-model/index.ts", "phone_app/hooks/useDocumentTask.ts"],
  },
  {
    kind: "userSyncState",
    functionSlug: LEGACY_GATEWAY_FUNCTION_SLUGS.read,
    request: { kind: "userSyncState" },
    requestContract: "kind-only",
    evidence: ["supabase/functions/read-model/index.ts", "phone_app/contexts/cache-fetchers.ts"],
  },
] as const satisfies readonly LegacyReadCharacterizationFixture[];

/** Exact top-level bodies expected by functions that bypass the gateways. */
export const LEGACY_DIRECT_FUNCTION_CHARACTERIZATION_FIXTURES = [
  {
    operation: "contactRequestV1",
    functionSlug: LEGACY_DIRECT_OPERATION_SLUGS.contactRequestV1,
    request: {
      name: "Dana Manager",
      email: "dana@example.com",
      phone: "+972501112233",
      subject: "Smart-Job product question",
      company: "Smart Job Services",
      message: "Please contact me about the Team workflow.",
      fromApp: false,
    },
    evidence: ["supabase/functions/contact/request/index.ts", "website/src/app/api/contact/request/route.ts"],
  },
  {
    operation: "createInviteV1",
    functionSlug: LEGACY_DIRECT_OPERATION_SLUGS.createInviteV1,
    request: {
      companyId: FIXTURE_COMPANY_ID,
      targetRole: "worker",
      targetEmail: "technician@example.com",
      expiresInDays: 30,
    },
    evidence: ["supabase/functions/invites/create/index.ts", "website/src/app/app/workers/page-client.tsx"],
  },
  {
    operation: "joinCompanyV1",
    functionSlug: LEGACY_DIRECT_OPERATION_SLUGS.joinCompanyV1,
    request: {
      inviteCode: "SJ-TEAM-2026",
      displayName: "Field Technician",
      phoneNumber: "+972501234567",
    },
    evidence: ["supabase/functions/invites/join/index.ts", "website/src/app/onboarding/page-client.tsx"],
  },
  {
    operation: "requestUpgradeV1",
    functionSlug: LEGACY_DIRECT_OPERATION_SLUGS.requestUpgradeV1,
    request: {
      currentTier: "Basic",
      requestedTier: "Team",
      message: "We need worker dispatch and shared company inventory.",
    },
    evidence: ["supabase/functions/upgrades/request/index.ts", "website/src/app/app/upgrade/page-client.tsx"],
  },
  {
    operation: "listUpgradeRequestsV1",
    functionSlug: LEGACY_DIRECT_OPERATION_SLUGS.listUpgradeRequestsV1,
    request: { limit: 50 },
    evidence: ["supabase/functions/upgrades/list/index.ts", "website/src/app/app/admin/page-client.tsx"],
  },
  {
    operation: "moderateUpgradeRequestV1",
    functionSlug: LEGACY_DIRECT_OPERATION_SLUGS.moderateUpgradeRequestV1,
    request: {
      requestId: "upgrade-request-123",
      status: "approved",
      moderationNote: "Team workflow confirmed.",
    },
    evidence: ["supabase/functions/upgrades/moderate/index.ts", "website/src/app/app/admin/page-client.tsx"],
  },
  {
    operation: "taxAuthorityCallback",
    functionSlug: "tax-callback",
    request: {
      message: {
        data: "eyJvYXV0aFNlc3Npb25JZCI6Im9hdXRoLXNlc3Npb24tMTIzIiwic3RhdHVzIjoiYXBwcm92ZWQiLCJjb25maXJtYXRpb25OdW1iZXIiOiJ0YXgtY29uZmlybWF0aW9uLTEyMyJ9",
      },
    },
    headers: { "x-pubsub-token": "fixture-shared-token" },
    evidence: ["supabase/functions/tax/callback/index.ts"],
  },
] as const satisfies readonly LegacyDirectFunctionCharacterizationFixture[];

export const LEGACY_EDGE_CONTRACT_CATALOG = Object.freeze({
  defaultMutationOperations: LEGACY_DEFAULT_MUTATION_OPERATIONS,
  taxMutationOperations: LEGACY_TAX_MUTATION_OPERATIONS,
  readKinds: LEGACY_READ_KINDS,
  deployedFunctionSlugs: LEGACY_DEPLOYED_FUNCTION_SLUGS,
  directFunctionSlugs: LEGACY_DIRECT_FUNCTION_SLUGS,
});
