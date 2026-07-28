import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Storage } from "@google-cloud/storage";

import {
  assertIsolatedRestoreTarget,
  parseManifest,
  verifyManifest,
  type ExactObjectReader,
} from "./src/restore-verifier-core.js";

function required(name: string): string {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function runPgRestore(path: string, targetDatabaseUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pg_restore",
      [
        "--exit-on-error",
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-acl",
        `--dbname=${targetDatabaseUrl}`,
        path,
      ],
      { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4_096);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_restore failed with exit code ${code}: ${stderr}`));
    });
  });
}

async function main(): Promise<void> {
  const bucketName = required("BACKUP_BUCKET");
  const manifestObject = required("BACKUP_MANIFEST_OBJECT");
  const manifestGeneration = String(
    process.env.BACKUP_MANIFEST_GENERATION ?? "",
  ).trim();
  const bucket = new Storage().bucket(bucketName);
  const file = bucket.file(manifestObject, {
    ...(manifestGeneration ? { generation: manifestGeneration } : {}),
  });
  const [manifestBytes] = await file.download();
  const manifest = parseManifest(JSON.parse(manifestBytes.toString("utf8")));
  const reader: ExactObjectReader = {
    async read(objectName, generation) {
      const [bytes] = await bucket.file(objectName, { generation }).download();
      return bytes;
    },
  };
  const verified = await verifyManifest(manifest, reader);

  const targetDatabaseUrl = String(
    process.env.RESTORE_TARGET_DATABASE_URL ?? "",
  ).trim();
  if (targetDatabaseUrl) {
    if (manifest.kind !== "postgresql-custom-export") {
      throw new Error("Only a database export can be restored to PostgreSQL");
    }
    assertIsolatedRestoreTarget(targetDatabaseUrl, process.env);
    const bytes = await reader.read(
      manifest.destinationObject,
      manifest.destinationGeneration,
    );
    const tempRoot = await mkdtemp(join(tmpdir(), "smart-job-restore-"));
    try {
      const dumpPath = join(tempRoot, "database.dump");
      await writeFile(dumpPath, bytes, { flag: "wx", mode: 0o600 });
      await runPgRestore(dumpPath, targetDatabaseUrl);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }

  process.stdout.write(
    `${JSON.stringify({
      restoreVerificationCompleted: true,
      manifestKind: manifest.kind,
      ...verified,
      databaseRestored: Boolean(targetDatabaseUrl),
    })}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      restoreVerificationFailure: true,
      message:
        error instanceof Error ? error.message : "Unknown restore verification failure",
    })}\n`,
  );
  process.exitCode = 1;
});
