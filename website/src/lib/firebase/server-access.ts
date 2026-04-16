import { adminDb } from "@/lib/firebase/admin";
import { ApiRouteError } from "@/lib/api/errors";
import type { Role, UserProfile } from "@/lib/types";

export interface CompanyAccessResult {
  profile: UserProfile;
  role: Role;
}

const APP_ROLES = new Set<Role>(["manager", "worker", "user", "basic", "dev"]);

function normalizeRoleValue(role: unknown): Role {
  const raw = String(role ?? "").trim().toLowerCase() as Role;
  if (!APP_ROLES.has(raw)) {
    throw new ApiRouteError(403, "invalid_role", "User profile has an invalid role");
  }
  return raw;
}

export async function getUserProfileOrThrow(uid: string): Promise<UserProfile> {
  const profileRef = adminDb().collection("users").doc(uid).collection("data").doc("profile");
  const profileSnap = await profileRef.get();
  if (!profileSnap.exists) {
    throw new ApiRouteError(403, "profile_not_found", "User profile not found");
  }
  const profile = profileSnap.data() as UserProfile;
  return {
    ...profile,
    role: normalizeRoleValue(profile.role),
  };
}

export async function getWorkerRoleForCompany(
  companyId: string,
  wid: string | number | undefined,
): Promise<Role | null> {
  const widValue = String(wid ?? "").trim();
  if (!widValue) {
    return null;
  }
  const workerRef = adminDb().collection("companies").doc(companyId).collection("workers").doc(widValue);
  const workerSnap = await workerRef.get();
  if (!workerSnap.exists) {
    return null;
  }
  return normalizeRoleValue(workerSnap.data()?.role);
}

export async function getManagerRoleForCompany(
  companyId: string,
  mid: string | number | undefined,
): Promise<Role | null> {
  const midValue = String(mid ?? "").trim();
  if (!midValue) {
    return null;
  }
  const managerRef = adminDb().collection("companies").doc(companyId).collection("managers").doc(midValue);
  const managerSnap = await managerRef.get();
  if (!managerSnap.exists) {
    return null;
  }
  return normalizeRoleValue(managerSnap.data()?.role);
}

export async function assertCompanyAccess(params: {
  uid: string;
  companyId: string;
  allowedRoles: Role[];
}): Promise<CompanyAccessResult> {
  const { uid, companyId, allowedRoles } = params;
  const profile = await getUserProfileOrThrow(uid);
  const isSoloScope =
    String(profile.accountType ?? "").toLowerCase() === "solo" &&
    profile.companyId === companyId;

  if (profile.companyId !== companyId && profile.role !== "dev") {
    throw new ApiRouteError(403, "company_mismatch", "User does not belong to this company");
  }

  let membershipRole: Role | null = null;
  if (!isSoloScope && profile.role !== "dev") {
    membershipRole = await getWorkerRoleForCompany(companyId, profile.wid);
    if (!membershipRole && profile.role === "manager") {
      membershipRole = await getManagerRoleForCompany(companyId, profile.mid);
    }
  }

  const resolvedRole = membershipRole ?? normalizeRoleValue(profile.role);

  if (!isSoloScope && !membershipRole && profile.role !== "dev") {
    throw new ApiRouteError(
      403,
      "membership_missing",
      "Company membership record not found",
    );
  }

  if (!allowedRoles.includes(resolvedRole)) {
    throw new ApiRouteError(403, "forbidden", "Role is not allowed for this action");
  }

  return {
    profile,
    role: resolvedRole,
  };
}
