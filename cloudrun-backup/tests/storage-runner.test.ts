import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";

import { runStorageBackup } from "../src/storage-runner.js";
import type {
  BackupDestination,
  DatabaseManifest,
  DestinationObjectMetadata,
  StorageCheckpoint,
  StorageManifest,
  VersionPage,
  VersionedSource,
} from "../src/types.js";

class FakeDestination implements BackupDestination {
  checkpoint?: StorageCheckpoint;
  checkpointGeneration?: string;
  objects = new Map<string, { sha256?: string; generation: string }>();
  manifests: Array<StorageManifest | DatabaseManifest> = [];

  async loadCheckpoint() {
    return {
      ...(this.checkpoint ? { checkpoint: this.checkpoint } : {}),
      ...(this.checkpointGeneration
        ? { generation: this.checkpointGeneration }
        : {}),
    };
  }

  async saveCheckpoint(
    checkpoint: StorageCheckpoint,
    expectedGeneration?: string,
  ) {
    assert.equal(expectedGeneration, this.checkpointGeneration);
    this.checkpoint = checkpoint;
    this.checkpointGeneration = String(
      Number(this.checkpointGeneration ?? "0") + 1,
    );
    return this.checkpointGeneration;
  }

  async putFileCreateOnly(input: {
    localPath: string;
    objectName: string;
    contentType: string;
    metadata: Record<string, string>;
  }): Promise<DestinationObjectMetadata> {
    if (this.objects.has(input.objectName)) {
      throw Object.assign(new Error("precondition"), { code: 412 });
    }
    const stored = {
      generation: String(this.objects.size + 1),
      ...(input.metadata.sha256 ? { sha256: input.metadata.sha256 } : {}),
    };
    this.objects.set(input.objectName, stored);
    return stored;
  }

  async getObjectMetadata(objectName: string) {
    const value = this.objects.get(objectName);
    if (!value) throw new Error("missing");
    return value;
  }

  async putJsonCreateOnly(
    _objectName: string,
    value: StorageManifest | DatabaseManifest,
  ) {
    this.manifests.push(value);
    return { generation: String(this.manifests.length) };
  }
}

class FakeSource implements VersionedSource {
  constructor(
    private readonly pages: VersionPage[],
    private readonly bodies: Record<string, string>,
  ) {}

  listCalls: Array<{ keyMarker?: string; versionIdMarker?: string }> = [];

  async listVersions(input: {
    bucket: string;
    keyMarker?: string;
    versionIdMarker?: string;
  }) {
    this.listCalls.push({
      ...(input.keyMarker ? { keyMarker: input.keyMarker } : {}),
      ...(input.versionIdMarker
        ? { versionIdMarker: input.versionIdMarker }
        : {}),
    });
    const page = this.pages.shift();
    if (!page) throw new Error("unexpected page");
    return page;
  }

  async getVersion(input: {
    bucket: string;
    key: string;
    versionId: string;
  }) {
    const body = this.bodies[`${input.key}:${input.versionId}`];
    if (body === undefined) throw new Error("credential denied or missing");
    return { body: Readable.from([Buffer.from(body)]) };
  }
}

function page(
  versions: VersionPage["versions"],
  options: Partial<VersionPage> = {},
): VersionPage {
  return {
    versions,
    deleteMarkers: options.deleteMarkers ?? [],
    truncated: options.truncated ?? false,
    ...(options.nextKeyMarker
      ? { nextKeyMarker: options.nextKeyMarker }
      : {}),
    ...(options.nextVersionIdMarker
      ? { nextVersionIdMarker: options.nextVersionIdMarker }
      : {}),
  };
}

describe("storage backup", () => {
  it("resumes scans, records delete markers, and completes without propagating deletion", async () => {
    const destination = new FakeDestination();
    const first = await runStorageBackup({
      source: new FakeSource(
        [
          page(
            [{ key: "a.pdf", versionId: "v1", eTag: "e1", size: 3 }],
            {
              truncated: true,
              nextKeyMarker: "a.pdf",
              nextVersionIdMarker: "v1",
            },
          ),
        ],
        { "a.pdf:v1": "one" },
      ),
      destination,
      sourceBucket: "files",
      maxPages: 1,
      rpoMinutes: 15,
      now: new Date("2026-07-26T10:00:00Z"),
    });
    assert.equal(first.manifest.completedFullScan, false);
    assert.equal(first.checkpoint.keyMarker, "a.pdf");

    const source = new FakeSource(
      [
        page([], {
          deleteMarkers: [{ key: "old.pdf", versionId: "delete-1" }],
        }),
      ],
      {},
    );
    const second = await runStorageBackup({
      source,
      destination,
      sourceBucket: "files",
      maxPages: 1,
      rpoMinutes: 15,
      now: new Date("2026-07-26T10:05:00Z"),
    });
    assert.deepEqual(source.listCalls, [
      { keyMarker: "a.pdf", versionIdMarker: "v1" },
    ]);
    assert.equal(second.manifest.completedFullScan, true);
    assert.equal(second.manifest.entries[0]?.kind, "delete-marker");
    assert.equal(destination.objects.size, 1);
  });

  it("replays an already copied immutable version only after checksum verification", async () => {
    const destination = new FakeDestination();
    const inputs = () =>
      new FakeSource(
        [page([{ key: "same", versionId: "v1", eTag: "e1", size: 4 }])],
        { "same:v1": "data" },
      );
    await runStorageBackup({
      source: inputs(),
      destination,
      sourceBucket: "files",
      maxPages: 1,
      rpoMinutes: 15,
    });
    const replay = await runStorageBackup({
      source: inputs(),
      destination,
      sourceBucket: "files",
      maxPages: 1,
      rpoMinutes: 15,
    });
    assert.equal(replay.manifest.entries[0]?.kind, "object");
    assert.equal(destination.objects.size, 1);
  });

  it("copies changed versions separately and fails closed on checksum conflicts", async () => {
    const destination = new FakeDestination();
    const run = async (versionId: string, body: string) =>
      runStorageBackup({
        source: new FakeSource(
          [page([{ key: "same", versionId, eTag: versionId, size: body.length }])],
          { [`same:${versionId}`]: body },
        ),
        destination,
        sourceBucket: "files",
        maxPages: 1,
        rpoMinutes: 15,
      });
    await run("v1", "one");
    await run("v2", "two");
    assert.equal(destination.objects.size, 2);

    const stored = [...destination.objects.values()][0]!;
    stored.sha256 = "conflict";
    await assert.rejects(() => run("v1", "one"), /checksum conflicts/);
  });

  it("does not advance the checkpoint when source access fails", async () => {
    const destination = new FakeDestination();
    await assert.rejects(
      () =>
        runStorageBackup({
          source: new FakeSource(
            [page([{ key: "private", versionId: "v1", size: 1 }])],
            {},
          ),
          destination,
          sourceBucket: "files",
          maxPages: 1,
          rpoMinutes: 15,
        }),
      /credential denied/,
    );
    assert.equal(destination.checkpoint, undefined);
    assert.equal(destination.manifests.length, 0);
  });
});
