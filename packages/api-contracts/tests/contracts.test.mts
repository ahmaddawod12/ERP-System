import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AccountTypeSchema,
  ApiErrorSchema,
  BootstrapCountsSchema,
  BusinessRegistrationRequestSchema,
  BusinessRegistrationResultSchema,
  BusinessProfileSchema,
  BusinessProfileUpdateRequestSchema,
  ClientCreateRequestSchema,
  ClientDeleteRequestSchema,
  ClientDeleteResultSchema,
  ClientListPageSchema,
  ClientListQuerySchema,
  ClientSummarySchema,
  ClientUpdateRequestSchema,
  CompanyBootstrapSchema,
  CompanySyncStateSchema,
  ContactRequestCreateRequestSchema,
  ContactRequestCreatedResultSchema,
  CursorPageSchema,
  DocTypeSchema,
  DocumentDownloadAccessSchema,
  DocumentDeleteRequestSchema,
  DocumentDeleteResultSchema,
  DocumentGenerateRequestSchema,
  DocumentListPageSchema,
  DocumentListQuerySchema,
  DocumentPreviewRequestSchema,
  DocumentSummarySchema,
  DocumentTaskAcceptedSchema,
  DocumentTaskSchema,
  EntityVersionSchema,
  JobListPageSchema,
  JobListQuerySchema,
  JobSummarySchema,
  JobStatusSchema,
  JobAcceptRequestSchema,
  JobAcceptResultSchema,
  JobCreateRequestSchema,
  JobCreateResultSchema,
  JobDeleteRequestSchema,
  JobDeleteResultSchema,
  JobAttachmentUploadSessionRequestSchema,
  JobCompletionResultSchema,
  JobUpdateRequestSchema,
  JobUpdateResultSchema,
  InventoryListPageSchema,
  InventoryListQuerySchema,
  InventoryAdjustmentRequestSchema,
  InventoryPartArchiveRequestSchema,
  InventoryPartCreateRequestSchema,
  InventoryPartUpdateRequestSchema,
  InventoryPickRequestSchema,
  InventoryPartSummarySchema,
  InventoryTransferRequestSchema,
  InvitationCreateRequestSchema,
  InvitationCreateResultSchema,
  InvitationRedeemRequestSchema,
  InvitationRedemptionResultSchema,
  PushTokenClearResultSchema,
  PushTokenClearRequestSchema,
  PushTokenUpsertRequestSchema,
  PushTokenUpsertResultSchema,
  RoleSchema,
  SupportConversationCreateRequestSchema,
  SupportConversationSummarySchema,
  SupportMessageCreateRequestSchema,
  SupportMessageSchema,
  UpgradeRequestCreateRequestSchema,
  UpgradeRequestListPageSchema,
  UpgradeRequestModerationRequestSchema,
  UpgradeRequestSummarySchema,
  ViewerSchema,
  ViewerProfileUpdateRequestSchema,
  WebSessionCreateRequestSchema,
  WorkerListPageSchema,
  WorkerListQuerySchema,
  WorkerDisableRequestSchema,
  WorkerSummarySchema,
  WorkerUpdateRequestSchema,
  WebSessionCreatedSchema,
  WebSessionCurrentSchema,
  WebSessionRevokedSchema,
  WorkspaceSummarySchema,
  createApiResponseSchema,
} from "../dist/index.js";
import {
  LEGACY_DEFAULT_MUTATION_OPERATIONS,
  LEGACY_DEPLOYED_FUNCTION_SLUGS,
  LEGACY_DIRECT_HTTP_EXPECTATIONS,
  LEGACY_DIRECT_FUNCTION_CHARACTERIZATION_FIXTURES,
  LEGACY_DIRECT_FUNCTION_SLUGS,
  LEGACY_MUTATION_CHARACTERIZATION_FIXTURES,
  LEGACY_MUTATION_GATEWAY_EXPECTATION,
  LEGACY_MUTATION_OPERATIONS,
  LEGACY_READ_CHARACTERIZATION_FIXTURES,
  LEGACY_READ_GATEWAY_EXPECTATION,
  LEGACY_READ_KINDS,
} from "../dist/legacy-edge-contract.js";

const SESSION_TOKEN = "A".repeat(43);
const CSRF_TOKEN = "B".repeat(43);

const EXPECTED_DEFAULT_MUTATIONS = [
  "acceptJobV1",
  "addClientV1",
  "appendSupportMessageV1",
  "clearPushTokenV1",
  "closeSupportConversationV1",
  "createDocumentDownloadUrlV1",
  "createJobFileDownloadUrlV1",
  "createJobV1",
  "createSupportConversationV1",
  "deleteClientV1",
  "deleteDocumentV1",
  "deleteJobV1",
  "fetchArchiveMonthV1",
  "getSupportConversationThreadV1",
  "listSupportConversationsV1",
  "listUpgradeRequestsV1",
  "manageWorker",
  "markSupportConversationReadV1",
  "moderateUpgradeRequestV1",
  "publishGenerateTask",
  "publishPreviewTask",
  "registerBusinessV1",
  "requestUpgradeV1",
  "updateBusinessInfoV1",
  "updateCacheV1",
  "updateClientV1",
  "updateInventoryV1",
  "updateJobV1",
  "updateProfileV1",
  "updatePushTokenV1",
] as const;

const EXPECTED_READ_KINDS = [
  "bootstrap",
  "clients",
  "companySyncState",
  "documents",
  "documentTask",
  "inventory",
  "jobs",
  "recordById",
  "userSyncState",
  "workers",
] as const;

const EXPECTED_DEPLOYED_SLUGS = [
  "contact-request",
  "invites-create",
  "invites-join",
  "mutation-gateway",
  "mutation-gateway-me-west1",
  "read-model",
  "tax-callback",
  "upgrades-list",
  "upgrades-moderate",
  "upgrades-request",
] as const;

const EXPECTED_DIRECT_SLUGS = [
  "contact-request",
  "invites-create",
  "invites-join",
  "tax-callback",
  "upgrades-list",
  "upgrades-moderate",
  "upgrades-request",
] as const;

const EXPECTED_DIRECT_OPERATIONS = [
  "contactRequestV1",
  "createInviteV1",
  "joinCompanyV1",
  "listUpgradeRequestsV1",
  "moderateUpgradeRequestV1",
  "requestUpgradeV1",
  "taxAuthorityCallback",
] as const;

function sorted(values: readonly string[]) {
  return [...values].sort();
}

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function readRepositoryFile(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function extractObjectKeys(source: string, declarationName: string) {
  const declaration = source.indexOf(`const ${declarationName}`);
  assert.notEqual(declaration, -1, `missing ${declarationName} declaration`);
  const objectStart = source.indexOf("{", declaration);
  const objectEnd = source.indexOf("};", objectStart);
  assert.notEqual(objectStart, -1, `missing ${declarationName} object start`);
  assert.notEqual(objectEnd, -1, `missing ${declarationName} object end`);
  return [...source.slice(objectStart + 1, objectEnd).matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):/gm)]
    .map((match) => match[1] as string);
}

