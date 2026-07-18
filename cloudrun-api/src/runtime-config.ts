import { z } from "zod";

export const MAX_DATABASE_POOL_SIZE = 5;

const integerValue = (name: string, minimum: number, maximum: number) =>
  z
    .string({ error: `${name} must be an integer` })
    .trim()
    .regex(/^\d+$/, `${name} must be an integer`)
    .transform(Number)
    .pipe(z.number().int().min(minimum).max(maximum));

const booleanValue = (name: string) =>
  z
    .string({ error: `${name} must be true or false` })
    .trim()
    .toLowerCase()
    .refine((value) => ["true", "false", "1", "0", "on", "off"].includes(value), {
      message: `${name} must be true or false`,
    })
    .transform((value) => ["true", "1", "on"].includes(value));

const runtimeEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().trim().min(1, "DATABASE_URL is required"),
  DATABASE_SSL_MODE: z.enum(["disable", "require"]).default("require"),
  DATABASE_SSL_REJECT_UNAUTHORIZED: booleanValue("DATABASE_SSL_REJECT_UNAUTHORIZED")
    .default(true),
  DATABASE_SSL_CA: z.string().default(""),
  DATABASE_MAX_CONNECTIONS: integerValue(
    "DATABASE_MAX_CONNECTIONS",
    1,
    MAX_DATABASE_POOL_SIZE,
  ).default(MAX_DATABASE_POOL_SIZE),
  DATABASE_IDLE_TIMEOUT_MS: integerValue(
    "DATABASE_IDLE_TIMEOUT_MS",
    0,
    60_000,
  ).default(30_000),
  DATABASE_CONNECT_TIMEOUT_MS: integerValue(
    "DATABASE_CONNECT_TIMEOUT_MS",
    100,
    12_000,
  ).default(10_000),
  SUPABASE_URL: z.url("SUPABASE_URL must be a valid URL"),
  SUPABASE_PUBLISHABLE_KEY: z.string()
    .trim()
    .min(20, "SUPABASE_PUBLISHABLE_KEY is required")
    .regex(/^sb_publishable_[A-Za-z0-9_-]+$/, "SUPABASE_PUBLISHABLE_KEY is invalid"),
  SUPABASE_SECRET_KEY: z.string()
    .trim()
    .min(20, "SUPABASE_SECRET_KEY is required")
    .regex(/^sb_secret_[A-Za-z0-9_-]+$/, "SUPABASE_SECRET_KEY is invalid"),
  SUPABASE_STORAGE_BUCKET: z.literal("smart-job-company-files")
    .default("smart-job-company-files"),
  SUPABASE_JWT_ISSUER: z.url("SUPABASE_JWT_ISSUER must be a valid URL").optional(),
  SUPABASE_JWT_AUDIENCE: z.string().trim().min(1).default("authenticated"),
  WEB_SESSION_ENCRYPTION_KEY_BASE64: z.string()
    .trim()
    .min(1, "WEB_SESSION_ENCRYPTION_KEY_BASE64 is required"),
  WEB_SESSION_ENCRYPTION_KEY_VERSION: z.string()
    .trim()
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
      "WEB_SESSION_ENCRYPTION_KEY_VERSION is invalid",
    ),
  DOCUMENT_PUBSUB_PROJECT_ID: z.string()
    .trim()
    .regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, "DOCUMENT_PUBSUB_PROJECT_ID is invalid")
    .optional(),
  DOCUMENT_PREVIEW_TOPIC: z.string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z0-9._~+%-]{2,254}$/, "DOCUMENT_PREVIEW_TOPIC is invalid")
    .optional(),
  DOCUMENT_GENERATE_TOPIC: z.string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z0-9._~+%-]{2,254}$/, "DOCUMENT_GENERATE_TOPIC is invalid")
    .optional(),
  EMAIL_DELIVERY_TOPIC: z.string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z0-9._~+%-]{2,254}$/, "EMAIL_DELIVERY_TOPIC is invalid")
    .optional(),
  TAX_SUBMISSION_MODE: z.enum(["disabled", "sandbox", "production"])
    .default("disabled"),
  TAX_GATEWAY_URL: z.url("TAX_GATEWAY_URL must be a valid URL").optional(),
  TAX_GATEWAY_AUDIENCE: z.url("TAX_GATEWAY_AUDIENCE must be a valid URL").optional(),
  TAX_GATEWAY_TIMEOUT_MS: integerValue("TAX_GATEWAY_TIMEOUT_MS", 1_000, 10_000)
    .default(8_000),
  INTERNAL_API_AUDIENCE: z.url("INTERNAL_API_AUDIENCE must be a valid URL").optional(),
  INTERNAL_CALLER_SERVICE_ACCOUNTS: z.string().trim().min(1).optional(),
}).superRefine((environment, context) => {
  const fields = [
    environment.DOCUMENT_PUBSUB_PROJECT_ID,
    environment.DOCUMENT_PREVIEW_TOPIC,
    environment.DOCUMENT_GENERATE_TOPIC,
    environment.EMAIL_DELIVERY_TOPIC,
  ];
  const supplied = fields.filter((value) => value !== undefined).length;
  if (supplied !== 0 && supplied !== fields.length) {
    context.addIssue({
      code: "custom",
      path: ["DOCUMENT_PUBSUB_PROJECT_ID"],
      message: "all document Pub/Sub settings must be supplied together",
    });
  }
  if (environment.NODE_ENV === "production" && supplied !== fields.length) {
    context.addIssue({
      code: "custom",
      path: ["DOCUMENT_PUBSUB_PROJECT_ID"],
      message: "document and email Pub/Sub settings are required in production",
    });
  }
  const taxGatewayFields = [environment.TAX_GATEWAY_URL, environment.TAX_GATEWAY_AUDIENCE];
  const taxGatewaySupplied = taxGatewayFields.filter((value) => value !== undefined).length;
  if (taxGatewaySupplied !== 0 && taxGatewaySupplied !== taxGatewayFields.length) {
    context.addIssue({
      code: "custom",
      path: ["TAX_GATEWAY_URL"],
      message: "tax gateway URL and audience must be supplied together",
    });
  }
  if (environment.TAX_SUBMISSION_MODE !== "disabled" && taxGatewaySupplied !== taxGatewayFields.length) {
    context.addIssue({
      code: "custom",
      path: ["TAX_GATEWAY_URL"],
      message: "tax gateway settings are required when tax submission is enabled",
    });
  }
  const internalFields = [
    environment.INTERNAL_API_AUDIENCE,
    environment.INTERNAL_CALLER_SERVICE_ACCOUNTS,
  ];
  const internalSupplied = internalFields.filter((value) => value !== undefined).length;
  if (internalSupplied !== 0 && internalSupplied !== internalFields.length) {
    context.addIssue({
      code: "custom",
      path: ["INTERNAL_API_AUDIENCE"],
      message: "internal audience and caller service accounts must be supplied together",
    });
  }
});

