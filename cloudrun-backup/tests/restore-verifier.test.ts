import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertIsolatedRestoreTarget,
  verifyManifest,
  type ExactObjectReader,
} from "../src/restore-verifier-core.js";
import type {
  DatabaseManifest,
  StorageManifest,
} from "../src/types.js";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("restore verifier", () => {
  it("verifies every exact storage generation and ignores deletion markers", async () => {
    const calls: string[] = [];
    const reader: ExactObjectReader = {
      async read(objectName, generation) {
        calls.push(`${objectName}@${generation}`);
        return Buffer.from("one");
      },
    };
    const manifest: StorageManifest = {
      schemaVersion: 1,
      kind: "supabase-storage-inventory",
      runId: "run",
      startedAt: "2026-07-26T00:00:00Z",
      completedAt: "2026-07-26T00:01:00Z",
      sourceBucket: "files",
      completedFullScan: true,
      entries: [
        {
          kind: "object",
          sourceKey: "a",
          sourceVersionId: "v1",
          size: 3,
          sha256: hash("one"),
          destinationObject: "objects/a",
          destinationGeneration: "7",
        },
        {
          kind: "delete-marker",
          sourceKey: "deleted",
          sourceVersionId: "d1",
        },
      ],
    };
    assert.deepEqual(await verifyManifest(manifest, reader), {
      verifiedObjects: 1,
      verifiedBytes: 3,
    });
    assert.deepEqual(calls, ["objects/a@7"]);
  });

  it("fails on a missing object or checksum mismatch", async () => {
    const manifest: DatabaseManifest = {
      schemaVersion: 1,
      kind: "postgresql-custom-export",
      runId: "run",
      startedAt: "2026-07-26T00:00:00Z",
      completedAt: "2026-07-26T00:01:00Z",
      postgresMajor: 17,
      sha256: hash("expected"),
      size: 8,
      destinationObject: "database.dump",
      destinationGeneration: "9",
    };
    await assert.rejects(
      () =>
        verifyManifest(manifest, {
          async read() {
            return Buffer.from("corrupt!");
          },
        }),
      /checksum or size mismatch/,
    );
    await assert.rejects(
      () =>
        verifyManifest(manifest, {
          async read() {
            throw new Error("object missing");
          },
        }),
      /object missing/,
    );
  });

  it("refuses production-like restore targets", () => {
    assert.throws(
      () =>
        assertIsolatedRestoreTarget(
          "postgresql://restore:fixture@db.example.test/postgres",
          { RESTORE_TARGET_ISOLATED: "true" },
        ),
      /database name/,
    );
    assert.throws(
      () =>
        assertIsolatedRestoreTarget(
          "postgresql://restore:fixture@db.example.test/recovery_drill",
          {
            RESTORE_TARGET_ISOLATED: "true",
            RESTORE_TARGET_PROJECT_ID: "prod",
            PRODUCTION_PROJECT_ID: "prod",
          },
        ),
      /non-production/,
    );
    assert.doesNotThrow(() =>
      assertIsolatedRestoreTarget(
        "postgresql://restore:fixture@127.0.0.1/recovery_drill",
        { RESTORE_TARGET_ISOLATED: "true" },
      ),
    );
  });
});
