import test from "node:test";
import assert from "node:assert/strict";
import { resolveCompanyScope } from "@smart-job/contracts";

test("resolveCompanyScope normalizes companyId by trimming whitespace", () => {
  assert.equal(resolveCompanyScope("  abc-123  "), "abc-123");
  assert.equal(resolveCompanyScope("public-42"), "public-42");
});

test("resolveCompanyScope throws when companyId is empty", () => {
  assert.throws(() => resolveCompanyScope(""), /companyId is required/);
  assert.throws(() => resolveCompanyScope(null as unknown as string), /companyId is required/);
  assert.throws(() => resolveCompanyScope(undefined as unknown as string), /companyId is required/);
  assert.throws(() => resolveCompanyScope("   "), /companyId is required/);
});
