import { readFileSync } from "node:fs";

export const LOCAL_PLATFORM_MARKER = "smart-job-erp-local-platform-v1";
export const LOCAL_PLATFORM_MARKER_PATH = "/run/secrets/smart_job_local_platform";
export type LocalMarkerReader = (path: string, encoding: BufferEncoding) => string | Buffer;

export function verifyLocalTaxMode(
  environment: NodeJS.ProcessEnv,
  taxSubmissionMode: string,
  readMarker: LocalMarkerReader = readFileSync,
): boolean {
  const localFlagsPresent = environment.SMART_JOB_DEPLOYMENT_ENV === "local"
    || environment.SMART_JOB_LOCAL_PLATFORM !== undefined
    || environment.LOCAL_PLATFORM_MARKER_PATH !== undefined;
  if (!localFlagsPresent) return false;
  let markerMatches = false;
  try {
    markerMatches = String(readMarker(LOCAL_PLATFORM_MARKER_PATH, "utf8")).trim()
      === LOCAL_PLATFORM_MARKER;
  } catch {
    markerMatches = false;
  }
  if (
    environment.SMART_JOB_DEPLOYMENT_ENV !== "local"
    || environment.SMART_JOB_LOCAL_PLATFORM !== "true"
    || environment.LOCAL_PLATFORM_MARKER_PATH !== LOCAL_PLATFORM_MARKER_PATH
    || !markerMatches
  ) {
    throw new Error("Local tax overrides require the mounted local-platform marker");
  }
  if (taxSubmissionMode !== "disabled") {
    throw new Error("Tax submission must remain disabled on the local platform");
  }
  return true;
}
