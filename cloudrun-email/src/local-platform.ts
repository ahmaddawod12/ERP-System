import { readFileSync } from "node:fs";

export const LOCAL_PLATFORM_MARKER = "smart-job-erp-local-platform-v1";
export const LOCAL_PLATFORM_MARKER_PATH = "/run/secrets/smart_job_local_platform";
export type LocalMarkerReader = (path: string, encoding: BufferEncoding) => string | Buffer;

export function isVerifiedLocalPlatform(
  environment: NodeJS.ProcessEnv = process.env,
  readMarker: LocalMarkerReader = readFileSync,
): boolean {
  if (
    environment.SMART_JOB_DEPLOYMENT_ENV !== "local"
    || environment.SMART_JOB_LOCAL_PLATFORM !== "true"
    || environment.LOCAL_PLATFORM_MARKER_PATH !== LOCAL_PLATFORM_MARKER_PATH
  ) return false;
  try {
    return String(readMarker(LOCAL_PLATFORM_MARKER_PATH, "utf8")).trim()
      === LOCAL_PLATFORM_MARKER;
  } catch {
    return false;
  }
}
