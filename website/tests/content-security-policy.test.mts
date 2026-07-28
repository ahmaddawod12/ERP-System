import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSensitiveContentSecurityPolicy,
  isSensitiveCspPath,
} from "../src/lib/security/content-security-policy.ts";

describe("sensitive-route content security policy", () => {
  it("covers authenticated, identity, onboarding, recovery, and contact routes", () => {
    for (const pathname of [
      "/app",
      "/app/c/101/jobs",
      "/auth/callback",
      "/login",
      "/register",
      "/forgot-password",
      "/reset-password/token",
      "/onboarding",
      "/contact",
      "/api/contact/submit",
    ]) {
      assert.equal(isSensitiveCspPath(pathname), true, pathname);
    }
    assert.equal(isSensitiveCspPath("/"), false);
    assert.equal(isSensitiveCspPath("/features"), false);
    assert.equal(isSensitiveCspPath("/application"), false);
  });

  it("uses a nonce without production inline/eval escapes or browser identity-provider access", () => {
    const policy = buildSensitiveContentSecurityPolicy("fixture-nonce", false);
    const scriptDirective = policy
      .split("; ")
      .find((directive) => directive.startsWith("script-src "));
    assert.match(scriptDirective ?? "", /'nonce-fixture-nonce'/);
    assert.match(scriptDirective ?? "", /'strict-dynamic'/);
    assert.doesNotMatch(scriptDirective ?? "", /unsafe-inline/);
    assert.doesNotMatch(scriptDirective ?? "", /unsafe-eval/);
    assert.doesNotMatch(policy, /identitytoolkit|securetoken/);
    assert.match(policy, /object-src 'none'/);
  });

  it("keeps unsafe-eval development-only", () => {
    assert.match(
      buildSensitiveContentSecurityPolicy("fixture", true),
      /script-src [^;]*'unsafe-eval'/,
    );
  });
});
