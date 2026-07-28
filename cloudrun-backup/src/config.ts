import type { BackupMode } from "./types.js";

export class BackupConfigError extends Error {}

export interface BackupConfig {
  mode: BackupMode;
  backupBucket: string;
  databaseUrl?: string;
  source?: {
    projectId?: string;
    apiEndpoint?: string;
    bucket: string;
  };
  rpoMinutes: number;
  maxPagesPerRun: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = String(env[name] ?? "").trim();
  if (!value) throw new BackupConfigError(`${name} is required`);
  return value;
}

function boundedInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new BackupConfigError(
      `${name} must be an integer from ${minimum} through ${maximum}`,
    );
  }
  return value;
}

export function loadBackupConfig(
  env: NodeJS.ProcessEnv = process.env,
): BackupConfig {
  const mode = String(env.BACKUP_MODE ?? "storage").trim();
  if (mode !== "storage" && mode !== "database") {
    throw new BackupConfigError("BACKUP_MODE must be storage or database");
  }

  const backupBucket = required(env, "BACKUP_BUCKET");
  const rpoMinutes = boundedInteger(env, "BACKUP_RPO_MINUTES", 15, 5, 60);
  const maxPagesPerRun = boundedInteger(
    env,
    "BACKUP_MAX_PAGES_PER_RUN",
    100,
    1,
    1_000,
  );

  const databaseUrl =
    mode === "database" ? required(env, "BACKUP_DATABASE_URL") : undefined;
  let source: BackupConfig["source"];
  if (mode === "storage") {
    const projectId = String(env.GCS_PROJECT_ID || "").trim();
    const apiEndpoint = String(env.GCS_API_ENDPOINT || "").trim();
    if (apiEndpoint && env.NODE_ENV === "production") {
      throw new BackupConfigError("GCS_API_ENDPOINT is forbidden in production");
    }
    source = {
      bucket: required(env, "COMPANY_FILES_BUCKET"),
      ...(projectId ? { projectId } : {}),
      ...(apiEndpoint ? { apiEndpoint } : {}),
    };
  }

  return {
    mode,
    backupBucket,
    ...(databaseUrl ? { databaseUrl } : {}),
    ...(source ? { source } : {}),
    rpoMinutes,
    maxPagesPerRun,
  };
}