function extractQuotedArray(source: string, declarationStart: string) {
  const declaration = source.indexOf(declarationStart);
  assert.notEqual(declaration, -1, `missing ${declarationStart} declaration`);
  const arrayStart = source.indexOf("[", declaration);
  const arrayEnd = source.indexOf("]", arrayStart);
  assert.notEqual(arrayStart, -1, `missing ${declarationStart} array start`);
  assert.notEqual(arrayEnd, -1, `missing ${declarationStart} array end`);
  return [...source.slice(arrayStart + 1, arrayEnd).matchAll(/["']([^"']+)["']/g)]
    .map((match) => match[1] as string);
}

function extractShellArray(source: string, declarationStart: string) {
  const declaration = source.indexOf(declarationStart);
  assert.notEqual(declaration, -1, `missing ${declarationStart} declaration`);
  const arrayEnd = source.indexOf(")", declaration);
  assert.notEqual(arrayEnd, -1, `missing ${declarationStart} array end`);
  return [...source.slice(declaration + declarationStart.length, arrayEnd)
    .matchAll(/^\s+([a-z][a-z0-9-]+)\s*$/gm)]
    .map((match) => match[1] as string);
}

test("characterization catalog contains exactly 30 default and one tax mutation", () => {
  assert.equal(LEGACY_DEFAULT_MUTATION_OPERATIONS.length, 30);
  assert.deepEqual(sorted(LEGACY_DEFAULT_MUTATION_OPERATIONS), sorted(EXPECTED_DEFAULT_MUTATIONS));
  assert.equal(LEGACY_MUTATION_OPERATIONS.length, 31);
  assert.deepEqual(
    sorted(LEGACY_MUTATION_OPERATIONS),
    sorted([...EXPECTED_DEFAULT_MUTATIONS, "getInvoiceApproval"]),
  );
  assert.deepEqual(
    sorted(LEGACY_MUTATION_CHARACTERIZATION_FIXTURES.map(({ operation }) => operation)),
    sorted(LEGACY_MUTATION_OPERATIONS),
  );
});

test("characterization catalog contains exactly all ten read kinds", () => {
  assert.equal(LEGACY_READ_KINDS.length, 10);
  assert.deepEqual(sorted(LEGACY_READ_KINDS), sorted(EXPECTED_READ_KINDS));
  assert.deepEqual(
    sorted(LEGACY_READ_CHARACTERIZATION_FIXTURES.map(({ kind }) => kind)),
    sorted(EXPECTED_READ_KINDS),
  );
});

test("characterization catalog contains exact deployed and direct slugs", () => {
  assert.deepEqual(sorted(LEGACY_DEPLOYED_FUNCTION_SLUGS), sorted(EXPECTED_DEPLOYED_SLUGS));
  assert.deepEqual(sorted(LEGACY_DIRECT_FUNCTION_SLUGS), sorted(EXPECTED_DIRECT_SLUGS));
  assert.deepEqual(
    sorted(LEGACY_DIRECT_FUNCTION_CHARACTERIZATION_FIXTURES.map(({ functionSlug }) => functionSlug)),
    sorted(EXPECTED_DIRECT_SLUGS),
  );
  assert.deepEqual(
    sorted(LEGACY_DIRECT_FUNCTION_CHARACTERIZATION_FIXTURES.map(({ operation }) => operation)),
    sorted(EXPECTED_DIRECT_OPERATIONS),
  );
});

test("mutation fixtures contain characterized payloads rather than generated empty placeholders", () => {
  for (const fixture of LEGACY_MUTATION_CHARACTERIZATION_FIXTURES) {
    assert.equal(fixture.request.operation, fixture.operation);
    assert.ok(fixture.evidence.length > 0, `${fixture.operation} must identify its characterization evidence`);

    const payloadKeys = Object.keys(fixture.request.payload);
    if (payloadKeys.length === 0) {
      assert.equal(fixture.operation, "clearPushTokenV1");
      assert.equal(fixture.payloadContract, "ignored");
    } else {
      assert.equal(fixture.payloadContract, "representative", `${fixture.operation} payload is not characterized`);
    }

    for (const divergence of fixture.knownClientDivergences ?? []) {
      assert.ok(Object.keys(divergence.observedPayload).length > 0);
      assert.ok(divergence.reason.trim().length > 0);
    }
  }
});

test("read fixtures characterize scope, pagination, and filters when the kind accepts them", () => {
  for (const fixture of LEGACY_READ_CHARACTERIZATION_FIXTURES) {
    assert.equal(fixture.request.kind, fixture.kind);
    assert.ok(fixture.evidence.length > 0, `${fixture.kind} must identify its characterization evidence`);

    const inputKeys = Object.keys(fixture.request).filter((key) => key !== "kind");
    if (inputKeys.length === 0) {
      assert.equal(fixture.kind, "userSyncState");
      assert.equal(fixture.requestContract, "kind-only");
    } else {
      assert.equal(fixture.requestContract, "representative", `${fixture.kind} request is not characterized`);
    }
  }

  const jobs = LEGACY_READ_CHARACTERIZATION_FIXTURES.find(({ kind }) => kind === "jobs");
  assert.deepEqual(jobs?.request.status, ["pending", "waiting"]);
  assert.match(String(jobs?.request.afterCursor), /^\d{4}-\d{2}-\d{2}T.*\|[0-9a-f-]{36}$/u);

  const documents = LEGACY_READ_CHARACTERIZATION_FIXTURES.find(({ kind }) => kind === "documents");
  assert.equal(documents?.request.documentType, 305);
  assert.ok(documents?.request.createdByUid);

  const clients = LEGACY_READ_CHARACTERIZATION_FIXTURES.find(({ kind }) => kind === "clients");
  assert.match(String(clients?.request.afterCursor), /^\d+\|[0-9a-f-]{36}$/u);
  assert.equal(clients?.request.search, "Northwind");
});

test("direct-function fixtures contain exact top-level endpoint bodies", () => {
  for (const fixture of LEGACY_DIRECT_FUNCTION_CHARACTERIZATION_FIXTURES) {
    assert.ok(Object.keys(fixture.request).length > 0, `${fixture.operation} must have a representative body`);
    assert.ok(fixture.evidence.length > 0, `${fixture.operation} must identify its characterization evidence`);
  }

  const callback = LEGACY_DIRECT_FUNCTION_CHARACTERIZATION_FIXTURES.find(
    ({ operation }) => operation === "taxAuthorityCallback",
  );
  assert.equal(callback?.headers?.["x-pubsub-token"], "fixture-shared-token");
  const message = callback?.request.message as { data?: string } | undefined;
  const decoded = JSON.parse(Buffer.from(String(message?.data), "base64").toString("utf8"));
  assert.deepEqual(decoded, {
    oauthSessionId: "oauth-session-123",
    status: "approved",
    confirmationNumber: "tax-confirmation-123",
  });
});

