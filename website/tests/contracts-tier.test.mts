import test from "node:test";
import assert from "node:assert/strict";
import {
  getEnabledModulesForTier,
  getSubscriptionTierForRole,
  getTierRank,
} from "@smart-job/contracts";
import {
  canAccessSection,
  defaultTierForRole,
  requireTier,
} from "../src/lib/access.ts";

test("contracts define canonical role-to-tier mapping", () => {
  assert.equal(getSubscriptionTierForRole("basic", "solo"), "Basic");
  assert.equal(getSubscriptionTierForRole("user", "solo"), "Solo");
  assert.equal(getSubscriptionTierForRole("manager", "business"), "Team");
  assert.equal(getSubscriptionTierForRole("worker", "business"), "Team");
  assert.equal(getSubscriptionTierForRole("dev", "business"), "Enterprise");
});

test("website access helpers delegate to canonical tier semantics", () => {
  assert.equal(defaultTierForRole("basic", "solo"), "Basic");
  assert.equal(defaultTierForRole("user", "solo"), "Solo");
  assert.equal(defaultTierForRole("manager", "business"), "Team");
  assert.equal(requireTier("Team", "Solo"), true);
  assert.equal(requireTier("Solo", "Team"), false);
  assert.equal(getTierRank("Enterprise") > getTierRank("Team"), true);
});

test("tier modules and section gates stay aligned", () => {
  const basicModules = getEnabledModulesForTier("Basic");
  const teamModules = getEnabledModulesForTier("Team");

  assert.equal(basicModules.documents, true);
  assert.equal(basicModules.inventory, false);
  assert.equal(teamModules.team, true);
  assert.equal(teamModules.companyinventory, true);

  assert.equal(canAccessSection("basic", "Basic", "jobs"), false);
  assert.equal(canAccessSection("user", "Solo", "jobs"), true);
  assert.equal(canAccessSection("manager", "Team", "workers"), true);
  assert.equal(canAccessSection("worker", "Team", "inventoryPicks"), true);
});
