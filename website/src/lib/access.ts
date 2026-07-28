import { getSubscriptionTierForRole, getTierRank } from "@smart-job/contracts";
import type { Role, Tier } from "@/lib/types";

export function requireTier(currentTier: Tier, minTier: Tier) {
  return getTierRank(currentTier) >= getTierRank(minTier);
}

export function hasRole(role: Role, allowed: Role[]) {
  return allowed.includes(role);
}

export type AppSection =
  | "overview"
  | "jobs"
  | "workers"
  | "inventory"
  | "inventoryPicks"
  | "clients"
  | "documents"
  | "settings"
  | "upgrade"
  | "admin";

export interface SectionRule {
  roles: Role[];
  minTier: Tier;
}

const sectionRules: Record<AppSection, SectionRule> = {
  overview: { roles: ["manager", "worker", "user", "basic", "dev"], minTier: "Basic" },
  jobs: { roles: ["manager", "worker", "user", "dev"], minTier: "Solo" },
  workers: { roles: ["manager", "dev"], minTier: "Team" },
  inventory: { roles: ["manager", "user", "dev"], minTier: "Solo" },
  inventoryPicks: { roles: ["worker", "dev"], minTier: "Team" },
  clients: { roles: ["manager", "user", "basic", "dev"], minTier: "Basic" },
  documents: { roles: ["manager", "user", "basic", "dev"], minTier: "Basic" },
  settings: { roles: ["manager", "worker", "user", "basic", "dev"], minTier: "Basic" },
  upgrade: { roles: ["manager", "worker", "user", "basic", "dev"], minTier: "Basic" },
  admin: { roles: ["dev"], minTier: "Basic" },
};

export function canAccessSection(role: Role, tier: Tier, section: AppSection) {
  const rule = sectionRules[section];
  return hasRole(role, rule.roles) && requireTier(tier, rule.minTier);
}

export function defaultTierForRole(role: Role, accountType: "solo" | "business"): Tier {
  return getSubscriptionTierForRole(role, accountType);
}
