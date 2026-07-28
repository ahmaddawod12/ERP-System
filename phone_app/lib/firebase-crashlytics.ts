import {
  getCrashlytics,
  log,
  recordError,
  setCrashlyticsCollectionEnabled,
  setUserId,
} from '@react-native-firebase/crashlytics';

let crashlytics: ReturnType<typeof getCrashlytics> | null = null;

function crashReporter(): ReturnType<typeof getCrashlytics> {
  crashlytics ??= getCrashlytics();
  return crashlytics;
}

export async function initializeCrashlytics(): Promise<void> {
  await setCrashlyticsCollectionEnabled(crashReporter(), !__DEV__);
}

export async function setCrashlyticsUser(userId: string | null): Promise<void> {
  await setUserId(crashReporter(), userId ?? '');
}

export function recordCrashlyticsError(error: unknown): void {
  try {
    recordError(crashReporter(), error instanceof Error ? error : new Error(String(error)));
  } catch {
    // Crash reporting must never interrupt authentication or application recovery.
  }
}

export function logCrashlyticsMessage(message: string): void {
  try {
    log(crashReporter(), message);
  } catch {
    // Logging is best-effort when the native module is unavailable.
  }
}
