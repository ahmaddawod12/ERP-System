import { z } from "zod";
import { verifyLocalTaxMode, type LocalMarkerReader } from "./local-platform.js";

const logLevelSchema = z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);
const nodeEnvironmentSchema = z.enum(["development", "test", "production"]);
const taxSubmissionModeSchema = z.enum(["disabled", "sandbox", "production"]);

const optionalText = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.url().optional(),
);

const optionalSecret = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const environmentSchema = z
  .object({
    NODE_ENV: nodeEnvironmentSchema.default("production"),
    HOST: z.string().trim().min(1).default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
    LOG_LEVEL: logLevelSchema.default("info"),
    TAX_SUBMISSION_MODE: taxSubmissionModeSchema.default("disabled"),
    TAX_OUTBOUND_TIMEOUT_MS: z.coerce.number().int().min(250).max(10_000).default(8_000),
    TAX_TOKEN_URL: optionalUrl,
    TAX_APPROVAL_URL: optionalUrl,
    TAX_CLIENT_ID: optionalText,
    TAX_CLIENT_SECRET: optionalSecret,
    TAX_SCOPE: optionalText,
    TAX_CALLBACK_HMAC_SECRET: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(32, "TAX_CALLBACK_HMAC_SECRET must contain at least 32 characters").optional(),
    ),
    TAX_CALLBACK_MAX_SKEW_SECONDS: z.coerce.number().int().min(30).max(900).default(300),
    MAIN_API_URL: optionalUrl,
    MAIN_API_AUDIENCE: optionalText,
    TAX_GATEWAY_AUDIENCE: optionalText,
    TAX_APPROVAL_CALLER_SERVICE_ACCOUNT: optionalText,
  })
  .superRefine((config, context) => {
    const requiredOperationalFields = [
      "TAX_TOKEN_URL",
      "TAX_APPROVAL_URL",
      "TAX_CLIENT_ID",
      "TAX_CLIENT_SECRET",
      "TAX_CALLBACK_HMAC_SECRET",
      "MAIN_API_URL",
      "MAIN_API_AUDIENCE",
      "TAX_GATEWAY_AUDIENCE",
      "TAX_APPROVAL_CALLER_SERVICE_ACCOUNT",
    ] as const;
    const configuredCount = requiredOperationalFields.filter(
      (field) => config[field] !== undefined,
    ).length;

    if (configuredCount > 0 && configuredCount !== requiredOperationalFields.length) {
      for (const field of requiredOperationalFields) {
        if (config[field] === undefined) {
          context.addIssue({
            code: "custom",
            message: `${field} is required when the tax gateway is operationally configured`,
            path: [field],
          });
        }
      }
    }

    if (
      config.NODE_ENV === "production"
      && config.TAX_SUBMISSION_MODE !== "disabled"
      && configuredCount !== requiredOperationalFields.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Enabled production tax submission requires the complete tax authority, callback, and main-API configuration",
        path: ["NODE_ENV"],
      });
    }

    for (const field of ["TAX_TOKEN_URL", "TAX_APPROVAL_URL", "MAIN_API_URL"] as const) {
      const value = config[field];
      if (value === undefined) continue;
      validateServiceUrl(field, value, config.NODE_ENV, context);
    }

    if (config.MAIN_API_AUDIENCE !== undefined) {
      validateServiceUrl("MAIN_API_AUDIENCE", config.MAIN_API_AUDIENCE, config.NODE_ENV, context);
    }
    if (config.TAX_GATEWAY_AUDIENCE !== undefined) {
      validateServiceUrl("TAX_GATEWAY_AUDIENCE", config.TAX_GATEWAY_AUDIENCE, config.NODE_ENV, context);
    }

    if (config.TAX_SCOPE !== undefined && configuredCount === 0) {
      context.addIssue({
        code: "custom",
        message: "TAX_SCOPE requires the complete operational configuration",
        path: ["TAX_SCOPE"],
      });
    }
  });

