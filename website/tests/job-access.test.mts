import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMembershipQueryValues,
  buildJobAssignmentPatch,
  buildListJobsOptions,
  buildManagedJobCreatePayload,
  buildSoloFinishedJobPayload,
  canListCompanyJobs,
  roleUsesScopedJobAccess,
} from "../src/lib/job-access.ts";

test("worker job access requires a worker membership id", () => {
  assert.equal(canListCompanyJobs("worker", null), false);
  assert.equal(canListCompanyJobs("worker", ""), false);
  assert.equal(canListCompanyJobs("user", null), false);
  assert.equal(canListCompanyJobs("manager", null), true);
  assert.deepEqual(buildListJobsOptions("worker", { wid: 7, name: "Worker", email: "worker@example.com" }), { role: "worker", wid: "7" });
  assert.deepEqual(buildListJobsOptions("user", { wid: 7, name: "User", email: "user@example.com" }), { role: "user", wid: "7" });
  assert.deepEqual(buildListJobsOptions("worker", { wid: null, name: "Worker", email: "worker@example.com" }), { role: "worker" });
  assert.equal(roleUsesScopedJobAccess("worker"), true);
  assert.equal(roleUsesScopedJobAccess("user"), true);
  assert.equal(roleUsesScopedJobAccess("manager"), false);
  assert.deepEqual(buildMembershipQueryValues("7"), ["7", 7]);
  assert.deepEqual(buildMembershipQueryValues("worker-7"), ["worker-7"]);
});

test("managed job payloads keep sequential membership ids and names", () => {
  const payload = buildManagedJobCreatePayload(
    { title: "Install", cname: "Acme", cphone: "", description: "Replace unit", location: "" },
    { name: "Manager", email: "manager@example.com", mid: 12, wid: undefined },
    { wid: 8, name: "Worker", email: "worker@example.com" },
  );

  assert.equal(payload.mid, "12");
  assert.equal(payload.mname, "Manager");
  assert.equal(payload.wid, "8");
  assert.equal(payload.wname, "Worker");
});

test("job assignment patches clear assignee fields without dropping manager metadata", () => {
  const patch = buildJobAssignmentPatch(null, {
    name: "Manager",
    email: "manager@example.com",
    mid: 5,
    wid: undefined,
  });

  assert.equal(patch.mid, "5");
  assert.equal(patch.mname, "Manager");
  assert.equal(patch.wid, null);
  assert.equal(patch.wname, null);
});

test("solo finished jobs never fall back to auth uid strings", () => {
  const payload = buildSoloFinishedJobPayload(
    { title: "Service", cname: "Solo Client", cphone: "", description: "Finished visit", location: "" },
    { name: "Solo User", email: "solo@example.com", mid: undefined, wid: 1 },
  );

  assert.equal(payload.wid, "1");
  assert.equal(payload.wname, "Solo User");
});
