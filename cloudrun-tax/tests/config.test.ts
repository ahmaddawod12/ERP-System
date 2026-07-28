import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("uses Cloud Run-compatible defaults", () => {
    assert.deepEqual(loadConfig({ NODE_ENV: "test" }), {
      nodeEnvironment: "test",
      taxSubmissionMode: "disabled",
      host: "0.0.0.0",
      port: 8080,
      logLevel: "info",
      outboundTimeoutMs: 8_000,
      taxGatewayAudience: "",
      taxApprovalCallerServiceAccount: "",
    });
  });

  it("parses a complete operational configuration", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      TAX_SUBMISSION_MODE: "sandbox",
      HOST: "127.0.0.1",
      PORT: "9090",
      LOG_LEVEL: "debug",
      TAX_TOKEN_URL: "https://auth.example.test/token",
      TAX_APPROVAL_URL: "https://auth.example.test/approval",
      TAX_CLIENT_ID: "client-id",
      TAX_CLIENT_SECRET: "client-secret",
      TAX_CALLBACK_HMAC_SECRET: "hmac-secret-with-at-least-32-characters!!",
      MAIN_API_URL: "https://api.example.test/internal/tax",
      MAIN_API_AUDIENCE: "https://api.example.test",
      TAX_GATEWAY_AUDIENCE: "https://tax.example.test",
      TAX_APPROVAL_CALLER_SERVICE_ACCOUNT: "smart-job-api@example.iam.gserviceaccount.com",
    });
    assert.equal(config.nodeEnvironment, "test");
    assert.equal(config.taxSubmissionMode, "sandbox");
    assert.equal(config.host, "127.0.0.1");
    assert.equal(config.port, 9090);
    assert.equal(config.logLevel, "debug");
    assert.equal(config.outboundTimeoutMs, 8_000);
    assert.equal(config.taxApprovalCallerServiceAccount, "smart-job-api@example.iam.gserviceaccount.com");
    assert.equal(config.taxGatewayAudience, "https://tax.example.test");
    assert.equal(config.authority?.tokenUrl.href, "https://auth.example.test/token");
    assert.equal(config.authority?.approvalUrl.href, "https://auth.example.test/approval");
    assert.equal(config.authority?.clientId, "client-id");
    assert.equal(config.authority?.clientSecret, "client-secret");
    assert.equal(config.callback?.hmacSecret, "hmac-secret-with-at-least-32-characters!!");
    assert.equal(config.callback?.maxSkewSeconds, 300);
    assert.equal(config.mainApi?.callbackUrl.href, "https://api.example.test/internal/tax");
    assert.equal(config.mainApi?.approvalSessionUrl.href, "https://api.example.test/internal/v1/tax/approval-session");
    assert.equal(config.mainApi?.audience, "https://api.example.test");
  });

  it("treats empty optional placeholders as absent", () => {
    assert.deepEqual(loadConfig({ NODE_ENV: "test", MAIN_API_URL: "", MAIN_API_AUDIENCE: "" }), {
      nodeEnvironment: "test",
      taxSubmissionMode: "disabled",
      host: "0.0.0.0",
      port: 8080,
      logLevel: "info",
      outboundTimeoutMs: 8_000,
      taxGatewayAudience: "",
      taxApprovalCallerServiceAccount: "",
    });
  });

  it("rejects invalid ports and log levels", () => {
    assert.throws(
      () => loadConfig({ NODE_ENV: "test", PORT: "70000", LOG_LEVEL: "verbose" }),
      /Invalid cloudrun-tax configuration/,
    );
  });

  it("requires all operational fields when any is provided", () => {
    assert.throws(
      () => loadConfig({ NODE_ENV: "test", MAIN_API_URL: "https://api.example.test" }),
      /MAIN_API_AUDIENCE is required when the tax gateway is operationally configured/,
    );
    assert.throws(
      () => loadConfig({ NODE_ENV: "test", MAIN_API_AUDIENCE: "https://api.example.test" }),
      /MAIN_API_URL is required when the tax gateway is operationally configured/,
    );
  });

  it("defaults production to disabled without requiring authority credentials", () => {
    assert.equal(loadConfig({ NODE_ENV: "production" }).taxSubmissionMode, "disabled");
  });

  it("requires the complete operational configuration when production submission is enabled", () => {
    assert.throws(
      () => loadConfig({ NODE_ENV: "production", TAX_SUBMISSION_MODE: "production" }),
      /Enabled production tax submission requires the complete tax authority, callback, and main-API configuration/,
    );
  });

  it("rejects unknown submission modes", () => {
    assert.throws(
      () => loadConfig({ NODE_ENV: "test", TAX_SUBMISSION_MODE: "enabled" }),
      /Invalid cloudrun-tax configuration/,
    );
  });

  it("rejects a malformed main API URL", () => {
    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: "test",
          MAIN_API_URL: "not-a-url",
          MAIN_API_AUDIENCE: "https://api.example.test",
          TAX_GATEWAY_AUDIENCE: "https://tax.example.test",
          TAX_TOKEN_URL: "https://auth.example.test/token",
          TAX_APPROVAL_URL: "https://auth.example.test/approval",
          TAX_CLIENT_ID: "client-id",
          TAX_CLIENT_SECRET: "client-secret",
          TAX_CALLBACK_HMAC_SECRET: "hmac-secret-with-at-least-32-characters!!",
          TAX_APPROVAL_CALLER_SERVICE_ACCOUNT: "smart-job-api@example.iam.gserviceaccount.com",
        }),
      /Invalid cloudrun-tax configuration/,
    );
  });

  it("keeps local tax submission disabled and marker-gated", () => {
    const local = {
      NODE_ENV: "production",
      TAX_SUBMISSION_MODE: "disabled",
      SMART_JOB_DEPLOYMENT_ENV: "local",
      SMART_JOB_LOCAL_PLATFORM: "true",
      LOCAL_PLATFORM_MARKER_PATH: "/run/secrets/smart_job_local_platform",
    };
    assert.equal(loadConfig(local, {
      readLocalMarker: () => Buffer.from("smart-job-erp-local-platform-v1"),
    }).taxSubmissionMode, "disabled");
    assert.throws(
      () => loadConfig({ ...local, TAX_SUBMISSION_MODE: "sandbox" }, {
        readLocalMarker: () => Buffer.from("smart-job-erp-local-platform-v1"),
      }),
      /must remain disabled/,
    );
    assert.throws(
      () => loadConfig(local, { readLocalMarker: () => Buffer.from("wrong") }),
      /mounted local-platform marker/,
    );
  });
});
