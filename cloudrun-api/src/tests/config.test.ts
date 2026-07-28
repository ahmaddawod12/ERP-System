import assert from "node:assert/strict";
import test from "node:test";

import { ConfigError, MAX_REQUEST_TIMEOUT_MS, loadConfig } from "../config.js";

test("loadConfig applies Cloud Run-safe defaults", () => {
  assert.deepEqual(loadConfig({}), {
    host: "0.0.0.0",
    port: 8080,
    logLevel: "info",
    requestTimeoutMs: 12_000,
  });
});

test("loadConfig parses supported overrides", () => {
  assert.deepEqual(
    loadConfig({
      HOST: "127.0.0.1",
      PORT: "9090",
      LOG_LEVEL: "debug",
      REQUEST_TIMEOUT_MS: "2500",
    }),
    {
      host: "127.0.0.1",
      port: 9090,
      logLevel: "debug",
      requestTimeoutMs: 2500,
    },
  );
});

test("loadConfig rejects invalid values and timeouts above the 12-second cap", () => {
  const invalidEnvironments: NodeJS.ProcessEnv[] = [
    { PORT: "0" },
    { PORT: "8080.5" },
    { HOST: "" },
    { LOG_LEVEL: "verbose" },
    { REQUEST_TIMEOUT_MS: "0" },
    { REQUEST_TIMEOUT_MS: String(MAX_REQUEST_TIMEOUT_MS + 1) },
  ];

  for (const environment of invalidEnvironments) {
    assert.throws(() => loadConfig(environment), ConfigError);
  }
});
