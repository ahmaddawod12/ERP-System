import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'expo-router';

import { restoreFirebaseUser } from '../lib/auth/firebase-auth';
import { notificationMatchesAudience } from '../lib/notifications/audience';
import { NOTIFICATION_SCREEN_ROUTES } from '../navigation/routes';
import {
  initializeNotifications,
  registerPushTokenForUser,
  setupNotificationListeners,
  type NotificationTapEvent,
} from '../utils/notifications';
import { logger } from '../utils/logger';
import { useSession } from './SessionContext';
import { useTenant } from './TenantContext';

interface NotificationContextValue {
  readonly initialized: boolean;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

function notificationRoute(event: NotificationTapEvent): string | null {
  const data = event.data;
  if (data.type === 'job_assigned' && data.screen === 'Workerjob') {
    return NOTIFICATION_SCREEN_ROUTES.Workerjob;
  }
  if (data.type === 'job_submitted' && data.screen === 'ManageJobs') {
    return NOTIFICATION_SCREEN_ROUTES.ManageJobs;
  }
  return null;
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user } = useSession();
  const userId = user?.uid ?? null;
  const { status: tenantStatus, workspace, workspaces } = useTenant();
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    let active = true;
    void initializeNotifications().then((ready) => {
      if (active) {
        setInitialized(ready);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      !userId
      || !initialized
      || tenantStatus !== 'ready'
      || !workspace
    ) {
      return;
    }

    let active = true;
    const currentCompanyId = workspace.companyId;
    const accessibleCompanyIds = new Set(workspaces.map((candidate) => candidate.companyId));
    const guard = async (data: Readonly<Record<string, string>>): Promise<boolean> => {
      try {
        const restoredUser = await restoreFirebaseUser();
        return Boolean(
          active
          && restoredUser
          && notificationMatchesAudience(data, {
            restoredUserId: restoredUser.uid,
            sessionUserId: userId,
            currentCompanyId,
            accessibleCompanyIds,
          }),
        );
      } catch (error) {
        logger.warn('Notification identity restoration failed; ignoring the message:', error);
        return false;
      }
    };

    const unsubscribe = setupNotificationListeners(
      userId,
      guard,
      () => undefined,
      (event) => {
        if (!active) {
          return;
        }
        const route = notificationRoute(event);
        if (!route) {
          logger.warn('Ignoring notification without a supported route');
          return;
        }
        router.push(route as never);
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [initialized, router, tenantStatus, userId, workspace, workspaces]);

  useEffect(() => {
    if (!userId || tenantStatus !== 'ready') {
      return;
    }
    void registerPushTokenForUser(userId).catch((error: unknown) => {
      logger.warn('Push token registration failed:', error);
    });
  }, [tenantStatus, userId]);

  const value = useMemo<NotificationContextValue>(() => ({
    initialized,
  }), [initialized]);

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotificationContext(): NotificationContextValue {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotificationContext must be used within NotificationProvider');
  }
  return context;
}