test("legacy surfaces record accepted, auth-failure, validation, and method outcomes", () => {
  assert.deepEqual(LEGACY_MUTATION_GATEWAY_EXPECTATION, {
    method: "POST",
    authorization: "supabase-bearer",
    acceptedStatus: 200,
    successEnvelope: "legacy-ok-data",
    missingAuthorizationStatus: 401,
    invalidRequestStatus: 400,
    wrongMethodStatus: 405,
  });
  assert.deepEqual(LEGACY_READ_GATEWAY_EXPECTATION, LEGACY_MUTATION_GATEWAY_EXPECTATION);
  assert.deepEqual(
    sorted(Object.keys(LEGACY_DIRECT_HTTP_EXPECTATIONS)),
    sorted(EXPECTED_DIRECT_OPERATIONS),
  );
  assert.equal(LEGACY_DIRECT_HTTP_EXPECTATIONS.contactRequestV1.authorization, "public-challenge");
  assert.equal(LEGACY_DIRECT_HTTP_EXPECTATIONS.requestUpgradeV1.acceptedStatus, 201);
  assert.equal(
    LEGACY_DIRECT_HTTP_EXPECTATIONS.taxAuthorityCallback.authorization,
    "callback-oidc-or-shared-token",
  );
  for (const expectation of Object.values(LEGACY_DIRECT_HTTP_EXPECTATIONS)) {
    assert.equal(expectation.invalidRequestStatus, 400);
    assert.equal(expectation.wrongMethodStatus, 405);
    assert.equal(expectation.successEnvelope, "legacy-ok-data");
  }
});

test("characterization catalog cannot drift from the checked-in Edge dispatchers", () => {
  const mutationGateway = readRepositoryFile("supabase/functions/mutation-gateway/index.ts");
  const taxGateway = readRepositoryFile("supabase/functions/mutation-gateway-me-west1/index.ts");
  const readModel = readRepositoryFile("supabase/functions/read-model/index.ts");
  const deployWorkflow = readRepositoryFile(".github/workflows/supabase-edge-deploy.yml");

  assert.deepEqual(
    sorted(extractObjectKeys(mutationGateway, "OPERATIONS")),
    sorted(LEGACY_DEFAULT_MUTATION_OPERATIONS),
  );
  assert.deepEqual(
    sorted(extractObjectKeys(taxGateway, "TAX_OPERATIONS")),
    ["getInvoiceApproval"],
  );
  assert.deepEqual(
    sorted(extractQuotedArray(readModel, "const READ_MODEL_KINDS")),
    sorted(LEGACY_READ_KINDS),
  );
  assert.deepEqual(
    sorted(extractShellArray(deployWorkflow, "FUNCTIONS=(")),
    sorted(LEGACY_DEPLOYED_FUNCTION_SLUGS),
  );
});

test("success and error response envelopes are runtime validated", () => {
  const schema = createApiResponseSchema(CursorPageSchema(WorkspaceSummarySchema));
  const success = schema.parse({
    ok: true,
    data: {
      items: [{
        companyId: 42,
        name: "Acme Field Service",
        accountType: "business",
        role: "manager",
        memberNo: 1,
        enabledModules: ["jobs", "inventory"],
      }],
      nextCursor: "opaque-cursor",
    },
    meta: { requestId: "req-123", nextCursor: "opaque-cursor" },
  });
  assert.equal(success.ok, true);

  const error = schema.parse({
    ok: false,
    error: {
      code: "stale-write",
      message: "The job changed before it could be completed",
      retryable: false,
      fieldErrors: { entityVersion: ["Reload the job and try again"] },
    },
    meta: { requestId: "req-124" },
  });
  assert.equal(error.ok, false);
  assert.equal(ApiErrorSchema.safeParse(error.error).success, true);
});

test("viewer and sync schemas reject internal identifiers and invalid counters", () => {
  const viewer = {
    uid: "9b3792bb-8f01-46d8-9817-f552f91e7faa",
    email: "manager@example.com",
    displayName: "Manager",
    emailVerified: true,
    workspaces: [{
      companyId: 42,
      name: "Acme",
      accountType: "business",
      role: "manager",
      memberNo: 1,
      enabledModules: ["jobs"],
    }],
  };
  assert.equal(ViewerSchema.safeParse(viewer).success, true);
  assert.equal(ViewerSchema.safeParse({ ...viewer, internalCompanyId: crypto.randomUUID() }).success, false);
  assert.equal(CompanySyncStateSchema.safeParse({
    jobsVersion: -1,
    documentsVersion: 0,
    clientsVersion: 0,
    workersVersion: 0,
    companyInventoryVersion: 0,
    updatedAt: "2026-07-13T12:00:00.000Z",
  }).success, false);

  const bootstrap = {
    workspace: viewer.workspaces[0],
    syncState: {
      jobsVersion: 1,
      documentsVersion: 2,
      clientsVersion: 3,
      workersVersion: 4,
      companyInventoryVersion: 5,
      updatedAt: "2026-07-13T12:00:00.000Z",
    },
    counts: {
      jobs: 6,
      clients: 7,
      inventoryParts: 8,
      documents: 9,
      pendingDocumentTasks: 1,
    },
  };
  assert.equal(CompanyBootstrapSchema.safeParse(bootstrap).success, true);
  assert.equal(BootstrapCountsSchema.safeParse({ ...bootstrap.counts, jobs: -1 }).success, false);
});

test("profile contracts preserve nullable self fields and immutable company VAT", () => {
  assert.equal(ViewerProfileUpdateRequestSchema.safeParse({
    companyId: 42,
    displayName: "Updated Manager",
    phoneNumber: null,
  }).success, true);
  assert.equal(ViewerProfileUpdateRequestSchema.safeParse({ companyId: 42 }).success, false);

  const update = {
    entityVersion: "ev1.MQ",
    heName: "חברה מעודכנת",
    accountantEmail: null,
  };
  assert.equal(BusinessProfileUpdateRequestSchema.safeParse(update).success, true);
  assert.equal(BusinessProfileUpdateRequestSchema.safeParse({
    ...update,
    vatNumber: "999999999",
  }).success, false);
  assert.equal(BusinessProfileUpdateRequestSchema.safeParse({
    entityVersion: "ev1.MQ",
  }).success, false);

  assert.equal(BusinessProfileSchema.safeParse({
    companyId: 42,
    heName: "חברה מעודכנת",
    enName: "Updated Company",
    vatNumber: "123456789",
    businessType: "Field service",
    city: "Haifa",
    address: "1 Test Road",
    businessEmail: "office@example.test",
    businessPhone: "+972500000000",
    businessFax: null,
    accountantName: null,
    accountantEmail: null,
    accountantPhone: null,
    entityVersion: "ev1.Mg",
    updatedAt: "2026-07-13T12:00:00.000Z",
  }).success, true);
});

