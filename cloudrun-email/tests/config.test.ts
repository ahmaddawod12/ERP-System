import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.js";

const base = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:55322/postgres",
  DATABASE_SSL_MODE: "disable",
  PUBSUB_VERIFICATION_TOKEN: "01234567890123456789012345678901",
  SUPABASE_URL: "http://127.0.0.1:55321",
  SUPABASE_SECRET_KEY: "sb_secret_localtestkey",
  SUPABASE_STORAGE_BUCKET: "smart-job-company-files",
  AWS_REGION: "eu-central-1",
  SES_FROM_EMAIL: "documents@example.test",
};

test("email worker accepts an isolated local configuration", () => {
  assert.equal(loadConfig(base).database.ssl, false);
});

test("production requires the least-privilege database role", () => {
  assert.throws(
    () => loadConfig({
      ...base,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://postgres:secret@db.example.test/postgres",
      DATABASE_SSL_MODE: "require",
      CLOUD_RUN_SERVICE_URL: "https://email.example.test",
      PUBSUB_ALLOWED_SERVICE_ACCOUNTS: "pubsub@example.iam.gserviceaccount.com",
    }),
    /smart_job_email/,
  );
});

test("local service endpoints require the exact mounted platform marker", () => {
  const local = {
    ...base,
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://smart_job_email:local@supabase_db_smart-job-erp-local:5432/postgres",
    SMART_JOB_DEPLOYMENT_ENV: "local",
    SMART_JOB_LOCAL_PLATFORM: "true",
    LOCAL_PLATFORM_MARKER_PATH: "/run/secrets/smart_job_local_platform",
    SUPABASE_URL: "http://supabase_kong_smart-job-erp-local:8000",
    SUPABASE_PUBLIC_URL: "http://127.0.0.1:55321",
    AWS_SES_ENDPOINT: "http://local-platform-adapter:8090/ses",
    AWS_ACCESS_KEY_ID: "local-access-key",
    AWS_SECRET_ACCESS_KEY: "local-secret-access-key",
  };
  const config = loadConfig(local, {
    readLocalMarker: () => Buffer.from("smart-job-erp-local-platform-v1"),
  });
  assert.equal(config.storage.publicBaseUrl?.origin, "http://127.0.0.1:55321");
  assert.equal(config.ses.endpoint?.href, "http://local-platform-adapter:8090/ses");

  assert.throws(
    () => loadConfig(local, { readLocalMarker: () => Buffer.from("wrong-project") }),
    /mounted local-platform marker/,
  );
});

test("provider emulator settings are forbidden outside the local platform", () => {
  assert.throws(
    () => loadConfig({
      ...base,
      AWS_SES_ENDPOINT: "http://127.0.0.1:58084/ses",
      AWS_ACCESS_KEY_ID: "local-access-key",
      AWS_SECRET_ACCESS_KEY: "local-secret-access-key",
    }),
    /mounted local-platform marker/,
  );
});
