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
  SUPABASE_URL: "http://127.0.0.1:55321",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test_key_123456789",
  SUPABASE_SECRET_KEY: "sb_secret_local_test_key_123456789012345",
  WEB_SESSION_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString("base64"),
  WEB_SESSION_ENCRYPTION_KEY_VERSION: "local-v1",
};

test("runtime config derives local JWKS settings and caps the API pool", () => {
  const config = loadApiRuntimeConfig(baseEnvironment);

  assert.equal(config.database.maxConnections, MAX_DATABASE_POOL_SIZE);
  assert.equal(config.database.ssl, false);
  assert.equal(config.supabaseJwt.issuer, "http://127.0.0.1:55321/auth/v1");
  assert.equal(
    config.supabaseJwt.jwksUrl.href,
    "http://127.0.0.1:55321/auth/v1/.well-known/jwks.json",
  );
  assert.deepEqual(config.supabaseJwt.audiences, ["authenticated"]);
  assert.equal(config.webSessionEncryption.key.length, 32);
  assert.equal(config.webSessionEncryption.keyVersion, "local-v1");
  assert.equal(config.supabaseStorage.bucketId, "smart-job-company-files");
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
    SUPABASE_URL: "https://project.supabase.co/",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_managed_test_key_123456789",
    SUPABASE_SECRET_KEY: "sb_secret_managed_test_key_1234567890123",
    SUPABASE_STORAGE_BUCKET: "smart-job-company-files",
    SUPABASE_JWT_AUDIENCE: "authenticated,smart-job-mobile,authenticated",
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
  assert.deepEqual(config.supabaseJwt.audiences, [
    "authenticated",
    "smart-job-mobile",
  ]);
  assert.equal(config.supabaseStorage.baseUrl.href, "https://project.supabase.co/");
  assert.equal(config.supabaseStorage.secretKey, "sb_secret_managed_test_key_1234567890123");
  assert.equal(config.supabaseStorage.bucketId, "smart-job-company-files");
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
    { ...baseEnvironment, SUPABASE_URL: "http://project.supabase.co" },
    { ...baseEnvironment, SUPABASE_URL: "https://project.supabase.co/storage/v1" },
    { ...baseEnvironment, SUPABASE_URL: "https://user:password@project.supabase.co/" },
    { ...baseEnvironment, SUPABASE_URL: "https://project.supabase.co/?next=unsafe" },
    { ...baseEnvironment, SUPABASE_URL: "https://project.supabase.co/#fragment" },
    { ...baseEnvironment, SUPABASE_SECRET_KEY: "service-role-jwt" },
    { ...baseEnvironment, SUPABASE_STORAGE_BUCKET: "company-files-staging" },
    { ...baseEnvironment, SUPABASE_JWT_ISSUER: "http://keys.example.test/auth/v1" },
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