test("support contracts bind ownership to auth and keep messages bounded", () => {
  assert.equal(SupportConversationCreateRequestSchema.safeParse({
    companyId: 42,
    category: "bug",
  }).success, true);
  assert.equal(SupportConversationCreateRequestSchema.safeParse({
    companyId: 42,
    category: "urgent-admin",
    userId: crypto.randomUUID(),
  }).success, false);
  assert.equal(SupportMessageCreateRequestSchema.safeParse({
    text: "The app cannot open my assigned job.",
  }).success, true);
  assert.equal(SupportMessageCreateRequestSchema.safeParse({ text: "x".repeat(4_001) }).success, false);

  const conversationId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  assert.equal(SupportConversationSummarySchema.safeParse({
    id: conversationId,
    userId: ownerId,
    userName: "Field User",
    companyId: 42,
    category: "support",
    status: "open",
    lastMessage: "Please help",
    lastMessageAt: "2026-07-13T12:00:00.000Z",
    unreadForUser: 0,
    unreadForDev: 1,
    createdAt: "2026-07-13T11:59:00.000Z",
    updatedAt: "2026-07-13T12:00:00.000Z",
  }).success, true);
  assert.equal(SupportMessageSchema.safeParse({
    id: crypto.randomUUID(),
    conversationId,
    senderUid: "dev",
    senderRole: "dev",
    senderName: "Support Developer",
    text: "We are investigating.",
    createdAt: "2026-07-13T12:01:00.000Z",
  }).success, true);
});

test("business registration derives workspace policy from a bounded public profile", () => {
  const request = BusinessRegistrationRequestSchema.parse({
    workspaceMode: "business",
    displayName: "  Manager Name  ",
    phoneNumber: " +972500000000 ",
    businessProfile: {
      name: "  Smart Job Services  ",
      englishName: "Smart Job Services",
      vatNumber: "515000001",
      businessType: "Field service",
      address: "1 Service Road",
      phone: "+97235550000",
      accountantEmail: " ACCOUNTS@example.test ",
    },
  });
  assert.equal(request.displayName, "Manager Name");
  assert.equal(request.businessProfile?.name, "Smart Job Services");
  assert.equal(request.businessProfile?.accountantEmail, "accounts@example.test");

  assert.equal(BusinessRegistrationRequestSchema.safeParse({
    workspaceMode: "business",
    displayName: "Manager Name",
    phoneNumber: "+972500000000",
    entityVersion: "ev1.MQ",
    businessProfile: {
      name: "Missing required fields",
    },
  }).success, false);
  assert.equal(BusinessRegistrationRequestSchema.safeParse({
    workspaceMode: "enterprise",
    displayName: "Manager Name",
    phoneNumber: "+972500000000",
  }).success, false);
  assert.equal(BusinessRegistrationRequestSchema.safeParse({
    workspaceMode: "solo",
    displayName: "Solo User",
    phoneNumber: "+972500000000",
    role: "manager",
  }).success, false);

  assert.equal(BusinessRegistrationResultSchema.safeParse({
    workspace: {
      companyId: 1001,
      name: "Smart Job Services",
      accountType: "business",
      role: "manager",
      memberNo: 1,
      enabledModules: ["clients", "documents", "inventory", "solojob"],
    },
    tier: "Team",
  }).success, true);
});

test("invitation contracts bind a normalized company and never accept caller identity authority", () => {
  assert.deepEqual(InvitationCreateRequestSchema.parse({
    targetRole: "worker",
    targetEmail: " TECHNICIAN@example.test ",
  }), {
    targetRole: "worker",
    targetEmail: "technician@example.test",
    expiresInDays: 30,
  });
  assert.equal(InvitationCreateRequestSchema.safeParse({ targetRole: "dev" }).success, false);
  assert.equal(InvitationCreateRequestSchema.safeParse({
    targetRole: "worker",
    expiresInDays: 366,
  }).success, false);

  assert.deepEqual(InvitationRedeemRequestSchema.parse({
    companyId: 1001,
    inviteCode: "  a1b2-c3d4  ",
    displayName: "  Field Technician  ",
    phoneNumber: " +972501234567 ",
  }), {
    companyId: 1001,
    inviteCode: "A1B2-C3D4",
    displayName: "Field Technician",
    phoneNumber: "+972501234567",
  });
  for (const forbiddenAuthority of ["uid", "email", "role", "internalCompanyId"]) {
    assert.equal(InvitationRedeemRequestSchema.safeParse({
      companyId: 1001,
      inviteCode: "A1B2-C3D4",
      [forbiddenAuthority]: "forged",
    }).success, false);
  }

  assert.equal(InvitationCreateResultSchema.safeParse({
    inviteId: "70438ed9-fabe-46ca-a209-c89d2b9fe688",
    inviteCode: "A1B2-C3D4",
    targetRole: "worker",
    status: "active",
    expiresAt: "2026-08-12T12:00:00.000Z",
    createdAt: "2026-07-13T12:00:00.000Z",
  }).success, true);

  assert.equal(InvitationRedemptionResultSchema.safeParse({
    workspace: {
      companyId: 1001,
      name: "Smart Job Services",
      accountType: "business",
      role: "worker",
      memberNo: 7,
      enabledModules: ["clients", "documents", "inventory", "solojob", "team"],
    },
    membership: {
      memberNo: 7,
      role: "worker",
      displayName: "Field Technician",
      status: "active",
      joinedAt: "2026-07-13T12:00:00.000Z",
    },
  }).success, true);
});

test("canonical schemas accept only values supplied by shared contracts", () => {
  for (const role of ["manager", "worker", "user", "basic", "dev"]) {
    assert.equal(RoleSchema.safeParse(role).success, true);
  }
  for (const accountType of ["solo", "business"]) {
    assert.equal(AccountTypeSchema.safeParse(accountType).success, true);
  }
  for (const status of ["pending", "waiting", "finished", "denied"]) {
    assert.equal(JobStatusSchema.safeParse(status).success, true);
  }
  for (const documentType of [10, 200, 210, 305, 330, 400]) {
    assert.equal(DocTypeSchema.safeParse(documentType).success, true);
  }
  assert.equal(RoleSchema.safeParse("admin").success, false);
  assert.equal(JobStatusSchema.safeParse("completed").success, false);
  assert.equal(DocTypeSchema.safeParse(999).success, false);
  assert.equal(EntityVersionSchema.safeParse("").success, false);
});

