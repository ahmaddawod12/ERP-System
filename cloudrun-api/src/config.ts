import { z } from "zod";

import type { ServiceConfig } from "./types.js";

export const MAX_REQUEST_TIMEOUT_MS = 12_000;

const integerEnvironmentValue = (name: string) =>
  z
    .string({ error: `${name} must be an integer` })
    .trim()
    .regex(/^\d+$/, `${name} must be an integer`)
    .transform(Number);

const environmentSchema = z.object({
  PORT: integerEnvironmentValue("PORT").pipe(z.number().int().min(1).max(65_535)).default(8080),
  HOST: z.string().trim().min(1).max(255).default("0.0.0.0"),
  LOG_LEVEL: z
    .enum(["silent", "fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  REQUEST_TIMEOUT_MS: integerEnvironmentValue("REQUEST_TIMEOUT_MS")
    .pipe(z.number().int().min(1).max(MAX_REQUEST_TIMEOUT_MS))
    .default(MAX_REQUEST_TIMEOUT_MS),
});

export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid service configuration: ${issues.join("; ")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const result = environmentSchema.safeParse({
    PORT: environment.PORT,
    HOST: environment.HOST,
    LOG_LEVEL: environment.LOG_LEVEL,
    REQUEST_TIMEOUT_MS: environment.REQUEST_TIMEOUT_MS,
  });

  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => {
        const field = issue.path.join(".") || "environment";
        return `${field}: ${issue.message}`;
      }),
    );
  }

  return {
    host: result.data.HOST,
    port: result.data.PORT,
    logLevel: result.data.LOG_LEVEL,
    requestTimeoutMs: result.data.REQUEST_TIMEOUT_MS,
  };
}
