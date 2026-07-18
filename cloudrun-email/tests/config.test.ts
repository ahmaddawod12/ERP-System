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
