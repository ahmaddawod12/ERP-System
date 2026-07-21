import { z } from "zod";

import { isVerifiedLocalPlatform, type LocalMarkerReader } from "./local-platform.js";

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
  SUPABASE_PUBLIC_URL: z.string().trim().url().optional(),
  SUPABASE_SECRET_KEY: z.string().trim().regex(/^sb_secret_[A-Za-z0-9_-]+$/),
  SUPABASE_STORAGE_BUCKET: z.literal("smart-job-company-files").default("smart-job-company-files"),
  SIGNED_DOWNLOAD_TTL_SECONDS: z.coerce.number().int().min(300).max(604_800).default(86_400),
  AWS_REGION: z.string().trim().regex(/^eu-[a-z]+-\d+$/),
  AWS_SES_ENDPOINT: z.string().trim().url().optional(),
  AWS_ACCESS_KEY_ID: z.string().trim().min(3).max(128).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().trim().min(16).max(256).optional(),
  SES_FROM_EMAIL: z.string().trim().email().max(320),
  SES_FROM_NAME: z.string().trim().min(1).max(100).default("Smart-Job"),
  EMAIL_SEND_LEASE_SECONDS: z.coerce.number().int().min(10).max(300).default(60),
}).strict();

export type EmailWorkerConfig = ReturnType<typeof loadConfig>;

