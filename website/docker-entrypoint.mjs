import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const markerPath = "/run/secrets/smart_job_local_platform";
const markerValue = "smart-job-erp-local-platform-v1";
const environment = { ...process.env };
const localFlagsPresent = environment.SMART_JOB_DEPLOYMENT_ENV === "local"
  || environment.SMART_JOB_LOCAL_PLATFORM !== undefined
  || environment.LOCAL_PLATFORM_MARKER_PATH !== undefined;

delete environment.SMART_JOB_LOCAL_PLATFORM_VERIFIED;

if (localFlagsPresent) {
  const configuredCorrectly = environment.SMART_JOB_DEPLOYMENT_ENV === "local"
    && environment.SMART_JOB_LOCAL_PLATFORM === "true"
    && environment.LOCAL_PLATFORM_MARKER_PATH === markerPath;
  let markerMatches = false;
  try {
    markerMatches = readFileSync(markerPath, "utf8").trim() === markerValue;
  } catch {
    markerMatches = false;
  }
  if (!configuredCorrectly || !markerMatches) {
    process.stderr.write("Local website overrides require the mounted local-platform marker.\n");
    process.exit(78);
  }
  environment.SMART_JOB_LOCAL_PLATFORM_VERIFIED = "true";
}

const child = spawn(process.execPath, ["server.js"], {
  env: environment,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.once("error", (error) => {
  process.stderr.write(`Unable to start the website: ${error.message}\n`);
  process.exit(1);
});
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
