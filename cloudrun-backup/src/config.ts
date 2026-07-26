import type { BackupMode } from "./types.js";

export class BackupConfigError extends Error {}

export interface BackupConfig {
  mode: BackupMode;
  backupBucket: string;
  databaseUrl?: string;
  source?: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
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
    const supabaseUrl = required(env, "SUPABASE_URL");
    const parsed = new URL(supabaseUrl);
    if (parsed.protocol !== "https:" && env.NODE_ENV === "production") {
      throw new BackupConfigError("SUPABASE_URL must use HTTPS in production");
    }
    source = {
      endpoint: new URL("/storage/v1/s3", parsed).toString(),
      region: String(env.SUPABASE_S3_REGION ?? "eu-central-1").trim(),
      bucket: String(
        env.SUPABASE_STORAGE_BUCKET ?? "smart-job-company-files",
      ).trim(),
      accessKeyId: required(env, "SUPABASE_S3_ACCESS_KEY_ID"),
      secretAccessKey: required(env, "SUPABASE_S3_SECRET_ACCESS_KEY"),
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
