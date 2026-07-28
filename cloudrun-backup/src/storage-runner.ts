import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

import type {
  BackupDestination,
  StorageCheckpoint,
  StorageManifest,
  StorageManifestEntry,
  VersionedSource,
} from "./types.js";

export interface StorageRunResult {
  manifest: StorageManifest;
  manifestObject: string;
  checkpoint: StorageCheckpoint;
  rpoBreached: boolean;
}

function objectName(
  sourceBucket: string,
  key: string,
  versionId: string,
  eTag?: string,
): string {
  const identity = createHash("sha256")
    .update(JSON.stringify([sourceBucket, key, versionId, eTag ?? ""]))
    .digest("hex");
  return `storage/objects/${identity.slice(0, 2)}/${identity}`;
}

async function copyVersion(input: {
  source: VersionedSource;
  destination: BackupDestination;
  sourceBucket: string;
  key: string;
  versionId: string;
  eTag?: string;
  expectedSize: number;
  tempRoot: string;
}): Promise<StorageManifestEntry> {
  const sourceObject = await input.source.getVersion({
    bucket: input.sourceBucket,
    key: input.key,
    versionId: input.versionId,
  });
  const identity = createHash("sha256")
    .update(JSON.stringify([input.key, input.versionId]))
    .digest("hex");
  const localPath = join(input.tempRoot, identity);
  const contentHash = createHash("sha256");
  const hashingBody = async function* (): AsyncIterable<Uint8Array> {
    for await (const chunk of sourceObject.body) {
      contentHash.update(chunk);
      yield chunk;
    }
  };
  await pipeline(hashingBody(), createWriteStream(localPath, { flags: "wx" }));
  const actualSize = (await stat(localPath)).size;
  if (actualSize !== input.expectedSize) {
    throw new Error("Source object size changed during versioned backup");
  }
  const sha256 = contentHash.digest("hex");
  const destinationObject = objectName(
    input.sourceBucket,
    input.key,
    input.versionId,
    input.eTag,
  );

  let metadata;
  try {
    metadata = await input.destination.putFileCreateOnly({
      localPath,
      objectName: destinationObject,
      contentType: "application/octet-stream",
      metadata: {
        sha256,
        sourceBucket: input.sourceBucket,
        sourceETag: input.eTag ?? "",
        sourceVersionId: input.versionId,
      },
    });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 412) throw error;
    metadata = await input.destination.getObjectMetadata(destinationObject);
    if (metadata.sha256 !== sha256) {
      throw new Error(
        "Existing backup object checksum conflicts with the source version",
      );
    }
  } finally {
    await rm(localPath, { force: true });
  }

  return {
    kind: "object",
    sourceKey: input.key,
    sourceVersionId: input.versionId,
    ...(input.eTag ? { sourceETag: input.eTag } : {}),
    size: actualSize,
    sha256,
    destinationObject,
    destinationGeneration: metadata.generation,
  };
}

export async function runStorageBackup(input: {
  source: VersionedSource;
  destination: BackupDestination;
  sourceBucket: string;
  maxPages: number;
  rpoMinutes: number;
  now?: Date;
}): Promise<StorageRunResult> {
  const now = input.now ?? new Date();
  const runId = randomUUID();
  const startedAt = now.toISOString();
  const loaded = await input.destination.loadCheckpoint();
  const previous = loaded.checkpoint;
  let keyMarker = previous?.keyMarker;
  let versionIdMarker = previous?.versionIdMarker;
  let completedFullScan = false;
  const entries: StorageManifestEntry[] = [];
  const tempRoot = join(tmpdir(), `smart-job-backup-${runId}`);
  await mkdir(tempRoot, { recursive: false });

  try {
    for (let pageNumber = 0; pageNumber < input.maxPages; pageNumber += 1) {
      const page = await input.source.listVersions({
        bucket: input.sourceBucket,
        ...(keyMarker ? { keyMarker } : {}),
        ...(versionIdMarker ? { versionIdMarker } : {}),
      });

      for (const version of page.versions) {
        entries.push(
          await copyVersion({
            source: input.source,
            destination: input.destination,
            sourceBucket: input.sourceBucket,
            key: version.key,
            versionId: version.versionId,
            ...(version.eTag ? { eTag: version.eTag } : {}),
            expectedSize: version.size,
            tempRoot,
          }),
        );
      }
      entries.push(
        ...page.deleteMarkers.map((marker) => ({
          kind: "delete-marker" as const,
          sourceKey: marker.key,
          sourceVersionId: marker.versionId,
        })),
      );

      if (!page.truncated) {
        completedFullScan = true;
        keyMarker = undefined;
        versionIdMarker = undefined;
        break;
      }
      if (!page.nextKeyMarker) {
        throw new Error("Truncated GCS inventory omitted its continuation token");
      }
      keyMarker = page.nextKeyMarker;
      versionIdMarker = page.nextVersionIdMarker;
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  const completedAt = (input.now ?? new Date()).toISOString();
  const manifest: StorageManifest = {
    schemaVersion: 1,
    kind: "gcs-storage-inventory",
    runId,
    startedAt,
    completedAt,
    sourceBucket: input.sourceBucket,
    completedFullScan,
    entries,
  };
  const manifestObject = `storage/manifests/${startedAt.slice(0, 10)}/${runId}.json`;
  await input.destination.putJsonCreateOnly(manifestObject, manifest);

  const scanStartedAt =
    previous?.keyMarker || previous?.versionIdMarker
      ? previous.scanStartedAt
      : startedAt;
  const checkpoint: StorageCheckpoint = {
    schemaVersion: 1,
    sequence: (previous?.sequence ?? 0) + 1,
    scanStartedAt: completedFullScan ? completedAt : scanStartedAt,
    updatedAt: completedAt,
    ...(completedFullScan
      ? { lastFullScanAt: completedAt }
      : {
          ...(previous?.lastFullScanAt
            ? { lastFullScanAt: previous.lastFullScanAt }
            : {}),
          ...(keyMarker ? { keyMarker } : {}),
          ...(versionIdMarker ? { versionIdMarker } : {}),
        }),
  };
  await input.destination.saveCheckpoint(checkpoint, loaded.generation);
  const scanAge =
    now.getTime() - new Date(completedFullScan ? completedAt : scanStartedAt).getTime();
  return {
    manifest,
    manifestObject,
    checkpoint,
    rpoBreached:
      !completedFullScan && scanAge > input.rpoMinutes * 60 * 1_000,
  };
}
