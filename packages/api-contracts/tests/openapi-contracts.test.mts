import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiFailureResponseSchema,
  DocTypeSchema,
  createApiSuccessResponseSchema,
} from "../dist/index.js";
import * as rootExports from "../dist/index.js";
import { z } from "zod";

test("document types retain their canonical numeric values in generated JSON Schema", () => {
  const schema = z.toJSONSchema(DocTypeSchema) as { anyOf?: Array<{ const?: number }> };
  assert.deepEqual(
    schema.anyOf?.map((entry) => entry.const).sort((left, right) => Number(left) - Number(right)),
    [10, 200, 210, 305, 330, 400],
  );
});

test("status-specific schemas cannot exchange success and failure envelopes", () => {
  const successSchema = createApiSuccessResponseSchema(z.object({ status: z.literal("ok") }));
  const success = {
    ok: true,
    data: { status: "ok" },
    meta: { requestId: "request-success" },
  };
  const failure = {
    ok: false,
    error: { code: "NOT_READY", message: "Not ready", retryable: true },
    meta: { requestId: "request-failure" },
  };

  assert.equal(successSchema.safeParse(success).success, true);
  assert.equal(successSchema.safeParse(failure).success, false);
  assert.equal(ApiFailureResponseSchema.safeParse(failure).success, true);
  assert.equal(ApiFailureResponseSchema.safeParse(success).success, false);
});

test("legacy characterization fixtures are not exported from the package root", () => {
  assert.equal("LEGACY_MUTATION_CHARACTERIZATION_FIXTURES" in rootExports, false);
  assert.equal("LEGACY_DEFAULT_MUTATION_OPERATIONS" in rootExports, false);
});
