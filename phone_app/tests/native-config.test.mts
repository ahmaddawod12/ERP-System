import assert from "node:assert/strict";
import test from "node:test";

import configureExpo, { resolveNativeServiceFile } from "../app.config.ts";

test("Expo native config prefers EAS file-secret paths", () => {
  const previousAndroid = process.env.GOOGLE_SERVICES_JSON;
  const previousIos = process.env.GOOGLE_SERVICE_INFO_PLIST;
  process.env.GOOGLE_SERVICES_JSON = "/eas/secrets/google-services.json";
  process.env.GOOGLE_SERVICE_INFO_PLIST = "/eas/secrets/GoogleService-Info.plist";
  try {
    const config = configureExpo({} as never);
    assert.equal(config.android?.googleServicesFile, "/eas/secrets/google-services.json");
    assert.equal(config.ios?.googleServicesFile, "/eas/secrets/GoogleService-Info.plist");
  } finally {
    if (previousAndroid === undefined) delete process.env.GOOGLE_SERVICES_JSON;
    else process.env.GOOGLE_SERVICES_JSON = previousAndroid;
    if (previousIos === undefined) delete process.env.GOOGLE_SERVICE_INFO_PLIST;
    else process.env.GOOGLE_SERVICE_INFO_PLIST = previousIos;
  }
});

test("EAS builds fail closed when a native file secret and local fallback are absent", () => {
  const previousBuild = process.env.EAS_BUILD;
  process.env.EAS_BUILD = "true";
  try {
    assert.throws(
      () => resolveNativeServiceFile({
        environmentName: "MISSING_NATIVE_FILE_TEST",
        localFileName: "missing-native-file.test",
      }),
      /must be configured as an EAS file-secret variable/,
    );
  } finally {
    if (previousBuild === undefined) delete process.env.EAS_BUILD;
    else process.env.EAS_BUILD = previousBuild;
  }
});
