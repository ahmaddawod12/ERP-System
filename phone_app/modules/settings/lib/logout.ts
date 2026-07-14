export interface LogoutSequenceOptions {
  readonly userId: string | null;
  readonly clearPushToken: (userId: string) => Promise<unknown>;
  readonly signOut: () => Promise<void>;
  readonly clearCache: () => void;
  readonly onPushTokenClearError: (error: unknown) => void;
}

export async function runLogoutSequence(options: LogoutSequenceOptions): Promise<void> {
  if (options.userId) {
    try {
      await options.clearPushToken(options.userId);
    } catch (error) {
      options.onPushTokenClearError(error);
    }
  }

  await options.signOut();
  options.clearCache();
}
