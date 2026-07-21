import assert from "node:assert/strict";
import test from "node:test";

import {
  DEVELOPMENT_WEB_SESSION_COOKIE,
  PRODUCTION_WEB_SESSION_COOKIE,
  parseWebsiteOrigin,
  webSessionCookieName,
} from "../src/lib/auth/opaque-session.ts";
import { isVerifiedLocalPlatformRuntime } from "../src/lib/local-platform.ts";

test("production cookies and origins remain secure outside the verified local platform", () => {
  assert.equal(webSessionCookieName("production", false), PRODUCTION_WEB_SESSION_COOKIE);
  assert.throws(() => parseWebsiteOrigin("http://127.0.0.1:3000", "production", false), /production/);
});

test("the verified local platform permits only loopback HTTP website access", () => {
  assert.equal(webSessionCookieName("production", true), DEVELOPMENT_WEB_SESSION_COOKIE);
  assert.equal(
    parseWebsiteOrigin("http://127.0.0.1:3000", "production", true),
    "http://127.0.0.1:3000",
  );
  assert.throws(
    () => parseWebsiteOrigin("http://website:3000", "production", true),
    /loopback/,
  );
});

test("local runtime verification requires the entrypoint-derived signal", () => {
  const common = {
    SMART_JOB_DEPLOYMENT_ENV: "local",
    SMART_JOB_LOCAL_PLATFORM: "true",
    LOCAL_PLATFORM_MARKER_PATH: "/run/secrets/smart_job_local_platform",
  };
  assert.equal(isVerifiedLocalPlatformRuntime(common), false);
  assert.equal(isVerifiedLocalPlatformRuntime({
    ...common,
    SMART_JOB_LOCAL_PLATFORM_VERIFIED: "true",
  }), true);
});
