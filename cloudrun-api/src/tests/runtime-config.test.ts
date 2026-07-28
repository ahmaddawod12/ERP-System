import assert from "node:assert/strict";
import test from "node:test";

import {
  loadApiRuntimeConfig,
  MAX_DATABASE_POOL_SIZE,
  RuntimeConfigError,
} from "../runtime-config.js";

const baseEnvironment = {
  DATABASE_URL: "postgresql://smart_job_api:local-only@127.0.0.1:55322/postgres",
  DATABASE_SSL_MODE: "disable",
  FIREBASE_PROJECT_ID: "smart-job-local",
  FIREBASE_WEB_API_KEY: "firebase-local-api-key-123456789",
  WEB_SESSION_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString("base64"),
  WEB_SESSION_ENCRYPTION_KEY_VERSION: "local-v1",
};

test("runtime config validates Firebase settings and caps the API pool", () => {
  const config = loadApiRuntimeConfig(baseEnvironment);

  assert.equal(config.database.maxConnections, MAX_DATABASE_POOL_SIZE);
  assert.equal(config.database.ssl, false);
  assert.equal(config.firebaseAuth.projectId, "smart-job-local");
  assert.equal(config.firebaseAuth.webApiKey, "firebase-local-api-key-123456789");
  assert.equal(config.webSessionEncryption.key.length, 32);
  assert.equal(config.webSessionEncryption.keyVersion, "local-v1");
  assert.equal(config.companyFileStorage.bucketId, "smart-job-company-files");
});

test("runtime config accepts strict managed settings without exposing credentials", () => {
  const config = loadApiRuntimeConfig({
    DATABASE_URL: "postgresql://runtime:secret@db.example.test:5432/postgres",
    DATABASE_SSL_MODE: "require",
    DATABASE_SSL_REJECT_UNAUTHORIZED: "true",
    DATABASE_SSL_CA: "line-one\\nline-two",
    DATABASE_MAX_CONNECTIONS: "3",
    DATABASE_IDLE_TIMEOUT_MS: "25000",
    DATABASE_CONNECT_TIMEOUT_MS: "5000",
    FIREBASE_PROJECT_ID: "smart-job-prod",
    FIREBASE_WEB_API_KEY: "firebase-managed-api-key-123456789",
    GCS_PROJECT_ID: "smart-job-prod",
    COMPANY_FILES_BUCKET: "smart-job-company-files",
    WEB_SESSION_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 9).toString("base64"),
    WEB_SESSION_ENCRYPTION_KEY_VERSION: "managed-v3",
    DOCUMENT_PUBSUB_PROJECT_ID: "smart-job-prod",
    DOCUMENT_PREVIEW_TOPIC: "document-preview",
    DOCUMENT_GENERATE_TOPIC: "document-generate",
    EMAIL_DELIVERY_TOPIC: "document-email",
    INTERNAL_API_AUDIENCE: "https://smart-job-api-abc.run.app",
    INTERNAL_CALLER_SERVICE_ACCOUNTS:
      "scheduler@smart-job-prod.iam.gserviceaccount.com,pdf@smart-job-prod.iam.gserviceaccount.com",
  });

  assert.deepEqual(config.database.ssl, {
    rejectUnauthorized: true,
    ca: "line-one\nline-two",
  });
  assert.equal(config.database.maxConnections, 3);
  assert.deepEqual(config.companyFileStorage, {
    projectId: "smart-job-prod",
    bucketId: "smart-job-company-files",
  });
  assert.deepEqual(config.documentDispatch, {
    projectId: "smart-job-prod",
    previewTopic: "document-preview",
    generateTopic: "document-generate",
    emailTopic: "document-email",
  });
  assert.deepEqual(config.taxSubmission, { mode: "disabled" });
  assert.deepEqual(config.internalIdentity, {
    audience: "https://smart-job-api-abc.run.app",
    allowedServiceAccounts: [
      "scheduler@smart-job-prod.iam.gserviceaccount.com",
      "pdf@smart-job-prod.iam.gserviceaccount.com",
    ],
  });
});

