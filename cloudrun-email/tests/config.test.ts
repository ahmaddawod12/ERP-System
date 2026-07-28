import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import { terraformProductionEnv } from "./fixtures/terraform-production-env.js";

const base = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:55322/postgres",
  DATABASE_SSL_MODE: "disable",
  PUBSUB_VERIFICATION_TOKEN: "01234567890123456789012345678901",
  GCS_PROJECT_ID: "smart-job-test",
  COMPANY_FILES_BUCKET: "smart-job-company-files",
  AWS_REGION: "eu-central-1",
  SES_FROM_EMAIL: "documents@example.test",
};

test("email worker accepts an isolated local configuration", () => {
  assert.equal(loadConfig(base).database.ssl, false);
});

test("federated SES requires a complete role, audience, and Google service-account subject", () => {
  const config = loadConfig({
    ...base,
    AWS_SES_CREDENTIAL_MODE: "federated",
    AWS_SES_ROLE_ARN: "arn:aws:iam::123456789012:role/smart-job-email-ses",
    AWS_SES_OIDC_AUDIENCE: "smart-job-email-production",
    AWS_GOOGLE_SERVICE_ACCOUNT_UNIQUE_ID: "123456789012345678901",
  });
  assert.equal(config.ses.credentialMode, "federated");
  assert.equal(config.ses.federation?.subject, "123456789012345678901");
  assert.throws(
    () => loadConfig({
      ...base,
      AWS_SES_CREDENTIAL_MODE: "federated",
      AWS_SES_ROLE_ARN: "arn:aws:iam::123456789012:role/smart-job-email-ses",
    }),
    /Federated SES requires/,
  );
  assert.throws(
    () => loadConfig({
      ...base,
      AWS_SES_CREDENTIAL_MODE: "federated",
      AWS_SES_ROLE_ARN: "arn:aws:iam::123456789012:role/smart-job-email-ses",
      AWS_SES_OIDC_AUDIENCE: "smart-job-email-production",
      AWS_GOOGLE_SERVICE_ACCOUNT_UNIQUE_ID: "123456789012345678901",
      AWS_ACCESS_KEY_ID: "static-key",
      AWS_SECRET_ACCESS_KEY: "static-secret-key-material",
    }),
    /Static AWS credentials are forbidden/,
  );
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
    DATABASE_URL: "postgresql://smart_job_email:local@smart-job-postgres:5432/postgres",
    SMART_JOB_DEPLOYMENT_ENV: "local",
    SMART_JOB_LOCAL_PLATFORM: "true",
    LOCAL_PLATFORM_MARKER_PATH: "/run/secrets/smart_job_local_platform",
    GCS_API_ENDPOINT: "http://gcs-emulator:4443",
    COMPANY_FILES_PUBLIC_BASE_URL: "http://127.0.0.1:58080",
    AWS_SES_ENDPOINT: "http://local-platform-adapter:8090/ses",
    AWS_ACCESS_KEY_ID: "local-access-key",
    AWS_SECRET_ACCESS_KEY: "local-secret-access-key",
  };
  const config = loadConfig(local, {
    readLocalMarker: () => Buffer.from("smart-job-erp-local-platform-v1"),
  });
  assert.equal(config.storage.apiEndpoint, "http://gcs-emulator:4443");
  assert.equal(config.storage.publicBaseUrl?.origin, "http://127.0.0.1:58080");
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

test("production accepts the exact Terraform environment and secret names", () => {
  const config = loadConfig(terraformProductionEnv);

  assert.equal(config.nodeEnv, "production");
  assert.equal(config.ses.region, "eu-central-1");
  assert.equal(config.ses.endpoint, undefined);
  assert.equal(config.pubsub.audience, "https://email.example.test");
});

test("production accepts ambient AWS credentials or no static credential pair", () => {
  assert.doesNotThrow(() => loadConfig(terraformProductionEnv));

  const {
    AWS_ACCESS_KEY_ID: _accessKeyId,
    AWS_SECRET_ACCESS_KEY: _secretAccessKey,
    ...withoutStaticCredentials
  } = terraformProductionEnv;
  assert.doesNotThrow(() => loadConfig(withoutStaticCredentials));
});

test("email configuration rejects a half-configured AWS credential pair", () => {
  const { AWS_SECRET_ACCESS_KEY: _secretAccessKey, ...missingSecret } = terraformProductionEnv;
  assert.throws(
    () => loadConfig(missingSecret),
    /must be configured together/,
  );

  const { AWS_ACCESS_KEY_ID: _accessKeyId, ...missingAccessKey } = terraformProductionEnv;
  assert.throws(
    () => loadConfig(missingAccessKey),
    /must be configured together/,
  );
});
