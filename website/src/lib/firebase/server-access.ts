import { adminDb } from "@/lib/firebase/admin";
import { ApiRouteError } from "@/lib/api/errors";
import type { Role, UserProfile } from "@/lib/types";

export interface CompanyAccessResult {
  profile: UserProfile;
  role: Role;
  soloScope: boolean;
}

export async function getUserProfileOrThrow(uid: string): Promise<UserProfile> {
  const profileRef = adminDb().collection("users").doc(uid).collection("profile").doc("data");
  const profileSnap = await profileRef.get();
  if (!profileSnap.exists) {
    throw new ApiRouteError(403, "profile_not_found", "User profile not found");
  }
  return profileSnap.data() as UserProfile;
}

export async function getWorkerRoleForCompany(
  companyId: string,
  uid: string,
): Promise<Role | null> {
  const workerRef = adminDb().collection("companies").doc(companyId).collection("workers").doc(uid);
  const workerSnap = await workerRef.get();
  if (!workerSnap.exists) {
    return null;
  }
  return (workerSnap.data()?.role as Role) ?? null;
}

export async function assertCompanyAccess(params: {
  uid: string;
  companyId: string;
  allowedRoles: Role[];
  allowSoloScope?: boolean;
}): Promise<CompanyAccessResult> {
  const { uid, companyId, allowedRoles, allowSoloScope = false } = params;
  const profile = await getUserProfileOrThrow(uid);

  const isSoloScope =
    allowSoloScope &&
    profile.accountType === "solo" &&
    profile.companyId === null &&
    uid === companyId;

  if (isSoloScope) {
    if (!allowedRoles.includes(profile.role)) {
      throw new ApiRouteError(403, "forbidden", "Role is not allowed for this action");
    }
    return { profile, role: profile.role, soloScope: true };
  }

  if (profile.companyId !== companyId && profile.role !== "Dev") {
    throw new ApiRouteError(403, "company_mismatch", "User does not belong to this company");
  }

  const workerRole = await getWorkerRoleForCompany(companyId, uid);
  const resolvedRole = workerRole ?? profile.role;

  if (!workerRole && profile.role !== "Dev") {
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
    soloScope: false,
  };
}

