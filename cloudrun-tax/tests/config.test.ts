import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("uses Cloud Run-compatible defaults", () => {
    assert.deepEqual(loadConfig({}), {
      host: "0.0.0.0",
      port: 8080,
      logLevel: "info",
    });
  });

  it("parses explicit values and optional main API placeholders", () => {
    assert.deepEqual(
      loadConfig({
        HOST: "127.0.0.1",
        PORT: "9090",
        LOG_LEVEL: "debug",
        MAIN_API_URL: "https://api.example.test/internal/tax",
        MAIN_API_AUDIENCE: "https://api.example.test",
      }),
      {
        host: "127.0.0.1",
        port: 9090,
        logLevel: "debug",
        mainApiUrl: new URL("https://api.example.test/internal/tax"),
        mainApiAudience: "https://api.example.test",
      },
    );
  });

  it("treats empty optional placeholders as absent", () => {
    assert.deepEqual(loadConfig({ MAIN_API_URL: "", MAIN_API_AUDIENCE: "" }), {
      host: "0.0.0.0",
      port: 8080,
      logLevel: "info",
    });
  });

  it("rejects invalid ports and log levels", () => {
    assert.throws(
      () => loadConfig({ PORT: "70000", LOG_LEVEL: "verbose" }),
      /Invalid cloudrun-tax configuration/,
    );
  });

  it("requires the main API URL and audience to be configured together", () => {
    assert.throws(
      () => loadConfig({ MAIN_API_URL: "https://api.example.test" }),
      /MAIN_API_URL and MAIN_API_AUDIENCE must be configured together/,
    );
    assert.throws(
      () => loadConfig({ MAIN_API_AUDIENCE: "https:\/\/api.example.test" }),
      /MAIN_API_URL and MAIN_API_AUDIENCE must be configured together/,
    );
  });

  it("rejects a malformed main API URL", () => {
    assert.throws(
      () =>
        loadConfig({
          MAIN_API_URL: "not-a-url",
          MAIN_API_AUDIENCE: "audience",
        }),
      /Invalid cloudrun-tax configuration/,
    );
  });
});
