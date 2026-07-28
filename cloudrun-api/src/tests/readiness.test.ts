import assert from "node:assert/strict";
import test from "node:test";

import { createApiReadinessCheck } from "../readiness.js";

test("production readiness checks database, both storage clients and both publishers", async () => {
  const calls: string[] = [];
  const dependency = (name: string) => ({
    async checkReadiness() { calls.push(name); },
  });
  const check = createApiReadinessCheck({
    database: dependency("database") as never,
    storage: dependency("storage") as never,
    archiveStorage: dependency("archive") as never,
    documentTaskPublisher: dependency("documents") as never,
    emailDeliveryPublisher: dependency("email") as never,
  });
  await check();
  assert.deepEqual(calls.sort(), ["archive", "database", "documents", "email", "storage"]);
});

test("readiness fails closed when publisher or archive configuration is missing", async () => {
  const ready = { async checkReadiness() {} };
  const check = createApiReadinessCheck({
    database: ready as never,
    storage: ready as never,
  });
  await assert.rejects(check(), /archive storage readiness is not configured/);
});
