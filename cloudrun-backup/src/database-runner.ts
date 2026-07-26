import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";

import type {
  BackupDestination,
  DatabaseManifest,
} from "./types.js";

function runPgDump(databaseUrl: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pg_dump",
      [
        "--format=custom",
        "--compress=9",
        "--no-owner",
        "--no-acl",
        `--file=${outputPath}`,
        databaseUrl,
      ],
      {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4_096);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump failed with exit code ${code}: ${stderr}`));
    });
  });
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

export async function runDatabaseBackup(input: {
  databaseUrl: string;
  destination: BackupDestination;
  now?: Date;
  dump?: (databaseUrl: string, outputPath: string) => Promise<void>;
}): Promise<DatabaseManifest> {
  const now = input.now ?? new Date();
  const startedAt = now.toISOString();
  const runId = randomUUID();
  const tempRoot = await mkdtemp(join(tmpdir(), "smart-job-db-backup-"));
  const outputPath = join(tempRoot, "database.dump");
  try {
    await (input.dump ?? runPgDump)(input.databaseUrl, outputPath);
    const [size, sha256] = await Promise.all([
      stat(outputPath).then((value) => value.size),
      sha256File(outputPath),
    ]);
    const destinationObject = `database/exports/${startedAt.slice(0, 10)}/${runId}.dump`;
    const stored = await input.destination.putFileCreateOnly({
      localPath: outputPath,
      objectName: destinationObject,
      contentType: "application/octet-stream",
      metadata: { sha256, postgresMajor: "17" },
    });
    const manifest: DatabaseManifest = {
      schemaVersion: 1,
      kind: "postgresql-custom-export",
      runId,
      startedAt,
      completedAt: (input.now ?? new Date()).toISOString(),
      postgresMajor: 17,
      sha256,
      size,
      destinationObject,
      destinationGeneration: stored.generation,
    };
    await input.destination.putJsonCreateOnly(
      `database/manifests/${startedAt.slice(0, 10)}/${runId}.json`,
      manifest,
    );
    return manifest;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
