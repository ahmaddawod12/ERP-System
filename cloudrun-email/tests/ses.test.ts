import assert from "node:assert/strict";
import test from "node:test";

import { classifySesFailure } from "../src/ses.js";

test("SES throttling and explicit provider 5xx failures are safe to retry", () => {
  assert.equal(classifySesFailure({ name: "Throttling", $metadata: { httpStatusCode: 429 } }), "queued");
  assert.equal(classifySesFailure({ $fault: "server", $metadata: { httpStatusCode: 503 } }), "queued");
});

test("SES provider 4xx failures are terminal", () => {
  assert.equal(
    classifySesFailure({ name: "MessageRejected", $fault: "client", $metadata: { httpStatusCode: 400 } }),
    "failed",
  );
});

test("ambiguous network failures require manual reconciliation", () => {
  assert.equal(classifySesFailure(new Error("socket closed")), "delivery_unknown");
});
