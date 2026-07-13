import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldScopeJobsToMembership,
  canReadCompanyJobs,
  canReadCompanyDocuments,
  canReadCompanyWorkers,
  canReadCompanyInventory,
  canReadUserInventory,
} from "../../supabase/functions/read-model/auth-scope.ts";

function requester(role: string, accountType = "business", isDev = false) {
  return { role, accountType, isDev, membershipId: null, memberNo: null };
}

test("shouldScopeJobsToMembership scopes workers and business users", () => {
  assert.equal(shouldScopeJobsToMembership(requester("worker")), true);
  assert.equal(shouldScopeJobsToMembership(requester("user", "business")), true);
  assert.equal(shouldScopeJobsToMembership(requester("user", "solo")), false);
  assert.equal(shouldScopeJobsToMembership(requester("manager")), false);
  assert.equal(shouldScopeJobsToMembership(requester("worker", "business", true)), false);
});

test("canReadCompanyJobs denies basic role only", () => {
  assert.equal(canReadCompanyJobs(requester("basic")), false);
  assert.equal(canReadCompanyJobs(requester("worker")), true);
  assert.equal(canReadCompanyJobs(requester("user")), true);
  assert.equal(canReadCompanyJobs(requester("manager")), true);
  assert.equal(canReadCompanyJobs(requester("basic", "business", true)), true);
});

test("canReadCompanyDocuments denies workers", () => {
  assert.equal(canReadCompanyDocuments(requester("worker")), false);
  assert.equal(canReadCompanyDocuments(requester("basic")), true);
  assert.equal(canReadCompanyDocuments(requester("user")), true);
  assert.equal(canReadCompanyDocuments(requester("manager")), true);
  assert.equal(canReadCompanyDocuments(requester("worker", "business", true)), true);
});

test("canReadCompanyWorkers allows only managers and devs", () => {
  assert.equal(canReadCompanyWorkers(requester("manager")), true);
  assert.equal(canReadCompanyWorkers(requester("worker")), false);
  assert.equal(canReadCompanyWorkers(requester("user")), false);
  assert.equal(canReadCompanyWorkers(requester("basic")), false);
  assert.equal(canReadCompanyWorkers(requester("worker", "business", true)), true);
});

test("canReadCompanyInventory allows managers, users, and devs", () => {
  assert.equal(canReadCompanyInventory(requester("manager")), true);
  assert.equal(canReadCompanyInventory(requester("user")), true);
  assert.equal(canReadCompanyInventory(requester("worker")), false);
  assert.equal(canReadCompanyInventory(requester("basic")), false);
  assert.equal(canReadCompanyInventory(requester("basic", "business", true)), true);
});

test("canReadUserInventory allows all roles except basic", () => {
  assert.equal(canReadUserInventory(requester("basic")), false);
  assert.equal(canReadUserInventory(requester("worker")), true);
  assert.equal(canReadUserInventory(requester("user")), true);
  assert.equal(canReadUserInventory(requester("manager")), true);
  assert.equal(canReadUserInventory(requester("basic", "business", true)), true);
});
