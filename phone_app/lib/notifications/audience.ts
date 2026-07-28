const AUTH_USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type NotificationData = Readonly<Record<string, string>>;

export interface NotificationAudienceScope {
  readonly restoredUserId: string;
  readonly sessionUserId: string;
  readonly currentCompanyId: number;
  readonly accessibleCompanyIds: ReadonlySet<number>;
}

export interface NotificationAudience {
  readonly userId: string;
  readonly companyId: number;
}

export function parseNotificationAudience(
  data: NotificationData,
): NotificationAudience | null {
  const userId = String(data.uid ?? '').trim().toLowerCase();
  const companyId = Number(data.companyId);
  if (
    !AUTH_USER_ID_PATTERN.test(userId)
    || !Number.isSafeInteger(companyId)
    || companyId <= 0
  ) {
    return null;
  }
  return { userId, companyId };
}

/**
 * Notification payloads are untrusted input. A message is actionable only for
 * the restored identity and the tenant currently visible in the application.
 */
export function notificationMatchesAudience(
  data: NotificationData,
  scope: NotificationAudienceScope,
): boolean {
  const audience = parseNotificationAudience(data);
  const restoredUserId = scope.restoredUserId.trim().toLowerCase();
  const sessionUserId = scope.sessionUserId.trim().toLowerCase();
  return Boolean(
    audience
    && audience.userId === restoredUserId
    && audience.userId === sessionUserId
    && audience.companyId === scope.currentCompanyId
    && scope.accessibleCompanyIds.has(audience.companyId),
  );
}
