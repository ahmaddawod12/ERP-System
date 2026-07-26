import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadBackupConfig } from "../src/config.js";

const storageEnv = {
  NODE_ENV: "production",
  BACKUP_MODE: "storage",
  BACKUP_BUCKET: "smart-job-backup-prod",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_STORAGE_BUCKET: "smart-job-company-files",
  SUPABASE_S3_REGION: "eu-central-1",
  SUPABASE_S3_ACCESS_KEY_ID: "fixture-access",
  SUPABASE_S3_SECRET_ACCESS_KEY: "fixture-secret",
};

describe("backup configuration", () => {
  it("accepts the Terraform-shaped production storage environment", () => {
    const config = loadBackupConfig(storageEnv);
    assert.equal(config.mode, "storage");
    assert.equal(
      config.source?.endpoint,
      "https://project.supabase.co/storage/v1/s3",
    );
    assert.equal(config.rpoMinutes, 15);
  });

  it("requires dedicated S3 credentials and rejects insecure production URLs", () => {
    assert.throws(
      () =>
        loadBackupConfig({
          ...storageEnv,
          SUPABASE_S3_SECRET_ACCESS_KEY: "",
        }),
      /SUPABASE_S3_SECRET_ACCESS_KEY is required/,
    );
    assert.throws(
      () =>
        loadBackupConfig({
          ...storageEnv,
          SUPABASE_URL: "http://project.invalid",
        }),
      /HTTPS/,
    );
  });

  it("requires a dedicated database URL only for database exports", () => {
    assert.throws(
      () => loadBackupConfig({ ...storageEnv, BACKUP_MODE: "database" }),
      /BACKUP_DATABASE_URL is required/,
    );
    assert.equal(
      loadBackupConfig({
        ...storageEnv,
        BACKUP_MODE: "database",
        BACKUP_DATABASE_URL:
          "postgresql://smart_job_backup:fixture@db.example.test/postgres",
      }).mode,
      "database",
    );
  });
});
