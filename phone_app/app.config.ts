import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { ConfigContext, ExpoConfig } from "expo/config";

type NativeServiceFileOptions = {
  readonly environmentName: string;
  readonly localFileName: string;
};

export function resolveNativeServiceFile({
  environmentName,
  localFileName,
}: NativeServiceFileOptions): string | undefined {
  const secretFilePath = process.env[environmentName]?.trim();
  if (secretFilePath) return secretFilePath;

  if (existsSync(resolve(import.meta.dirname, localFileName))) {
    return `./${localFileName}`;
  }

  if (process.env.EAS_BUILD === "true") {
    throw new Error(
      `${environmentName} must be configured as an EAS file-secret variable`,
    );
  }
  return undefined;
}

export default function configureExpo(_context: ConfigContext): ExpoConfig {
  const googleServicesFile = resolveNativeServiceFile({
    environmentName: "GOOGLE_SERVICES_JSON",
    localFileName: "google-services.json",
  });
  const googleServiceInfoFile = resolveNativeServiceFile({
    environmentName: "GOOGLE_SERVICE_INFO_PLIST",
    localFileName: "GoogleService-Info.plist",
  });

  return {
    name: "erp-system",
    slug: "erp-system",
    version: "1.0.0",
    orientation: "default",
    icon: "./assets/icon.png",
    userInterfaceStyle: "automatic",
    assetBundlePatterns: ["**/*"],
    ios: {
      ...(googleServiceInfoFile ? { googleServicesFile: googleServiceInfoFile } : {}),
      supportsTablet: true,
      bundleIdentifier: "erpsystem.app",
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        UIBackgroundModes: ["remote-notification", "fetch"],
      },
      entitlements: {
        "aps-environment": "production",
      },
    },
    android: {
      ...(googleServicesFile ? { googleServicesFile } : {}),
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#1e3a8a",
      },
      package: "erpsystem.app",
      permissions: [
        "android.permission.CAMERA",
        "android.permission.POST_NOTIFICATIONS",
        "android.permission.VIBRATE",
      ],
    },
    web: {
      favicon: "./assets/favicon.png",
    },
    plugins: [
      "expo-router",
      "@react-native-firebase/app",
      "@react-native-firebase/messaging",
      "@react-native-firebase/crashlytics",
      [
        "expo-build-properties",
        {
          ios: {
            useFrameworks: "static",
            forceStaticLinking: ["RNFBApp", "RNFBMessaging", "RNFBCrashlytics"],
            extraPods: [
              {
                name: "GoogleUtilities",
                modular_headers: true,
              },
            ],
          },
          android: {
            compileSdkVersion: 36,
            targetSdkVersion: 36,
            buildToolsVersion: "36.0.0",
          },
        },
      ],
      [
        "expo-camera",
        {
          cameraPermission: "Allow $(PRODUCT_NAME) to access your camera to take photos of work.",
        },
      ],
      "expo-font",
      "expo-sharing",
      "expo-secure-store",
      "expo-status-bar",
      [
        "expo-splash-screen",
        {
          image: "./assets/splash.png",
          resizeMode: "contain",
          backgroundColor: "#1e3a8a",
        },
      ],
      [
        "expo-sqlite",
        {
          useSQLCipher: true,
        },
      ],
    ],
    scheme: "erpsystem",
    extra: {
      router: {},
      eas: {
        projectId: "80bc4597-cc65-476b-80d6-1e88c88e2d7b",
      },
    },
    runtimeVersion: {
      policy: "appVersion",
    },
  };
}