test("job list contracts bound SQL filters and expose opaque entity versions", () => {
  assert.deepEqual(JobListQuerySchema.parse({
    status: ["pending", "waiting"],
    dateFrom: "2026-07-01T00:00:00.000Z",
    dateTo: "2026-07-31T23:59:59.999Z",
    creatorUid: "9b3792bb-8f01-46d8-9817-f552f91e7faa",
    search: "  compressor  ",
    pageSize: "50",
    afterCursor: "opaque-cursor",
  }), {
    status: ["pending", "waiting"],
    dateFrom: "2026-07-01T00:00:00.000Z",
    dateTo: "2026-07-31T23:59:59.999Z",
    creatorUid: "9b3792bb-8f01-46d8-9817-f552f91e7faa",
    search: "compressor",
    pageSize: 50,
    afterCursor: "opaque-cursor",
  });
  assert.equal(JobListQuerySchema.safeParse({ pageSize: 201 }).success, false);
  assert.equal(JobListQuerySchema.safeParse({ limit: 10, pageSize: 10 }).success, false);
  assert.equal(JobListQuerySchema.safeParse({
    dateFrom: "2026-08-01T00:00:00.000Z",
    dateTo: "2026-07-01T00:00:00.000Z",
  }).success, false);
  assert.equal(JobListQuerySchema.safeParse({ status: "completed" }).success, false);

  const job = {
    jobId: "3cc2b9bd-a702-453b-b899-4b3bd346a7ba",
    jobNo: 17,
    status: "pending",
    title: "Compressor repair",
    description: "Replace relay",
    notes: null,
    location: "Haifa",
    address: null,
    category: null,
    priority: "high",
    dueAt: null,
    client: {
      id: "70438ed9-fabe-46ca-a209-c89d2b9fe688",
      name: "Northwind",
      phone: null,
    },
    assignee: { memberNo: 7, displayName: "Field worker" },
    creator: {
      uid: "9b3792bb-8f01-46d8-9817-f552f91e7faa",
      memberNo: 1,
      displayName: "Manager",
    },
    isCertificate: false,
    timeFrom: "08:00",
    timeTo: "09:30",
    signingPerson: null,
    travelDistance: 12.5,
    entityVersion: "ev1.MQ",
    createdAt: "2026-07-13T12:00:00.000Z",
    updatedAt: "2026-07-13T12:00:00.000Z",
    finishedAt: null,
    deniedAt: null,
  };
  assert.equal(JobSummarySchema.safeParse(job).success, true);
  assert.equal(JobSummarySchema.safeParse({ ...job, internalCompanyId: crypto.randomUUID() }).success, false);
  assert.equal(JobListPageSchema.safeParse({ items: [job], nextCursor: "opaque-cursor" }).success, true);
});

test("client list contracts preserve canonical fields and bounded pagination", () => {
  assert.deepEqual(ClientListQuerySchema.parse({
    search: "  Northwind  ",
    status: "archived",
    pageSize: "50",
    afterCursor: "opaque-cursor",
  }), {
    search: "Northwind",
    status: "archived",
    pageSize: 50,
    afterCursor: "opaque-cursor",
  });
  assert.equal(ClientListQuerySchema.safeParse({ pageSize: 201 }).success, false);
  assert.equal(ClientListQuerySchema.safeParse({ limit: 50 }).success, false);
  assert.equal(ClientListQuerySchema.safeParse({ search: "x".repeat(81) }).success, false);
  assert.equal(ClientListQuerySchema.safeParse({ status: "deleted" }).success, false);

  const client = {
    clientId: "70438ed9-fabe-46ca-a209-c89d2b9fe688",
    clientNo: 17,
    status: "active",
    name: "Northwind Cooling",
    phone: "+97235550101",
    email: "dispatch@northwind.example",
    address: "10 Service Road",
    city: "Haifa",
    vatNumber: "515987654",
    notes: null,
    entityVersion: "ev1.MQ",
    createdAt: "2026-07-13T12:00:00.000Z",
    updatedAt: "2026-07-13T12:00:00.000Z",
    archivedAt: null,
  };
  assert.equal(ClientSummarySchema.safeParse(client).success, true);
  assert.equal(ClientSummarySchema.safeParse({ ...client, numericId: 17 }).success, false);
  assert.equal(ClientSummarySchema.safeParse({ ...client, status: "deleted" }).success, false);
  assert.equal(ClientListPageSchema.safeParse({
    items: [client],
    nextCursor: "opaque-cursor",
  }).success, true);
});

test("client mutation contracts normalize safe fields and require opaque versions", () => {
  assert.deepEqual(ClientCreateRequestSchema.parse({
    name: "  Northwind Cooling  ",
    phone: " +97235550101 ",
    email: " DISPATCH@northwind.example ",
    vatNumber: " 515987654 ",
  }), {
    name: "Northwind Cooling",
    phone: "+97235550101",
    email: "dispatch@northwind.example",
    vatNumber: "515987654",
  });
  assert.equal(ClientCreateRequestSchema.safeParse({ name: "" }).success, false);
  assert.equal(ClientCreateRequestSchema.safeParse({
    name: "Northwind",
    vatNumber: "515\n987654",
  }).success, false);
  assert.equal(ClientCreateRequestSchema.safeParse({
    name: "Northwind",
    email: "not-an-email",
  }).success, false);

  assert.equal(ClientUpdateRequestSchema.safeParse({
    entityVersion: "ev1.MQ",
    status: "archived",
    notes: null,
  }).success, true);
  assert.equal(ClientUpdateRequestSchema.safeParse({ entityVersion: "ev1.MQ" }).success, false);
  assert.equal(ClientUpdateRequestSchema.safeParse({
    entityVersion: "ev1.MQ",
    status: "deleted",
  }).success, false);
  assert.equal(ClientDeleteRequestSchema.safeParse({ entityVersion: "ev1.Mg" }).success, true);
  assert.equal(ClientDeleteRequestSchema.safeParse({ entityVersion: "ev1.Mg", force: true }).success, false);

  assert.equal(ClientDeleteResultSchema.safeParse({
    clientId: "70438ed9-fabe-46ca-a209-c89d2b9fe688",
    clientNo: 17,
    disposition: "archived",
    entityVersion: "ev1.Mg",
    archivedAt: "2026-07-13T12:00:00.000Z",
  }).success, true);
  assert.equal(ClientDeleteResultSchema.safeParse({
    clientId: "70438ed9-fabe-46ca-a209-c89d2b9fe688",
    clientNo: 18,
    disposition: "deleted",
    entityVersion: null,
    archivedAt: null,
  }).success, true);
});

test("worker list contracts preserve canonical team fields and bounded filters", () => {
  assert.deepEqual(WorkerListQuerySchema.parse({
    role: ["worker", "user"],
    status: "active",
    search: "  technician  ",
    pageSize: "50",
    afterCursor: "opaque-cursor",
  }), {
    role: ["worker", "user"],
    status: "active",
    search: "technician",
    pageSize: 50,
    afterCursor: "opaque-cursor",
  });
  assert.equal(WorkerListQuerySchema.safeParse({ pageSize: 201 }).success, false);
  assert.equal(WorkerListQuerySchema.safeParse({ limit: 50 }).success, false);
  assert.equal(WorkerListQuerySchema.safeParse({ role: "manager" }).success, false);
  assert.equal(WorkerListQuerySchema.safeParse({ status: "archived" }).success, false);

  const worker = {
    memberNo: 17,
    role: "worker",
    status: "active",
    displayName: "Field Technician",
    email: "technician@example.test",
    phoneNumber: "+972500000000",
    entityVersion: "ev1.MQ",
    joinedAt: "2026-07-13T12:00:00.000Z",
    createdAt: "2026-07-13T12:00:00.000Z",
    updatedAt: "2026-07-13T12:30:00.000Z",
  };
  assert.equal(WorkerSummarySchema.safeParse(worker).success, true);
  assert.equal(WorkerSummarySchema.safeParse({ ...worker, uid: crypto.randomUUID() }).success, false);
  assert.equal(
    WorkerSummarySchema.safeParse({ ...worker, membershipId: crypto.randomUUID() }).success,
    false,
  );
  assert.equal(WorkerListPageSchema.safeParse({
    items: [worker],
    nextCursor: "opaque-cursor",
  }).success, true);
  assert.equal(WorkerUpdateRequestSchema.safeParse({
    entityVersion: "ev1.MQ",
    displayName: "Updated Technician",
    phoneNumber: null,
    role: "user",
    status: "active",
  }).success, true);
  assert.equal(WorkerUpdateRequestSchema.safeParse({ entityVersion: "ev1.MQ" }).success, false);
  assert.equal(WorkerUpdateRequestSchema.safeParse({
    entityVersion: "ev1.MQ",
    role: "manager",
  }).success, false);
  assert.equal(WorkerDisableRequestSchema.safeParse({ entityVersion: "ev1.MQ" }).success, true);
});

