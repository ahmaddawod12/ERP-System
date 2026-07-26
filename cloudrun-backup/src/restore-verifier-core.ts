import { createHash } from "node:crypto";

import type {
  DatabaseManifest,
  StorageManifest,
} from "./types.js";

export interface ExactObjectReader {
  read(objectName: string, generation: string): Promise<Uint8Array>;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function parseManifest(
  value: unknown,
): StorageManifest | DatabaseManifest {
  if (!value || typeof value !== "object") {
    throw new Error("Backup manifest must be an object");
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== 1 ||
    (candidate.kind !== "supabase-storage-inventory" &&
      candidate.kind !== "postgresql-custom-export")
  ) {
    throw new Error("Unsupported backup manifest schema");
  }
  return value as StorageManifest | DatabaseManifest;
}

export async function verifyManifest(
  manifest: StorageManifest | DatabaseManifest,
  reader: ExactObjectReader,
): Promise<{ verifiedObjects: number; verifiedBytes: number }> {
  if (manifest.kind === "postgresql-custom-export") {
    const bytes = await reader.read(
      manifest.destinationObject,
      manifest.destinationGeneration,
    );
    if (bytes.byteLength !== manifest.size || sha256(bytes) !== manifest.sha256) {
      throw new Error("Database export checksum or size mismatch");
    }
    return { verifiedObjects: 1, verifiedBytes: bytes.byteLength };
  }

  let verifiedObjects = 0;
  let verifiedBytes = 0;
  for (const entry of manifest.entries) {
    if (entry.kind === "delete-marker") continue;
    if (
      !entry.destinationObject ||
      !entry.destinationGeneration ||
      !entry.sha256 ||
      entry.size === undefined
    ) {
      throw new Error("Storage manifest object entry is incomplete");
    }
    const bytes = await reader.read(
      entry.destinationObject,
      entry.destinationGeneration,
    );
    if (bytes.byteLength !== entry.size || sha256(bytes) !== entry.sha256) {
      throw new Error("Storage backup checksum or size mismatch");
    }
    verifiedObjects += 1;
    verifiedBytes += bytes.byteLength;
  }
  return { verifiedObjects, verifiedBytes };
}

export function assertIsolatedRestoreTarget(
  targetDatabaseUrl: string,
  env: NodeJS.ProcessEnv,
): void {
  if (env.RESTORE_TARGET_ISOLATED !== "true") {
    throw new Error("RESTORE_TARGET_ISOLATED=true is required");
  }
  const target = new URL(targetDatabaseUrl);
  const databaseName = target.pathname.slice(1);
  if (!/(restore|recovery|drill|test)/i.test(databaseName)) {
    throw new Error(
      "Restore target database name must identify an isolated restore or drill",
    );
  }
  const targetProject = String(env.RESTORE_TARGET_PROJECT_ID ?? "").trim();
  const productionProject = String(env.PRODUCTION_PROJECT_ID ?? "").trim();
  const loopback = new Set(["127.0.0.1", "localhost", "::1"]).has(
    target.hostname,
  );
  if (!loopback && (!targetProject || targetProject === productionProject)) {
    throw new Error(
      "A non-production RESTORE_TARGET_PROJECT_ID is required for remote restores",
    );
  }
}
