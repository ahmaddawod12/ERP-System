import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().trim().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  DATABASE_URL: z.string().trim().url(),
  DATABASE_SSL_MODE: z.enum(["disable", "require"]).default("require"),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(5).default(3),
  CLOUD_RUN_SERVICE_URL: z.string().trim().url().optional(),
  PUBSUB_ALLOWED_SERVICE_ACCOUNTS: z.string().default(""),
  PUBSUB_VERIFICATION_TOKEN: z.string().trim().min(24).optional(),
  SUPABASE_URL: z.string().trim().url(),
  SUPABASE_SECRET_KEY: z.string().trim().regex(/^sb_secret_[A-Za-z0-9_-]+$/),
  SUPABASE_STORAGE_BUCKET: z.literal("smart-job-company-files").default("smart-job-company-files"),
  SIGNED_DOWNLOAD_TTL_SECONDS: z.coerce.number().int().min(300).max(604_800).default(86_400),
  AWS_REGION: z.string().trim().regex(/^eu-[a-z]+-\d+$/),
  SES_FROM_EMAIL: z.string().trim().email().max(320),
  SES_FROM_NAME: z.string().trim().min(1).max(100).default("Smart-Job"),
  EMAIL_SEND_LEASE_SECONDS: z.coerce.number().int().min(10).max(300).default(60),
}).strict();

export type EmailWorkerConfig = ReturnType<typeof loadConfig>;

function safeServiceUrl(raw: string | undefined, field: string): URL | undefined {
  if (raw === undefined) return undefined;
  const url = new URL(raw);
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase());
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
      || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new TypeError(`${field} must be an exact HTTPS service origin (loopback HTTP is allowed locally)`);
  }
  return url;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(environment);
  const databaseUrl = new URL(parsed.DATABASE_URL);
  const isLoopbackDatabase = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    databaseUrl.hostname.toLowerCase(),
  );
  if (databaseUrl.protocol !== "postgresql:" && databaseUrl.protocol !== "postgres:") {
    throw new TypeError("DATABASE_URL must use PostgreSQL");
  }
  if (parsed.NODE_ENV === "production" && databaseUrl.username !== "smart_job_email") {
    throw new TypeError("Production DATABASE_URL must authenticate as smart_job_email");
  }
  if (parsed.DATABASE_SSL_MODE === "disable" && !isLoopbackDatabase) {
    throw new TypeError("DATABASE_SSL_MODE=disable is allowed only for a loopback database");
  }

  const supabaseUrl = safeServiceUrl(parsed.SUPABASE_URL, "SUPABASE_URL");
  if (!supabaseUrl) throw new TypeError("SUPABASE_URL is required");
  const serviceUrl = safeServiceUrl(parsed.CLOUD_RUN_SERVICE_URL, "CLOUD_RUN_SERVICE_URL");
  const allowedServiceAccounts = [...new Set(
    parsed.PUBSUB_ALLOWED_SERVICE_ACCOUNTS.split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )];
  if (allowedServiceAccounts.some(
    (email) => !/^[^@\s]+@[^@\s]+\.gserviceaccount\.com$/.test(email),
  )) {
    throw new TypeError("PUBSUB_ALLOWED_SERVICE_ACCOUNTS contains an invalid service-account email");
  }
  if (parsed.NODE_ENV === "production" && (!serviceUrl || allowedServiceAccounts.length === 0)) {
    throw new TypeError("Production requires CLOUD_RUN_SERVICE_URL and a Pub/Sub service-account allowlist");
  }
  if (!serviceUrl && !parsed.PUBSUB_VERIFICATION_TOKEN) {
    throw new TypeError("Configure Cloud Run OIDC or PUBSUB_VERIFICATION_TOKEN");
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    database: {
      connectionString: parsed.DATABASE_URL,
      ssl: parsed.DATABASE_SSL_MODE === "require" ? { rejectUnauthorized: true } : false,
      max: parsed.DATABASE_MAX_CONNECTIONS,
    },
    pubsub: {
      audience: serviceUrl?.origin,
      allowedServiceAccounts,
      sharedToken: parsed.PUBSUB_VERIFICATION_TOKEN,
    },
    storage: {
      baseUrl: supabaseUrl,
      secretKey: parsed.SUPABASE_SECRET_KEY,
      bucket: parsed.SUPABASE_STORAGE_BUCKET,
      signedUrlTtlSeconds: parsed.SIGNED_DOWNLOAD_TTL_SECONDS,
    },
    ses: {
      region: parsed.AWS_REGION,
      fromEmail: parsed.SES_FROM_EMAIL,
      fromName: parsed.SES_FROM_NAME,
    },
    sendLeaseSeconds: parsed.EMAIL_SEND_LEASE_SECONDS,
  } as const;
}
