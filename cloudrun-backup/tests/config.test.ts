import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadBackupConfig } from "../src/config.js";

const storageEnv = {
  NODE_ENV: "production",
  BACKUP_MODE: "storage",
  BACKUP_BUCKET: "smart-job-backup-prod",
  GCS_PROJECT_ID: "smart-job-production",
  COMPANY_FILES_BUCKET: "smart-job-company-files",
};

describe("backup configuration", () => {
  it("accepts the Terraform-shaped production storage environment", () => {
    const config = loadBackupConfig(storageEnv);
    assert.equal(config.mode, "storage");
    assert.equal(config.source?.projectId, "smart-job-production");
    assert.equal(config.source?.bucket, "smart-job-company-files");
    assert.equal(config.rpoMinutes, 15);
  });

  it("requires the source bucket", () => {
    assert.throws(
      () =>
        loadBackupConfig({
          ...storageEnv,
          COMPANY_FILES_BUCKET: "",
        }),
      /COMPANY_FILES_BUCKET is required/,
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
