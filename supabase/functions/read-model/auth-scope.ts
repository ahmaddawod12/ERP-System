import type { RequesterContext } from "./types.ts";

export function shouldScopeJobsToMembership(requester: RequesterContext): boolean {
  if (requester.isDev) return false;
  if (requester.role === "worker") return true;
  return requester.role === "user" && requester.accountType !== "solo";
}

export function canReadCompanyJobs(requester: RequesterContext): boolean {
  return requester.isDev || requester.role !== "basic";
}

export function canReadCompanyDocuments(requester: RequesterContext): boolean {
  return requester.isDev || requester.role !== "worker";
}

export function canReadCompanyWorkers(requester: RequesterContext): boolean {
  return requester.isDev || requester.role === "manager";
}