function safeServiceUrl(
  raw: string | undefined,
  field: string,
  localServiceHost?: string,
  expectedPath = "/",
): URL | undefined {
  if (raw === undefined) return undefined;
  const url = new URL(raw);
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase());
  const localService = localServiceHost !== undefined
    && url.protocol === "http:"
    && url.hostname === localServiceHost;
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback) && !localService)
      || url.username || url.password || url.search || url.hash || url.pathname !== expectedPath) {
    throw new TypeError(`${field} must be an exact HTTPS service origin (loopback HTTP is allowed locally)`);
  }
  return url;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
  options: { readonly readLocalMarker?: LocalMarkerReader } = {},
) {
  const parsed = envSchema.parse({
    NODE_ENV: environment.NODE_ENV,
    HOST: environment.HOST,
    PORT: environment.PORT,
    DATABASE_URL: environment.DATABASE_URL,
    DATABASE_SSL_MODE: environment.DATABASE_SSL_MODE,
    DATABASE_MAX_CONNECTIONS: environment.DATABASE_MAX_CONNECTIONS,
    CLOUD_RUN_SERVICE_URL: environment.CLOUD_RUN_SERVICE_URL,
    PUBSUB_ALLOWED_SERVICE_ACCOUNTS: environment.PUBSUB_ALLOWED_SERVICE_ACCOUNTS,
    PUBSUB_VERIFICATION_TOKEN: environment.PUBSUB_VERIFICATION_TOKEN,
    SUPABASE_URL: environment.SUPABASE_URL,
    SUPABASE_PUBLIC_URL: environment.SUPABASE_PUBLIC_URL,
    SUPABASE_SECRET_KEY: environment.SUPABASE_SECRET_KEY,
    SUPABASE_STORAGE_BUCKET: environment.SUPABASE_STORAGE_BUCKET,
    SIGNED_DOWNLOAD_TTL_SECONDS: environment.SIGNED_DOWNLOAD_TTL_SECONDS,
    AWS_REGION: environment.AWS_REGION,
    AWS_SES_ENDPOINT: environment.AWS_SES_ENDPOINT,
    AWS_ACCESS_KEY_ID: environment.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: environment.AWS_SECRET_ACCESS_KEY,
    SES_FROM_EMAIL: environment.SES_FROM_EMAIL,
    SES_FROM_NAME: environment.SES_FROM_NAME,
    EMAIL_SEND_LEASE_SECONDS: environment.EMAIL_SEND_LEASE_SECONDS,
  });
  const localFlagsPresent = environment.SMART_JOB_DEPLOYMENT_ENV === "local"
    || environment.SMART_JOB_LOCAL_PLATFORM !== undefined
    || environment.LOCAL_PLATFORM_MARKER_PATH !== undefined
    || parsed.SUPABASE_PUBLIC_URL !== undefined
    || parsed.AWS_SES_ENDPOINT !== undefined;
  const verifiedLocalPlatform = isVerifiedLocalPlatform(
    environment,
    options.readLocalMarker,
  );
  if (localFlagsPresent && !verifiedLocalPlatform) {
    throw new TypeError("Local email overrides require the mounted local-platform marker");
  }
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
  const isLocalPlatformDatabase = verifiedLocalPlatform
    && databaseUrl.hostname === "supabase_db_smart-job-erp-local"
    && (databaseUrl.port === "5432" || databaseUrl.port === "");
  if (parsed.DATABASE_SSL_MODE === "disable" && !isLoopbackDatabase && !isLocalPlatformDatabase) {
    throw new TypeError("DATABASE_SSL_MODE=disable is allowed only for a loopback database");
  }

  const supabaseUrl = safeServiceUrl(
    parsed.SUPABASE_URL,
    "SUPABASE_URL",
    verifiedLocalPlatform ? "supabase_kong_smart-job-erp-local" : undefined,
  );
  if (!supabaseUrl) throw new TypeError("SUPABASE_URL is required");
  if (verifiedLocalPlatform && supabaseUrl.port !== "8000") {
    throw new TypeError("Local SUPABASE_URL must use Kong port 8000");
  }
  const publicSupabaseUrl = safeServiceUrl(parsed.SUPABASE_PUBLIC_URL, "SUPABASE_PUBLIC_URL");
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
  if (parsed.NODE_ENV === "production" && !verifiedLocalPlatform
      && (!serviceUrl || allowedServiceAccounts.length === 0)) {
    throw new TypeError("Production requires CLOUD_RUN_SERVICE_URL and a Pub/Sub service-account allowlist");
  }
  if (!serviceUrl && !parsed.PUBSUB_VERIFICATION_TOKEN) {
    throw new TypeError("Configure Cloud Run OIDC or PUBSUB_VERIFICATION_TOKEN");
  }
  const sesEndpoint = safeServiceUrl(
    parsed.AWS_SES_ENDPOINT,
    "AWS_SES_ENDPOINT",
    verifiedLocalPlatform ? "local-platform-adapter" : undefined,
    "/ses",
  );
  if (verifiedLocalPlatform) {
    if (
      publicSupabaseUrl === undefined
      || sesEndpoint === undefined
      || sesEndpoint.port !== "8090"
      || parsed.AWS_ACCESS_KEY_ID === undefined
      || parsed.AWS_SECRET_ACCESS_KEY === undefined
    ) {
      throw new TypeError(
        "Local email requires public Supabase, SES adapter, and local AWS credential settings",
      );
    }
  } else if (
    parsed.SUPABASE_PUBLIC_URL !== undefined
    || parsed.AWS_SES_ENDPOINT !== undefined
    || parsed.AWS_ACCESS_KEY_ID !== undefined
    || parsed.AWS_SECRET_ACCESS_KEY !== undefined
  ) {
    throw new TypeError("Local email provider settings are forbidden outside the local platform");
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
      ...(publicSupabaseUrl === undefined ? {} : { publicBaseUrl: publicSupabaseUrl }),
      secretKey: parsed.SUPABASE_SECRET_KEY,
      bucket: parsed.SUPABASE_STORAGE_BUCKET,
      signedUrlTtlSeconds: parsed.SIGNED_DOWNLOAD_TTL_SECONDS,
    },
    ses: {
      region: parsed.AWS_REGION,
      fromEmail: parsed.SES_FROM_EMAIL,
      fromName: parsed.SES_FROM_NAME,
      ...(sesEndpoint === undefined
        ? {}
        : {
            endpoint: sesEndpoint,
            credentials: {
              accessKeyId: parsed.AWS_ACCESS_KEY_ID!,
              secretAccessKey: parsed.AWS_SECRET_ACCESS_KEY!,
            },
          }),
    },
    sendLeaseSeconds: parsed.EMAIL_SEND_LEASE_SECONDS,
  } as const;
}
