import assert from "node:assert/strict";
import { copyFile, writeFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { runDatabaseBackup } from "../src/database-runner.js";
import type {
  BackupDestination,
  DatabaseManifest,
  StorageCheckpoint,
  StorageManifest,
} from "../src/types.js";

class DatabaseDestination implements BackupDestination {
  uploads: string[] = [];
  manifests: DatabaseManifest[] = [];

  async loadCheckpoint() {
    return {};
  }
  async saveCheckpoint(_checkpoint: StorageCheckpoint) {
    return "1";
  }
  async putFileCreateOnly(input: {
    localPath: string;
    objectName: string;
  }) {
    this.uploads.push(input.objectName);
    const retainedFixture = `${input.localPath}.retained`;
    await copyFile(input.localPath, retainedFixture);
    return { generation: "42" };
  }
  async getObjectMetadata() {
    return { generation: "42" };
  }
  async putJsonCreateOnly(
    _objectName: string,
    value: StorageManifest | DatabaseManifest,
  ) {
    if (value.kind === "postgresql-custom-export") this.manifests.push(value);
    return { generation: "43" };
  }
}

describe("database logical export", () => {
  it("records a PostgreSQL 17 custom-format recovery manifest", async () => {
    const destination = new DatabaseDestination();
    const manifest = await runDatabaseBackup({
      databaseUrl: "postgresql://backup:fixture@db.example.test/postgres",
      destination,
      now: new Date("2026-07-26T02:00:00Z"),
      dump: async (_databaseUrl, outputPath) => {
        await writeFile(outputPath, Buffer.from("PGDMP fixture"));
      },
    });
    assert.equal(manifest.postgresMajor, 17);
    assert.equal(manifest.destinationGeneration, "42");
    assert.match(manifest.sha256, /^[0-9a-f]{64}$/);
    assert.equal(destination.manifests.length, 1);
  });

  it("publishes no artifact when the export is interrupted", async () => {
    const destination = new DatabaseDestination();
    await assert.rejects(
      () =>
        runDatabaseBackup({
          databaseUrl: "postgresql://backup:fixture@db.example.test/postgres",
          destination,
          dump: async () => {
            throw new Error("interrupted export");
          },
        }),
      /interrupted export/,
    );
    assert.deepEqual(destination.uploads, []);
    assert.deepEqual(destination.manifests, []);
  });
});