function validateServiceUrl(
  field: string,
  value: string,
  nodeEnvironment: z.infer<typeof nodeEnvironmentSchema>,
  context: z.RefinementCtx,
): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    context.addIssue({
      code: "custom",
      message: `${field} must be a valid URL`,
      path: [field],
    });
    return;
  }
  const isLoopback = url.hostname === "localhost"
    || url.hostname === "127.0.0.1"
    || url.hostname === "[::1]";
  const protocolAllowed = url.protocol === "https:"
    || (nodeEnvironment !== "production" && url.protocol === "http:" && isLoopback);

  if (!protocolAllowed) {
    context.addIssue({
      code: "custom",
      message: `${field} must use HTTPS (loopback HTTP is allowed only outside production)`,
      path: [field],
    });
  }
  if (url.username !== "" || url.password !== "") {
    context.addIssue({
      code: "custom",
      message: `${field} must not contain embedded credentials`,
      path: [field],
    });
  }
  if (url.hash !== "") {
    context.addIssue({
      code: "custom",
      message: `${field} must not contain a URL fragment`,
      path: [field],
    });
  }
}

export interface TaxAuthorityConfig {
  readonly tokenUrl: URL;
  readonly approvalUrl: URL;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly scope?: string;
}

export interface TaxCallbackConfig {
  readonly hmacSecret: string;
  readonly maxSkewSeconds: number;
}

export interface MainApiConfig {
  readonly callbackUrl: URL;
  readonly approvalSessionUrl: URL;
  readonly audience: string;
}

export interface ServiceConfig {
  readonly nodeEnvironment: z.infer<typeof nodeEnvironmentSchema>;
  readonly taxSubmissionMode: z.infer<typeof taxSubmissionModeSchema>;
  readonly host: string;
  readonly port: number;
  readonly logLevel: z.infer<typeof logLevelSchema>;
  readonly outboundTimeoutMs: number;
  readonly authority?: TaxAuthorityConfig;
  readonly callback?: TaxCallbackConfig;
  readonly mainApi?: MainApiConfig;
  readonly taxGatewayAudience: string;
  readonly taxApprovalCallerServiceAccount: string;
}

function formatConfigurationError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "configuration"}: ${issue.message}`)
    .join("; ");
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
  options: { readonly readLocalMarker?: LocalMarkerReader } = {},
): ServiceConfig {
  verifyLocalTaxMode(
    environment,
    environment.TAX_SUBMISSION_MODE ?? "disabled",
    options.readLocalMarker,
  );
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error(`Invalid cloudrun-tax configuration: ${formatConfigurationError(parsed.error)}`);
  }

  const data = parsed.data;
  return {
    nodeEnvironment: data.NODE_ENV,
    taxSubmissionMode: data.TAX_SUBMISSION_MODE,
    host: data.HOST,
    port: data.PORT,
    logLevel: data.LOG_LEVEL,
    outboundTimeoutMs: data.TAX_OUTBOUND_TIMEOUT_MS,
    ...(data.TAX_TOKEN_URL !== undefined
      && data.TAX_APPROVAL_URL !== undefined
      && data.TAX_CLIENT_ID !== undefined
      && data.TAX_CLIENT_SECRET !== undefined
      && data.TAX_CALLBACK_HMAC_SECRET !== undefined
      && data.MAIN_API_URL !== undefined
      && data.MAIN_API_AUDIENCE !== undefined
      && data.TAX_GATEWAY_AUDIENCE !== undefined
      && data.TAX_APPROVAL_CALLER_SERVICE_ACCOUNT !== undefined
      ? {
          authority: {
            tokenUrl: new URL(data.TAX_TOKEN_URL),
            approvalUrl: new URL(data.TAX_APPROVAL_URL),
            clientId: data.TAX_CLIENT_ID,
            clientSecret: data.TAX_CLIENT_SECRET,
            ...(data.TAX_SCOPE === undefined ? {} : { scope: data.TAX_SCOPE }),
          },
          callback: {
            hmacSecret: data.TAX_CALLBACK_HMAC_SECRET,
            maxSkewSeconds: data.TAX_CALLBACK_MAX_SKEW_SECONDS,
          },
          mainApi: {
            callbackUrl: new URL(data.MAIN_API_URL),
            approvalSessionUrl: new URL("/internal/v1/tax/approval-session", data.MAIN_API_URL),
            audience: data.MAIN_API_AUDIENCE,
          },
        }
      : {}),
    taxGatewayAudience: data.TAX_GATEWAY_AUDIENCE ?? "",
    taxApprovalCallerServiceAccount: data.TAX_APPROVAL_CALLER_SERVICE_ACCOUNT ?? "",
  };
}
