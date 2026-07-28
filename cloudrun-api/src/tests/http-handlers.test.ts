import assert from "node:assert/strict";
import test from "node:test";

import { operationalFailureFields } from "../http/handlers.js";

test("operational failure fields classify monitored workflows without identifiers", () => {
  const poolError = Object.assign(new Error("remaining connection slots are reserved"), {
    code: "53300",
  });

  assert.deepEqual(
    operationalFailureFields(
      poolError,
      "GET",
      "/api/v1/auth/web-sessions/current?credential=never-log-this",
    ),
    {
      sessionRefreshFailure: true,
      databasePoolSaturation: true,
    },
  );
  assert.deepEqual(
    operationalFailureFields(new Error("upstream unavailable"), "POST", "/internal/v1/tax/callback"),
    { taxCallbackFailure: true },
  );
  assert.deepEqual(
    operationalFailureFields(new Error("upstream unavailable"), "POST", "/internal/v1/tax-submissions/drain"),
    { taxSubmissionFailure: true },
  );
});