export interface DatabaseRuntimeConfig {
  readonly connectionString: string;
  readonly ssl: false | {
    readonly rejectUnauthorized: boolean;
    readonly ca?: string;
  };
  readonly maxConnections: number;
  readonly idleTimeoutMillis: number;
  readonly connectionTimeoutMillis: number;
}

export interface SupabaseJwtRuntimeConfig {
  readonly issuer: string;
  readonly jwksUrl: URL;
  readonly audiences: readonly string[];
}

export interface SupabaseAuthRuntimeConfig {
  readonly baseUrl: URL;
  readonly publishableKey: string;
}

export interface SupabaseStorageRuntimeConfig {
  readonly baseUrl: URL;
  readonly secretKey: string;
  readonly bucketId: string;
}

export interface WebSessionEncryptionRuntimeConfig {
  readonly key: Buffer;
  readonly keyVersion: string;
}

export interface DocumentDispatchRuntimeConfig {
  readonly projectId: string;
  readonly previewTopic: string;
  readonly generateTopic: string;
  readonly emailTopic: string;
}

export interface InternalIdentityRuntimeConfig {
  readonly audience: string;
  readonly allowedServiceAccounts: readonly string[];
}

export interface TaxSubmissionRuntimeConfig {
  readonly mode: "disabled" | "sandbox" | "production";
  readonly gateway?: {
    readonly url: URL;
    readonly audience: string;
    readonly timeoutMs: number;
  };
}