test("inventory list contracts preserve canonical stock fields and bounded pagination", () => {
  assert.deepEqual(InventoryListQuerySchema.parse({
    status: ["active", "inactive"],
    search: "  compressor  ",
    pageSize: "50",
    afterCursor: "opaque-cursor",
  }), {
    status: ["active", "inactive"],
    search: "compressor",
    pageSize: 50,
    afterCursor: "opaque-cursor",
  });
  assert.equal(InventoryListQuerySchema.safeParse({ pageSize: 201 }).success, false);
  assert.equal(InventoryListQuerySchema.safeParse({ limit: 50 }).success, false);
  assert.equal(InventoryListQuerySchema.safeParse({ search: "x".repeat(81) }).success, false);
  assert.equal(InventoryListQuerySchema.safeParse({ status: "deleted" }).success, false);

  const inventoryPart = {
    partId: "b245b2a1-d87c-4796-8595-8b1a22a5cac2",
    partNo: 17,
    status: "active",
    name: "Compressor relay",
    active: true,
    quantity: 12.5,
    lowThreshold: 3,
    unit: "piece",
    entityVersion: "ev1.MQ",
    stockEntityVersion: "ev1.Mg",
    createdAt: "2026-07-13T12:00:00.000Z",
    updatedAt: "2026-07-13T12:30:00.000Z",
    archivedAt: null,
  };
  assert.equal(InventoryPartSummarySchema.safeParse(inventoryPart).success, true);
  assert.equal(InventoryPartSummarySchema.safeParse({ ...inventoryPart, quantity: -1 }).success, false);
  assert.equal(InventoryPartSummarySchema.safeParse({ ...inventoryPart, internalCompanyId: crypto.randomUUID() }).success, false);
  assert.equal(InventoryListPageSchema.safeParse({
    items: [inventoryPart],
    nextCursor: "opaque-cursor",
  }).success, true);
});

test("inventory mutation contracts bound quantities, versions, targets, and pick batches", () => {
  const version = "ev1.MQ";
  const partId = "b245b2a1-d87c-4796-8595-8b1a22a5cac2";

  assert.deepEqual(InventoryPartCreateRequestSchema.parse({ name: "  Relay  " }), {
    name: "Relay",
    initialQuantity: 0,
    lowThreshold: 0,
    unit: null,
  });
  assert.equal(InventoryPartCreateRequestSchema.safeParse({ name: "Relay", initialQuantity: -1 }).success, false);
  assert.equal(InventoryPartUpdateRequestSchema.safeParse({ entityVersion: version }).success, false);
  assert.equal(InventoryPartUpdateRequestSchema.safeParse({ entityVersion: version, active: false }).success, true);
  assert.equal(InventoryPartArchiveRequestSchema.safeParse({ entityVersion: version }).success, true);

  assert.equal(InventoryAdjustmentRequestSchema.safeParse({
    stockEntityVersion: version,
    quantityDelta: -1.25,
  }).success, true);
  assert.equal(InventoryAdjustmentRequestSchema.safeParse({
    stockEntityVersion: version,
    quantityDelta: 0,
  }).success, false);

  assert.equal(InventoryTransferRequestSchema.safeParse({
    partId,
    memberNo: 7,
    direction: "company_to_member",
    quantity: 2.5,
    sourceStockEntityVersion: version,
  }).success, true);
  assert.equal(InventoryTransferRequestSchema.safeParse({
    partId,
    memberNo: 7,
    direction: "member_to_member",
    quantity: 2.5,
    sourceStockEntityVersion: version,
  }).success, false);

  const pick = {
    memberNo: 7,
    items: [{ partId, quantity: 2.5, stockEntityVersion: version }],
  };
  assert.equal(InventoryPickRequestSchema.safeParse(pick).success, true);
  assert.equal(InventoryPickRequestSchema.safeParse({
    ...pick,
    items: [...pick.items, ...pick.items],
  }).success, false);
});

test("job creation uses canonical create states and field-app clock values", () => {
  const request = {
    title: "Emergency repair",
    description: "Replace the damaged relay",
    status: "finished",
    timeFrom: "08:15",
    timeTo: "09:40",
    partsUsed: [{ partId: 12, quantity: 1 }],
  };

  assert.equal(JobCreateRequestSchema.safeParse(request).success, true);
  assert.equal(JobCreateRequestSchema.safeParse({ ...request, status: "waiting" }).success, false);
  assert.equal(JobCreateRequestSchema.safeParse({ ...request, timeFrom: "99:99" }).success, false);
  assert.equal(JobCreateRequestSchema.safeParse({ ...request, timeFrom: "10:00", timeTo: "09:59" }).success, false);
  assert.equal(JobCreateRequestSchema.safeParse({
    ...request,
    partsUsed: [{ partId: 12, quantity: 1 }, { partId: 12, quantity: 2 }],
  }).success, false);

  assert.equal(JobCreateResultSchema.safeParse({
    jobId: "3cc2b9bd-a702-453b-b899-4b3bd346a7ba",
    jobNo: 18,
    status: "finished",
    entityVersion: "ev1.MQ",
    createdAt: "2026-07-13T12:00:00.000Z",
    updatedAt: "2026-07-13T12:00:00.000Z",
  }).success, true);
  assert.equal(JobCreateRequestSchema.safeParse({
    ...request,
    partsUsed: [{ partId: 12, quantity: 0.0001 }],
  }).success, false);

  const completion = {
    jobId: "3cc2b9bd-a702-453b-b899-4b3bd346a7ba",
    jobNo: 17,
    status: "finished",
    entityVersion: "ev1.Mg",
    finishedAt: "2026-07-13T12:00:00.000Z",
    updatedAt: "2026-07-13T12:00:00.000Z",
  };
  assert.equal(JobCompletionResultSchema.safeParse(completion).success, true);
  assert.equal(
    JobCompletionResultSchema.safeParse({ ...completion, status: "completed" }).success,
    false,
  );
});

