import test from "node:test";
import assert from "node:assert/strict";
import type { WorkspaceSummary } from "@smart-job/api-contracts";
import {
  decideWorkspaceEntry,
  findViewerWorkspace,
  isOpaqueSessionAppRoute,
  parsePublicCompanyId,
} from "../src/lib/dal/workspace-routing.ts";

const managerWorkspace: WorkspaceSummary = {
  companyId: 101,
  name: "North Service",
  accountType: "business",
  role: "manager",
  memberNo: 1,
  enabledModules: ["jobs", "inventory"],
};

const workerWorkspace: WorkspaceSummary = {
  companyId: 202,
  name: "South Service",
  accountType: "business",
  role: "worker",
  memberNo: 7,
  enabledModules: ["jobs"],
};

test("workspace entry routes zero, one, and multiple memberships deterministically", () => {
  assert.deepEqual(decideWorkspaceEntry([]), { kind: "onboarding" });
  assert.deepEqual(decideWorkspaceEntry([managerWorkspace]), {
    kind: "workspace",
    companyId: 101,
  });
  assert.deepEqual(decideWorkspaceEntry([managerWorkspace, workerWorkspace]), {
    kind: "select",
  });
});

test("public company route IDs must be canonical positive safe integers", () => {
  assert.equal(parsePublicCompanyId("101"), 101);
  for (const value of ["", "0", "01", "-1", "+1", "1.0", " 1", "1 ", "abc"]) {
    assert.equal(parsePublicCompanyId(value), null, value);
  }
  assert.equal(parsePublicCompanyId(String(Number.MAX_SAFE_INTEGER + 1)), null);
});

test("tenant access matches the exact viewer membership", () => {
  assert.equal(
    findViewerWorkspace([managerWorkspace, workerWorkspace], 202),
    workerWorkspace,
  );
  assert.equal(findViewerWorkspace([managerWorkspace], 202), null);
});

test("only the opaque-session app entry and tenant routes bypass the legacy client shell", () => {
  assert.equal(isOpaqueSessionAppRoute("/app"), true);
  assert.equal(isOpaqueSessionAppRoute("/app/select-company"), true);
  assert.equal(isOpaqueSessionAppRoute("/app/c/101"), true);
  assert.equal(isOpaqueSessionAppRoute("/app/c/101/jobs"), true);
  assert.equal(isOpaqueSessionAppRoute("/app/c/"), false);
  assert.equal(isOpaqueSessionAppRoute("/app/jobs"), false);
});
