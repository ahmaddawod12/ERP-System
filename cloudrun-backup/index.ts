import { loadBackupConfig } from "./src/config.js";
import { runDatabaseBackup } from "./src/database-runner.js";
import { createGcsDestination } from "./src/gcs-destination.js";
import { createS3Source } from "./src/s3-source.js";
import { runStorageBackup } from "./src/storage-runner.js";

function log(event: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({
    ...cloudLoggingTraceFields(),
    ...event,
  })}\n`);
}

async function main(): Promise<void> {
  return withTaskSpan(
    "backup.run",
    { "app.operation": "backup.run" },
    async () => {
  const config = loadBackupConfig();
  const destination = createGcsDestination(config.backupBucket);
  if (config.mode === "database") {
    const manifest = await runDatabaseBackup({
      databaseUrl: config.databaseUrl!,
      destination,
    });
    log({
      backupCompleted: true,
      backupKind: "database",
      runId: manifest.runId,
      size: manifest.size,
    });
    return;
  }

  const result = await runStorageBackup({
    source: createS3Source(config.source!),
    destination,
    sourceBucket: config.source!.bucket,
    maxPages: config.maxPagesPerRun,
    rpoMinutes: config.rpoMinutes,
  });
  log({
    backupCompleted: true,
    backupKind: "storage",
    runId: result.manifest.runId,
    objectVersionCount: result.manifest.entries.length,
    completedFullScan: result.manifest.completedFullScan,
  });
  if (result.rpoBreached) {
    log({
      backupRpoBreached: true,
      backupKind: "storage",
      rpoMinutes: config.rpoMinutes,
    });
    process.exitCode = 1;
  }
    },
  );
}

main().catch((error: unknown) => {
  log({
    backupFailure: true,
    message: error instanceof Error ? error.message : "Unknown backup failure",
  });
  process.exitCode = 1;
});
import {
  cloudLoggingTraceFields,
  withTaskSpan,
} from "@smart-job/observability";