test("versioned job mutations reject direct completion and legacy authority fields", () => {
  const version = "ev1.MQ";
  const job = {
    jobId: "3cc2b9bd-a702-453b-b899-4b3bd346a7ba",
    jobNo: 18,
    status: "waiting",
    title: "Emergency repair",
    description: "Replace the damaged relay",
    notes: null,
    location: null,
    address: null,
    category: null,
    priority: null,
    dueAt: null,
    client: null,
    assignee: null,
    creator: null,
    isCertificate: false,
    timeFrom: null,
    timeTo: null,
    signingPerson: null,
    travelDistance: null,
    entityVersion: version,
    createdAt: "2026-07-13T12:00:00.000Z",
    updatedAt: "2026-07-13T12:00:00.000Z",
    finishedAt: null,
    deniedAt: null,
  };

  assert.equal(JobUpdateRequestSchema.safeParse({
    entityVersion: version,
    title: "  Emergency relay repair  ",
    clientId: null,
    assigneeMemberNo: 7,
    status: "waiting",
  }).success, true);
  assert.equal(JobUpdateRequestSchema.safeParse({ entityVersion: version }).success, false);
  for (const status of ["finished", "in_progress", "completed", "received"]) {
    assert.equal(JobUpdateRequestSchema.safeParse({
      entityVersion: version,
      status,
    }).success, false);
  }
  for (const field of [
    "workerId",
    "completedBy",
    "assignedTo",
    "assignedBy",
    "MUser",
    "MName",
    "clientName",
    "clientPhone",
    "clientEmail",
    "clientAddress",
    "jid",
    "createdBy",
  ]) {
    assert.equal(JobUpdateRequestSchema.safeParse({
      entityVersion: version,
      [field]: "forged-authority",
    }).success, false);
  }

  assert.equal(JobAcceptRequestSchema.safeParse({ entityVersion: version }).success, true);
  assert.equal(JobAcceptRequestSchema.safeParse({
    entityVersion: version,
    acceptedBy: "forged-user",
  }).success, false);
  assert.equal(JobDeleteRequestSchema.safeParse({ entityVersion: version }).success, true);
  assert.equal(JobUpdateResultSchema.safeParse(job).success, true);
  assert.equal(JobAcceptResultSchema.safeParse({
    ...job,
    status: "finished",
    finishedAt: "2026-07-13T12:05:00.000Z",
  }).success, true);
  assert.equal(JobDeleteResultSchema.safeParse({
    jobId: job.jobId,
    jobNo: job.jobNo,
    deleted: true,
  }).success, true);
});

test("job attachment sessions bind purpose, target, type, hash, and bounded size", () => {
  const attachment = {
    attachmentId: "3cc2b9bd-a702-453b-b899-4b3bd346a7ba",
    kind: "photo",
    fileName: "compressor.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 1024,
    sha256: "a".repeat(64),
  };

  assert.equal(JobAttachmentUploadSessionRequestSchema.safeParse({
    companyId: 42,
    purpose: "job.create_finished",
    attachments: [attachment],
  }).success, true);
  assert.equal(JobAttachmentUploadSessionRequestSchema.safeParse({
    companyId: 42,
    purpose: "job.complete_assigned",
    jobId: "904ff4a3-98e1-46af-b994-80c8c3c2f38c",
    attachments: [attachment],
  }).success, true);
  assert.equal(JobAttachmentUploadSessionRequestSchema.safeParse({
    companyId: 42,
    purpose: "job.complete_assigned",
    attachments: [attachment],
  }).success, false);
  assert.equal(JobAttachmentUploadSessionRequestSchema.safeParse({
    companyId: 42,
    purpose: "job.create_finished",
    attachments: [{ ...attachment, mimeType: "application/pdf" }],
  }).success, false);
  assert.equal(JobAttachmentUploadSessionRequestSchema.safeParse({
    companyId: 42,
    purpose: "job.create_finished",
    attachments: [attachment, attachment],
  }).success, false);
});

test("web-session contracts keep opaque credentials out of current-session responses", () => {
  const viewer = {
    uid: "9b3792bb-8f01-46d8-9817-f552f91e7faa",
    email: "manager@example.com",
    displayName: "Manager",
    emailVerified: true,
    workspaces: [],
  };
  const absoluteExpiresAt = "2026-07-14T00:00:00.000Z";

  assert.deepEqual(WebSessionCreateRequestSchema.parse({
    email: "  MANAGER@example.com ",
    password: "password-is-not-trimmed ",
  }), {
    email: "manager@example.com",
    password: "password-is-not-trimmed ",
  });
  assert.equal(WebSessionCreateRequestSchema.safeParse({
    email: "manager@example.com",
    password: "",
  }).success, false);

  assert.equal(WebSessionCreatedSchema.safeParse({
    sessionToken: SESSION_TOKEN,
    csrfToken: CSRF_TOKEN,
    absoluteExpiresAt,
    viewer,
  }).success, true);
  assert.equal(WebSessionCurrentSchema.safeParse({
    absoluteExpiresAt,
    viewer,
  }).success, true);
  assert.equal(WebSessionCurrentSchema.safeParse({
    absoluteExpiresAt,
    viewer,
    accessToken: "must-never-be-exposed",
  }).success, false);
  assert.equal(WebSessionRevokedSchema.safeParse({ revoked: true }).success, true);
  assert.equal(WebSessionRevokedSchema.safeParse({ revoked: false }).success, false);
});

test("push-token contracts keep tokens write-only and restrict mobile platforms", () => {
  const token = "fcm:opaque-device-token-123456789";
  const deviceId = "install-9b3792bb-8f01-46d8-9817-f552f91e7faa";
  assert.deepEqual(PushTokenUpsertRequestSchema.parse({
    deviceId,
    token: `  ${token}  `,
    platform: "android",
  }), {
    deviceId,
    token,
    platform: "android",
  });
  assert.equal(PushTokenUpsertRequestSchema.safeParse({ deviceId, token: "short", platform: "ios" }).success, false);
  assert.equal(PushTokenUpsertRequestSchema.safeParse({ deviceId, token, platform: "web" }).success, false);
  assert.equal(PushTokenUpsertRequestSchema.safeParse({ deviceId, token, platform: "ios", uid: crypto.randomUUID() }).success, false);
  assert.equal(PushTokenClearRequestSchema.safeParse({ deviceId }).success, true);
  assert.equal(PushTokenClearRequestSchema.safeParse({ deviceId: "short" }).success, false);

  const result = {
    registered: true,
    platform: "ios",
    pushTokenUpdatedAt: "2026-07-13T12:00:00.000Z",
  };
  assert.equal(PushTokenUpsertResultSchema.safeParse(result).success, true);
  assert.equal(PushTokenUpsertResultSchema.safeParse({ ...result, token }).success, false);
  assert.equal(PushTokenClearResultSchema.safeParse({ cleared: true }).success, true);
  assert.equal(PushTokenClearResultSchema.safeParse({ cleared: false }).success, false);
});