test("runtime config accepts marker-gated Compose endpoints and keeps tax disabled", () => {
  const localEnvironment = {
    ...baseEnvironment,
    NODE_ENV: "production",
    SMART_JOB_DEPLOYMENT_ENV: "local",
    SMART_JOB_LOCAL_PLATFORM: "true",
    LOCAL_PLATFORM_MARKER_PATH: "/run/secrets/smart_job_local_platform",
    DATABASE_URL:
      "postgresql://smart_job_api:local-only@smart-job-postgres:5432/postgres",
    FIREBASE_AUTH_EMULATOR_HOST: "firebase-auth-emulator:9099",
    DOCUMENT_PUBSUB_PROJECT_ID: "smart-job-local",
    DOCUMENT_PREVIEW_TOPIC: "document-preview",
    DOCUMENT_GENERATE_TOPIC: "document-generate",
    EMAIL_DELIVERY_TOPIC: "document-email",
    PUBSUB_API_BASE_URL: "http://local-platform-adapter:8090",
    GOOGLE_METADATA_ACCESS_TOKEN_URL:
      "http://local-platform-adapter:8090/computeMetadata/v1/instance/service-accounts/default/token",
    LOCAL_INTERNAL_IDENTITY_TOKEN: "local_identity_012345678901234567890123456789",
    GCS_API_ENDPOINT: "http://gcs-emulator:4443",
    COMPANY_FILES_PUBLIC_BASE_URL: "http://127.0.0.1:58080",
    TAX_SUBMISSION_MODE: "disabled",
  };
  const config = loadApiRuntimeConfig(localEnvironment, {
    readLocalMarker: () => "smart-job-erp-local-platform-v1",
  });

  assert.equal(config.database.ssl, false);
  assert.equal(
    config.firebaseAuth.authBaseUrl?.href,
    "http://firebase-auth-emulator:9099/identitytoolkit.googleapis.com/",
  );
  assert.equal(config.companyFileStorage.apiEndpoint, "http://gcs-emulator:4443");
  assert.equal(
    config.companyFileStorage.publicBaseUrl?.href,
    "http://127.0.0.1:58080/",
  );
  assert.equal(config.documentDispatch?.apiBaseUrl?.href, "http://local-platform-adapter:8090/");
  assert.equal(config.localIdentityToken, localEnvironment.LOCAL_INTERNAL_IDENTITY_TOKEN);
  assert.deepEqual(config.taxSubmission, { mode: "disabled" });

  assert.throws(
    () => loadApiRuntimeConfig(localEnvironment, { readLocalMarker: () => "wrong" }),
    /mounted marker/,
  );
  assert.throws(
    () => loadApiRuntimeConfig(
      { ...localEnvironment, TAX_SUBMISSION_MODE: "sandbox" },
      { readLocalMarker: () => "smart-job-erp-local-platform-v1" },
    ),
    /must remain disabled/,
  );
});

test("runtime config fails closed for missing, oversized, and insecure settings", () => {
  const invalidEnvironments: NodeJS.ProcessEnv[] = [
    {},
    { ...baseEnvironment, DATABASE_MAX_CONNECTIONS: "6" },
    { ...baseEnvironment, DATABASE_URL: "https://not-postgres.example.test" },
    {
      ...baseEnvironment,
      DATABASE_URL: "postgresql://smart_job_api:secret@db.example.test/postgres",
      DATABASE_SSL_MODE: "disable",
    },
    { ...baseEnvironment, FIREBASE_PROJECT_ID: "INVALID_PROJECT" },
    { ...baseEnvironment, FIREBASE_WEB_API_KEY: "short" },
    { ...baseEnvironment, COMPANY_FILES_BUCKET: "INVALID_BUCKET" },
    { ...baseEnvironment, GCS_PROJECT_ID: "INVALID_PROJECT" },
    { ...baseEnvironment, FIREBASE_AUTH_EMULATOR_HOST: "remote.example.test:9099" },
    { ...baseEnvironment, WEB_SESSION_ENCRYPTION_KEY_BASE64: "not-base64" },
    {
      ...baseEnvironment,
      WEB_SESSION_ENCRYPTION_KEY_BASE64: Buffer.alloc(31).toString("base64"),
    },
    { ...baseEnvironment, WEB_SESSION_ENCRYPTION_KEY_VERSION: "invalid version" },
    { ...baseEnvironment, DOCUMENT_PUBSUB_PROJECT_ID: "smart-job-prod" },
    {
      ...baseEnvironment,
      DOCUMENT_PUBSUB_PROJECT_ID: "smart-job-prod",
      DOCUMENT_PREVIEW_TOPIC: "document-preview",
      DOCUMENT_GENERATE_TOPIC: "bad topic",
    },
    { ...baseEnvironment, INTERNAL_API_AUDIENCE: "https://smart-job-api-abc.run.app" },
    {
      ...baseEnvironment,
      INTERNAL_API_AUDIENCE: "https://smart-job-api-abc.run.app/path",
      INTERNAL_CALLER_SERVICE_ACCOUNTS: "scheduler@smart-job-prod.iam.gserviceaccount.com",
    },
    {
      ...baseEnvironment,
      INTERNAL_API_AUDIENCE: "https://smart-job-api-abc.run.app",
      INTERNAL_CALLER_SERVICE_ACCOUNTS: "not-a-service-account@example.com",
    },
  ];

  for (const environment of invalidEnvironments) {
    assert.throws(() => loadApiRuntimeConfig(environment), RuntimeConfigError);
  }
});
