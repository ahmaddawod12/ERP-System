import type { Role, Tier } from "@/lib/types";

const tierOrder: Record<Tier, number> = {
  Basic: 0,
  Solo: 1,
  Team: 2,
  Enterprise: 3,
};

export function requireTier(currentTier: Tier, minTier: Tier) {
  return tierOrder[currentTier] >= tierOrder[minTier];
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
  overview: { roles: ["Manager", "Worker", "User", "Basic", "Dev"], minTier: "Basic" },
  jobs: { roles: ["Manager", "Worker", "User", "Dev"], minTier: "Solo" },
  workers: { roles: ["Manager", "Dev"], minTier: "Team" },
  inventory: { roles: ["Manager", "User", "Dev"], minTier: "Solo" },
  inventoryPicks: { roles: ["Worker", "Dev"], minTier: "Team" },
  clients: { roles: ["Manager", "User", "Basic", "Dev"], minTier: "Basic" },
  documents: { roles: ["Manager", "User", "Basic", "Dev"], minTier: "Basic" },
  settings: { roles: ["Manager", "Worker", "User", "Basic", "Dev"], minTier: "Basic" },
  upgrade: { roles: ["Manager", "Worker", "User", "Basic", "Dev"], minTier: "Basic" },
  admin: { roles: ["Dev"], minTier: "Basic" },
};

export function canAccessSection(role: Role, tier: Tier, section: AppSection) {
  const rule = sectionRules[section];
  return hasRole(role, rule.roles) && requireTier(tier, rule.minTier);
}

export function defaultTierForRole(role: Role, accountType: "solo" | "business"): Tier {
  if (role === "Basic") return "Basic";
  if (accountType === "solo") return "Solo";
  if (role === "Worker" || role === "Manager" || role === "Dev") return "Team";
  return "Solo";
}