test("upgrade-request contracts derive current authority and use opaque versions", () => {
  const request = {
    companyId: 1042,
    requestedTier: "Enterprise",
    message: "We need the enterprise tier for a larger field team.",
  };
  assert.equal(UpgradeRequestCreateRequestSchema.safeParse(request).success, true);
  assert.equal(UpgradeRequestCreateRequestSchema.safeParse({
    ...request,
    currentTier: "Basic",
  }).success, false);
  assert.equal(UpgradeRequestCreateRequestSchema.safeParse({
    ...request,
    requestedTier: "Basic",
  }).success, false);

  const summary = {
    requestId: "9b3792bb-8f01-46d8-9817-f552f91e7faa",
    requesterUid: "4500a9a4-9765-4d80-8be8-ff9872058bb9",
    requesterEmail: "manager@example.com",
    companyId: 1042,
    role: "manager",
    currentTier: "Team",
    requestedTier: "Enterprise",
    message: request.message,
    status: "pending",
    moderationNote: null,
    moderatedAt: null,
    moderatedByName: null,
    appliedAt: null,
    entityVersion: "ev1.MQ",
    createdAt: "2026-07-13T12:00:00.000Z",
    updatedAt: "2026-07-13T12:00:00.000Z",
  };
  assert.equal(UpgradeRequestSummarySchema.safeParse(summary).success, true);
  assert.equal(UpgradeRequestSummarySchema.safeParse({
    ...summary,
    internalCompanyId: crypto.randomUUID(),
  }).success, false);
  assert.equal(UpgradeRequestListPageSchema.safeParse({
    items: [summary],
    nextCursor: null,
  }).success, true);
  assert.equal(UpgradeRequestModerationRequestSchema.safeParse({
    status: "approved",
    moderationNote: "Approved",
    entityVersion: summary.entityVersion,
  }).success, true);
  assert.equal(UpgradeRequestModerationRequestSchema.safeParse({
    status: "approved",
  }).success, false);
});

test("contact-request contracts keep challenge authority outside the backend payload", () => {
  const request = {
    name: "Field Service Manager",
    email: "MANAGER@example.com",
    company: "Example Field Service",
    subject: "ERP rollout",
    message: "Please contact us about an ERP rollout.",
  };
  const parsed = ContactRequestCreateRequestSchema.parse(request);
  assert.equal(parsed.email, "manager@example.com");
  assert.equal(ContactRequestCreateRequestSchema.safeParse({
    ...request,
    challengeToken: "must-stay-in-the-website-BFF",
  }).success, false);
  assert.equal(ContactRequestCreatedResultSchema.safeParse({
    requestId: crypto.randomUUID(),
    status: "received",
    createdAt: "2026-07-13T12:00:00.000Z",
  }).success, true);
});

test("document contracts keep filters bounded and storage paths private", () => {
  const query = DocumentListQuerySchema.parse({
    documentType: "305",
    status: ["pending", "completed"],
    createdByUid: "4500a9a4-9765-4d80-8be8-ff9872058bb9",
    pageSize: "50",
  });
  assert.equal(query.documentType, 305);
  assert.equal(query.pageSize, 50);
  assert.equal(DocumentListQuerySchema.safeParse({ documentType: "999" }).success, false);
  assert.equal(DocumentListQuerySchema.safeParse({ pageSize: 201 }).success, false);
  assert.equal(DocumentListQuerySchema.safeParse({
    dateFrom: "2026-08-01T00:00:00.000Z",
    dateTo: "2026-07-01T00:00:00.000Z",
  }).success, false);

  const document = {
    documentId: "9b3792bb-8f01-46d8-9817-f552f91e7faa",
    documentCode: "42-TI",
    documentType: 305,
    documentNumber: 42,
    generationStatus: "completed",
    taxAuthorityStatus: "approved",
    client: {
      clientId: null,
      name: "Example Client",
      phone: null,
      city: "Haifa",
      vatNumber: "123456789",
    },
    creator: {
      uid: "4500a9a4-9765-4d80-8be8-ff9872058bb9",
      memberNo: 1,
      displayName: "Manager",
    },
    language: "he",
    notes: null,
    totalBeforeVat: 100,
    vatAmount: 18,
    totalWithVat: 118,
    confirmationNumber: "approval-42",
    documentDate: "2026-07-13T12:00:00.000Z",
    hasFile: true,
    emailSent: false,
    entityVersion: "ev1.MQ",
    createdAt: "2026-07-13T12:00:00.000Z",
    updatedAt: "2026-07-13T12:01:00.000Z",
  };
  assert.equal(DocumentSummarySchema.safeParse(document).success, true);
  assert.equal(DocumentSummarySchema.safeParse({
    ...document,
    storagePath: "private/internal/path.pdf",
  }).success, false);
  assert.equal(DocumentListPageSchema.safeParse({ items: [document], nextCursor: null }).success, true);

  assert.equal(DocumentTaskSchema.safeParse({
    taskId: "generate:task-42",
    taskType: "generate",
    status: "completed",
    documentId: "42-TI",
    previewURL: null,
    downloadURL: "https://project.supabase.co/storage/file.pdf?token=short-lived",
    pdfSize: 1024,
    error: null,
    createdAt: "2026-07-13T12:00:00.000Z",
    updatedAt: "2026-07-13T12:01:00.000Z",
  }).success, true);
  assert.equal(DocumentDownloadAccessSchema.safeParse({
    documentId: document.documentId,
    documentCode: document.documentCode,
    downloadURL: "https://project.supabase.co/storage/file.pdf?token=short-lived",
    expiresAt: "2026-07-13T12:15:00.000Z",
  }).success, true);

  const mutation = {
    documentType: 200,
    documentData: {
      client: {
        name: "Example Client",
        email: "client@example.com",
        city: "Haifa",
      },
      items: [{ description: "Field service", quantity: 2, price: 50 }],
      language: "he",
      date: "2026-07-13",
      notes: "Created through the versioned API",
    },
  };
  assert.equal(DocumentPreviewRequestSchema.safeParse(mutation).success, true);
  assert.equal(DocumentGenerateRequestSchema.safeParse(mutation).success, true);
  assert.equal(DocumentGenerateRequestSchema.safeParse({
    ...mutation,
    documentType: 305,
  }).success, false);
  assert.equal(DocumentPreviewRequestSchema.safeParse({
    ...mutation,
    documentData: {
      ...mutation.documentData,
      items: Array.from({ length: 101 }, () => mutation.documentData.items[0]),
    },
  }).success, false);
  assert.equal(DocumentPreviewRequestSchema.safeParse({
    ...mutation,
    documentData: {
      ...mutation.documentData,
      totalWithVat: 118,
    },
  }).success, false);
  assert.equal(DocumentTaskAcceptedSchema.safeParse({
    taskId: crypto.randomUUID(),
    status: "pending",
    documentId: document.documentId,
    documentCode: document.documentCode,
    entityVersion: document.entityVersion,
  }).success, true);
  assert.equal(DocumentDeleteRequestSchema.safeParse({
    entityVersion: document.entityVersion,
  }).success, true);
  assert.equal(DocumentDeleteResultSchema.safeParse({
    documentId: document.documentId,
    documentCode: document.documentCode,
    disposition: "deleted",
  }).success, true);
});
