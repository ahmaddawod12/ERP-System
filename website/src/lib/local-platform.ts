export type LocalPlatformEnvironment = Readonly<Record<string, string | undefined>>;

export const LOCAL_PLATFORM_MARKER_PATH = "/run/secrets/smart_job_local_platform";

export function isVerifiedLocalPlatformRuntime(
  environment: LocalPlatformEnvironment = process.env,
): boolean {
  return environment.SMART_JOB_DEPLOYMENT_ENV === "local"
    && environment.SMART_JOB_LOCAL_PLATFORM === "true"
    && environment.SMART_JOB_LOCAL_PLATFORM_VERIFIED === "true"
    && environment.LOCAL_PLATFORM_MARKER_PATH === LOCAL_PLATFORM_MARKER_PATH;
}

export function hasLocalPlatformFlags(
  environment: LocalPlatformEnvironment = process.env,
): boolean {
  return environment.SMART_JOB_DEPLOYMENT_ENV === "local"
    || environment.SMART_JOB_LOCAL_PLATFORM !== undefined
    || environment.SMART_JOB_LOCAL_PLATFORM_VERIFIED !== undefined
    || environment.LOCAL_PLATFORM_MARKER_PATH !== undefined;
}
