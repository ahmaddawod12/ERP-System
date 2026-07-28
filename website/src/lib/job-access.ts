import type { Role, UserProfile, WorkerProfile } from "./types";

type JobFormValues = {
  title: string;
  cname: string;
  cphone: string;
  description: string;
  location: string;
};

type MembershipProfile = Pick<UserProfile, "name" | "email" | "mid" | "wid"> | null | undefined;
type Assignee = Pick<WorkerProfile, "wid" | "name" | "email"> | null | undefined;

const SCOPED_JOB_ROLES = new Set<Role>(["worker", "user"]);

export function normalizeMembershipId(value: string | number | null | undefined): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}

export function roleUsesScopedJobAccess(role: Role | null | undefined) {
  return role != null && SCOPED_JOB_ROLES.has(role);
}

export function buildMembershipQueryValues(value: string | number | null | undefined) {
  const normalized = normalizeMembershipId(value);
  if (!normalized) return [];

  const numericValue = Number(normalized);
  if (Number.isInteger(numericValue) && String(numericValue) === normalized) {
    return [normalized, numericValue] as const;
  }

  return [normalized] as const;
}

export function canListCompanyJobs(role: Role | null | undefined, wid: string | null | undefined) {
  if (!roleUsesScopedJobAccess(role)) return true;
  return Boolean(normalizeMembershipId(wid));
}

export function buildListJobsOptions(role: Role | null | undefined, profile: MembershipProfile) {
  const workerWid = roleUsesScopedJobAccess(role) ? normalizeMembershipId(profile?.wid) : undefined;
  return {
    role: role ?? undefined,
    ...(workerWid ? { wid: workerWid } : {}),
  };
}

export function getWorkerDisplayName(worker: Assignee) {
  if (!worker) return null;
  return worker.name || worker.email || normalizeMembershipId(worker.wid) || null;
}

function getManagerMetadata(profile: MembershipProfile) {
  const managerName = profile?.name?.trim() || undefined;
  const managerMid = normalizeMembershipId(profile?.mid);

  return {
    ...(managerName ? { mname: managerName } : {}),
    ...(managerMid ? { mid: managerMid } : {}),
  };
}

export function buildManagedJobCreatePayload(
  form: JobFormValues,
  managerProfile: MembershipProfile,
  assignee: Assignee,
) {
  return {
    title: form.title,
    cname: form.cname,
    ...(form.cphone ? { cphone: form.cphone } : {}),
    description: form.description,
    ...(form.location ? { location: form.location } : {}),
    status: "pending" as const,
    ...getManagerMetadata(managerProfile),
    wid: normalizeMembershipId(assignee?.wid) ?? null,
    wname: getWorkerDisplayName(assignee) ?? null,
  };
}

export function buildSoloFinishedJobPayload(form: JobFormValues, profile: MembershipProfile) {
  const wid = normalizeMembershipId(profile?.wid) ?? null;
  const wname = profile?.name?.trim();

  return {
    title: form.title,
    cname: form.cname,
    ...(form.cphone ? { cphone: form.cphone } : {}),
    description: form.description,
    ...(form.location ? { location: form.location } : {}),
    wid,
    ...(wname ? { wname } : {}),
  };
}

export function buildJobAssignmentPatch(assignee: Assignee, managerProfile: MembershipProfile) {
  return {
    ...getManagerMetadata(managerProfile),
    wid: normalizeMembershipId(assignee?.wid) ?? null,
    wname: getWorkerDisplayName(assignee) ?? null,
  };
}