export interface ApiRuntimeConfig {
  readonly database: DatabaseRuntimeConfig;
  readonly supabaseAuth: SupabaseAuthRuntimeConfig;
  readonly supabaseJwt: SupabaseJwtRuntimeConfig;
  readonly supabaseStorage: SupabaseStorageRuntimeConfig;
  readonly webSessionEncryption: WebSessionEncryptionRuntimeConfig;
  readonly documentDispatch?: DocumentDispatchRuntimeConfig;
  readonly internalIdentity?: InternalIdentityRuntimeConfig;
  readonly taxSubmission: TaxSubmissionRuntimeConfig;
}

export class RuntimeConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid API runtime configuration: ${issues.join("; ")}`);
    this.name = "RuntimeConfigError";
    this.issues = issues;
  }
}

function normalizedUrl(value: string): URL {
  const parsed = new URL(value);
  const pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = pathname || "/";
  return parsed;
}

function ensureSafeSupabaseUrl(url: URL, field: string, expectedPath: string): void {
  const isLoopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    url.hostname.toLowerCase(),
  );
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new RuntimeConfigError([
      `${field} must use HTTPS unless it targets the local loopback interface`,
    ]);
  }
  if (
    url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname !== expectedPath
  ) {
    throw new RuntimeConfigError([
      `${field} must be an exact URL for ${expectedPath} without credentials, query parameters, or fragments`,
    ]);
  }
}

function parseDatabaseUrl(value: string, sslMode: "disable" | "require"): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new RuntimeConfigError(["DATABASE_URL must be a valid PostgreSQL URL"]);
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new RuntimeConfigError(["DATABASE_URL must use postgres:// or postgresql://"]);
  }
  const isLoopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    parsed.hostname.toLowerCase(),
  );
  if (sslMode === "disable" && !isLoopback) {
    throw new RuntimeConfigError([
      "DATABASE_SSL_MODE may be disabled only for a loopback database",
    ]);
  }
  return value;
}

function parseWebSessionEncryptionKey(value: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4}){10}[A-Za-z0-9+/]{3}=$/.test(value)) {
    throw new RuntimeConfigError([
      "WEB_SESSION_ENCRYPTION_KEY_BASE64 must be canonical base64 for exactly 32 bytes",
    ]);
  }

  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value) {
    throw new RuntimeConfigError([
      "WEB_SESSION_ENCRYPTION_KEY_BASE64 must decode to exactly 32 bytes",
    ]);
  }
  return key;
}

export function loadApiRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ApiRuntimeConfig {
  const result = runtimeEnvironmentSchema.safeParse({
    DATABASE_URL: environment.DATABASE_URL ?? environment.SMART_JOB_DATABASE_URL,
    NODE_ENV: environment.NODE_ENV,
    DATABASE_SSL_MODE:
      environment.DATABASE_SSL_MODE ?? environment.SMART_JOB_DATABASE_SSL_MODE,
    DATABASE_SSL_REJECT_UNAUTHORIZED:
      environment.DATABASE_SSL_REJECT_UNAUTHORIZED
      ?? environment.SMART_JOB_DATABASE_SSL_REJECT_UNAUTHORIZED,
    DATABASE_SSL_CA: environment.DATABASE_SSL_CA ?? environment.SMART_JOB_DATABASE_SSL_CA,
    DATABASE_MAX_CONNECTIONS:
      environment.DATABASE_MAX_CONNECTIONS ?? environment.SMART_JOB_DATABASE_MAX_CONNECTIONS,
    DATABASE_IDLE_TIMEOUT_MS:
      environment.DATABASE_IDLE_TIMEOUT_MS ?? environment.SMART_JOB_DATABASE_IDLE_TIMEOUT_MS,
    DATABASE_CONNECT_TIMEOUT_MS:
      environment.DATABASE_CONNECT_TIMEOUT_MS
      ?? environment.SMART_JOB_DATABASE_CONNECT_TIMEOUT_MS,
    SUPABASE_URL: environment.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: environment.SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: environment.SUPABASE_SECRET_KEY,
    SUPABASE_STORAGE_BUCKET: environment.SUPABASE_STORAGE_BUCKET,
    SUPABASE_JWT_ISSUER: environment.SUPABASE_JWT_ISSUER,
    SUPABASE_JWT_AUDIENCE: environment.SUPABASE_JWT_AUDIENCE,
    WEB_SESSION_ENCRYPTION_KEY_BASE64:
      environment.WEB_SESSION_ENCRYPTION_KEY_BASE64,
    WEB_SESSION_ENCRYPTION_KEY_VERSION:
      environment.WEB_SESSION_ENCRYPTION_KEY_VERSION,
    DOCUMENT_PUBSUB_PROJECT_ID: environment.DOCUMENT_PUBSUB_PROJECT_ID,
    DOCUMENT_PREVIEW_TOPIC: environment.DOCUMENT_PREVIEW_TOPIC,
    DOCUMENT_GENERATE_TOPIC: environment.DOCUMENT_GENERATE_TOPIC,
    EMAIL_DELIVERY_TOPIC: environment.EMAIL_DELIVERY_TOPIC,
    TAX_SUBMISSION_MODE: environment.TAX_SUBMISSION_MODE,
    TAX_GATEWAY_URL: environment.TAX_GATEWAY_URL,
    TAX_GATEWAY_AUDIENCE: environment.TAX_GATEWAY_AUDIENCE,
    TAX_GATEWAY_TIMEOUT_MS: environment.TAX_GATEWAY_TIMEOUT_MS,
    INTERNAL_API_AUDIENCE: environment.INTERNAL_API_AUDIENCE,
    INTERNAL_CALLER_SERVICE_ACCOUNTS: environment.INTERNAL_CALLER_SERVICE_ACCOUNTS,
  });

  if (!result.success) {
    throw new RuntimeConfigError(
      result.error.issues.map((issue) => {
        const field = issue.path.join(".") || "environment";
        return `${field}: ${issue.message}`;
      }),
    );
  }

  const supabaseUrl = normalizedUrl(result.data.SUPABASE_URL);
  ensureSafeSupabaseUrl(supabaseUrl, "SUPABASE_URL", "/");

  const defaultIssuer = new URL("auth/v1", supabaseUrl.href);
  const issuer = normalizedUrl(result.data.SUPABASE_JWT_ISSUER ?? defaultIssuer.href);
  const jwksUrl = normalizedUrl(
    new URL(".well-known/jwks.json", `${issuer.href}/`).href,
  );
  ensureSafeSupabaseUrl(issuer, "SUPABASE_JWT_ISSUER", "/auth/v1");
  ensureSafeSupabaseUrl(
    jwksUrl,
    "SUPABASE_JWKS_URL",
    "/auth/v1/.well-known/jwks.json",
  );

  const audiences = [...new Set(
    result.data.SUPABASE_JWT_AUDIENCE
      .split(",")
      .map((audience) => audience.trim())
      .filter(Boolean),
  )];
  if (audiences.length === 0 || audiences.length > 5) {
    throw new RuntimeConfigError([
      "SUPABASE_JWT_AUDIENCE must contain between one and five audiences",
    ]);
  }

  const sslCa = result.data.DATABASE_SSL_CA.replace(/\\n/g, "\n").trim();
  let taxGateway: TaxSubmissionRuntimeConfig["gateway"];
  if (result.data.TAX_GATEWAY_URL !== undefined) {
    const gatewayUrl = normalizedUrl(result.data.TAX_GATEWAY_URL);
    const audienceUrl = normalizedUrl(result.data.TAX_GATEWAY_AUDIENCE!);
    const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"];
    for (const [field, url] of [["TAX_GATEWAY_URL", gatewayUrl], ["TAX_GATEWAY_AUDIENCE", audienceUrl]] as const) {
      if (
        (url.protocol !== "https:" && !(url.protocol === "http:" && loopback.includes(url.hostname.toLowerCase())))
        || url.username || url.password || url.search || url.hash || url.pathname !== "/"
      ) {
        throw new RuntimeConfigError([`${field} must be an exact HTTPS service origin (loopback HTTP is allowed locally)`]);
      }
    }
    taxGateway = {
      url: new URL("api/v1/tax/approval", gatewayUrl.href),
      audience: audienceUrl.origin,
      timeoutMs: result.data.TAX_GATEWAY_TIMEOUT_MS,
    };
  }
  let internalIdentity: InternalIdentityRuntimeConfig | undefined;
  if (result.data.INTERNAL_API_AUDIENCE !== undefined) {
    const audienceUrl = new URL(result.data.INTERNAL_API_AUDIENCE);
    if (
      audienceUrl.protocol !== "https:"
      || audienceUrl.username
      || audienceUrl.password
      || audienceUrl.search
      || audienceUrl.hash
      || audienceUrl.pathname !== "/"
    ) {
      throw new RuntimeConfigError([
        "INTERNAL_API_AUDIENCE must be an exact HTTPS service origin",
      ]);
    }
    const allowedServiceAccounts = [...new Set(
      result.data.INTERNAL_CALLER_SERVICE_ACCOUNTS!
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    )];
    if (
      allowedServiceAccounts.length === 0
      || allowedServiceAccounts.length > 10
      || allowedServiceAccounts.some(
        (email) => !/^[^@\s]+@[^@\s]+\.gserviceaccount\.com$/.test(email),
      )
    ) {
      throw new RuntimeConfigError([
        "INTERNAL_CALLER_SERVICE_ACCOUNTS must contain one to ten service-account emails",
      ]);
    }
    internalIdentity = {
      audience: audienceUrl.origin,
      allowedServiceAccounts,
    };
  }

  return {
    database: {
      connectionString: parseDatabaseUrl(
        result.data.DATABASE_URL,
        result.data.DATABASE_SSL_MODE,
      ),
      ssl: result.data.DATABASE_SSL_MODE === "require"
        ? {
            rejectUnauthorized: result.data.DATABASE_SSL_REJECT_UNAUTHORIZED,
            ...(sslCa.length === 0 ? {} : { ca: sslCa }),
          }
        : false,
      maxConnections: result.data.DATABASE_MAX_CONNECTIONS,
      idleTimeoutMillis: result.data.DATABASE_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: result.data.DATABASE_CONNECT_TIMEOUT_MS,
    },
    supabaseAuth: {
      baseUrl: supabaseUrl,
      publishableKey: result.data.SUPABASE_PUBLISHABLE_KEY,
    },
    supabaseJwt: {
      issuer: issuer.href,
      jwksUrl,
      audiences,
    },
    supabaseStorage: {
      baseUrl: supabaseUrl,
      secretKey: result.data.SUPABASE_SECRET_KEY,
      bucketId: result.data.SUPABASE_STORAGE_BUCKET,
    },
    webSessionEncryption: {
      key: parseWebSessionEncryptionKey(
        result.data.WEB_SESSION_ENCRYPTION_KEY_BASE64,
      ),
      keyVersion: result.data.WEB_SESSION_ENCRYPTION_KEY_VERSION,
    },
    taxSubmission: {
      mode: result.data.TAX_SUBMISSION_MODE,
      ...(taxGateway === undefined ? {} : { gateway: taxGateway }),
    },
    ...(result.data.DOCUMENT_PUBSUB_PROJECT_ID === undefined
      ? {}
      : {
          documentDispatch: {
            projectId: result.data.DOCUMENT_PUBSUB_PROJECT_ID,
            previewTopic: result.data.DOCUMENT_PREVIEW_TOPIC!,
            generateTopic: result.data.DOCUMENT_GENERATE_TOPIC!,
            emailTopic: result.data.EMAIL_DELIVERY_TOPIC!,
          },
        }),
    ...(internalIdentity === undefined ? {} : { internalIdentity }),
  };
}
