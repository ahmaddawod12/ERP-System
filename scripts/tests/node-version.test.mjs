import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSupportedNodeVersion,
  REQUIRED_NODE_MAJOR,
} from "../node-version.mjs";

test("repository Node guard accepts the supported major", () => {
  assert.equal(REQUIRED_NODE_MAJOR, 22);
  assert.doesNotThrow(() => assertSupportedNodeVersion("22.22.0"));
  assert.doesNotThrow(() => assertSupportedNodeVersion("v22.0.0"));
});

test("repository Node guard rejects another major and malformed versions", () => {
  assert.throws(() => assertSupportedNodeVersion("24.1.0"), /Node 22\.x is required/);
  assert.throws(() => assertSupportedNodeVersion("not-a-version"), /found not-a-version/);
});
