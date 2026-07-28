#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const forbiddenTrackedFiles = new Set([
  "phone_app/google-services.json",
  "phone_app/GoogleService-Info.plist",
]);
const tracked = spawnSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
});
if (tracked.error) throw tracked.error;
if (tracked.status !== 0) {
  throw new Error(`git ls-files failed with status ${tracked.status}`);
}
for (const path of tracked.stdout.split("\0").filter(Boolean)) {
  if (forbiddenTrackedFiles.has(path.replaceAll("\\", "/"))) {
    throw new Error(`${path} must be supplied through an EAS file-secret variable`);
  }
}

const appConfig = readFileSync(resolve(root, "phone_app", "app.config.ts"), "utf8");
const easConfig = readFileSync(resolve(root, "phone_app", "eas.json"), "utf8");
const publicNativeFileVariable =
  /EXPO_PUBLIC_[A-Z0-9_]*(?:GOOGLE_SERVICES|GOOGLE_SERVICE_INFO|FIREBASE[A-Z0-9_]*FILE)/;
if (publicNativeFileVariable.test(appConfig) || publicNativeFileVariable.test(easConfig)) {
  throw new Error("Firebase native service files must never use EXPO_PUBLIC_ variables");
}
for (const variable of ["GOOGLE_SERVICES_JSON", "GOOGLE_SERVICE_INFO_PLIST"]) {
  if (!appConfig.includes(variable)) {
    throw new Error(`Expo config must resolve the ${variable} EAS file secret`);
  }
}

const eas = JSON.parse(easConfig);
for (const profile of ["development", "preview", "production"]) {
  if (eas.build?.[profile]?.environment !== profile) {
    throw new Error(`EAS profile ${profile} must bind to its matching environment`);
  }
}

process.stdout.write("Mobile native configuration safeguards passed.\n");
