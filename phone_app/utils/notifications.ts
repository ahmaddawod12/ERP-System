/**
 * Push Notification Utilities - Firebase Cloud Messaging + Notifee
 * 
 * Uses @react-native-firebase/messaging for FCM (token management, background messages)
 * Uses @notifee/react-native for local notifications (foreground display, advanced features)
 * 
 * Tokens are stored as native FCM tokens in user profile: users/{uid}/data/profile.pushToken
 * 
 * SETUP REQUIREMENTS:
 * - iOS: APNs key uploaded to Firebase Console
 * - Android: google-services.json in project root
 * - Both: Firebase project properly configured
 */

import { Platform, PermissionsAndroid } from 'react-native';
import notifee, { AndroidImportance, AndroidVisibility, EventType } from '@notifee/react-native';
import { 
  auth,
  functions,
  httpsCallable,
  messaging,
  getToken,
  requestPermission,
  onMessage,
  onNotificationOpenedApp,
  getInitialNotification,
  onTokenRefresh,
  hasPermission,
  subscribeToTopic as fcmSubscribeToTopic,
  unsubscribeFromTopic as fcmUnsubscribeFromTopic,
  getAPNSToken,
  AuthorizationStatus
} from '../firebase';
import { mmkvHelpers, CACHE_KEYS } from '../contexts/mmkv-storage';
import { logger } from './logger';

// Default Android notification channel ID
const DEFAULT_CHANNEL_ID = 'smart_job_default';
let notificationInitializationPromise: Promise<boolean> | null = null;

type NotificationData = Record<string, string>;

function normalizeNotificationData(data?: Record<string, unknown> | null): NotificationData {
  if (!data) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      return [key, serialized ?? String(value)];
    }),
  );
}

function cacheRegisteredPushToken(pushToken: string): void {
  const cachedProfile = mmkvHelpers.getObject<Record<string, unknown>>(CACHE_KEYS.PROFILE);
  if (!cachedProfile) {
    return;
  }

  mmkvHelpers.setObject(CACHE_KEYS.PROFILE, {
    ...cachedProfile,
    pushToken,
  });
}

async function persistPushToken(pushToken: string): Promise<void> {
  const updatePushTokenFn = httpsCallable(functions, 'updatePushTokenV1');
  await updatePushTokenFn({
    pushToken,
    pushTokenPlatform: Platform.OS,
    pushTokenType: 'fcm',
  });
  cacheRegisteredPushToken(pushToken);
}

/**
 * Initialize Notifee by creating the default Android notification channel
 * This should be called early in app initialization
 */
export async function initializeNotifications(): Promise<boolean> {
  if (!notificationInitializationPromise) {
    notificationInitializationPromise = (async () => {
      try {
        // Create the default Android notification channel once per app process.
        if (Platform.OS === 'android') {
          await notifee.createChannel({
            id: DEFAULT_CHANNEL_ID,
            name: 'Smart Job Notifications',
            description: 'Job assignments, updates, and alerts',
            importance: AndroidImportance.HIGH,
            visibility: AndroidVisibility.PUBLIC,
            sound: 'default',
            vibration: true,
            vibrationPattern: [300, 500], // [vibrate 300ms, pause 500ms] - MUST be even number of POSITIVE values
            lights: true,
            lightColor: '#00ACC1',
          });
          logger.debug('✅ Android notification channel created');
        }

        return true;
      } catch (error) {
        notificationInitializationPromise = null;
        logger.error('Error initializing notifications:', error);
        return false;
      }
    })();
  }

  return notificationInitializationPromise;
}

/**
 * Request notification permissions
 * Returns true if permission is granted
 * 
 * @returns {Promise<boolean>} Permission granted status
 */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    if (Platform.OS === 'ios') {
      // iOS: Request permission via Firebase Messaging (modular API)
      const authStatus = await requestPermission(messaging);
      const enabled =
        authStatus === AuthorizationStatus.AUTHORIZED ||
        authStatus === AuthorizationStatus.PROVISIONAL;
      
      logger.debug(`📱 iOS notification permission: ${enabled ? 'granted' : 'denied'}`);
      return enabled;
    } else if (Platform.OS === 'android') {
      // Android 13+ (API 33+): Need to request POST_NOTIFICATIONS permission
      if (Platform.Version >= 33) {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
        );
        const enabled = result === PermissionsAndroid.RESULTS.GRANTED;
        logger.debug(`📱 Android notification permission: ${enabled ? 'granted' : 'denied'}`);
        return enabled;
      }
      // Android < 13: Notifications enabled by default
      return true;
    }
    return false;
  } catch (error) {
    logger.error('Error requesting notification permission:', error);
    return false;
  }
}

/**
 * Get the FCM device token
 * This is the native Firebase Cloud Messaging token (not Expo push token)
 * 
 * @returns {Promise<string|null>} FCM token or null
 */
export async function getFCMToken(): Promise<string | null> {
  try {
    // Ensure permissions are granted
    const hasPermission = await requestNotificationPermission();
    if (!hasPermission) {
      logger.warn('Notification permission not granted - cannot get FCM token');
      return null;
    }

    // Get FCM token
    const fcmToken = await getToken(messaging);
    
    if (fcmToken) {
      logger.debug('🔑 FCM Token obtained:', fcmToken.substring(0, 30) + '...');
      return fcmToken;
    }
    
    return null;
  } catch (error) {
    logger.error('Error getting FCM token:', error);
    return null;
  }
}

/**
 * Register push token for the current user
 * Saves native FCM token to Firestore user profile
 * Always overwrites existing token (handles token rotation)
 * 
 * @param {string} userId - User's Firebase Auth UID
 * @returns {Promise<boolean>} Success status
 */
export async function registerPushTokenForUser(userId: string): Promise<boolean> {
  if (!userId) {
    logger.error('registerPushTokenForUser: No userId provided');
    return false;
  }

  try {
    // Get FCM token
    const fcmToken = await getFCMToken();

    if (!fcmToken) {
      logger.debug('No FCM token available - skipping registration');
      return false;
    }

    // Quick client-side check to skip if token hasn't changed
    const cachedProfile = mmkvHelpers.getObject<{ pushToken?: string }>(CACHE_KEYS.PROFILE);
    if (cachedProfile?.pushToken === fcmToken) {
      logger.debug('FCM token unchanged - skipping update');
      return true;
    }

    const activeUserId = auth.currentUser?.uid;
    if (!activeUserId || activeUserId !== userId) {
      logger.debug('Skipping push token registration because the active auth session changed');
      return false;
    }

    // Use Cloud Function to update push token (profile is read-only from client)
    await persistPushToken(fcmToken);

    logger.debug(`✅ FCM token registered for ${userId}`);
    return true;
  } catch (error) {
    logger.error('Error registering push token:', error);
    
    // If profile doesn't exist, the CF will throw not-found - this is expected for new users
    if ((error as { code?: string }).code === 'functions/not-found' || (error as { code?: string }).code === 'not-found') {
      logger.warn('User profile not found - push token registration skipped');
    }
    
    return false;
  }
}

/**
 * Display a local notification using Notifee
 * This is used to show notifications when app is in foreground
 * 
 * @param {Object} notification - Notification data
 * @param {string} notification.title - Notification title
 * @param {string} notification.body - Notification body
 * @param {Object} notification.data - Custom data payload
 */
interface LocalNotificationParams {
  title: string;
  body: string;
  data?: NotificationData;
}

export async function displayLocalNotification({ title, body, data = {} }: LocalNotificationParams): Promise<void> {
  try {
    const androidNotification: Record<string, unknown> = {
      channelId: DEFAULT_CHANNEL_ID,
      importance: AndroidImportance.HIGH,
      pressAction: {
        id: 'default',
      },
      color: '#00ACC1',
      sound: 'default',
    };
    await notifee.displayNotification({
      title: title,
      body: body,
      data: data,
      android: androidNotification,
      ios: {
        sound: 'default',
        foregroundPresentationOptions: {
          badge: true,
          sound: true,
          banner: true,
          list: true,
        },
      },
    });
    logger.debug('📬 Local notification displayed:', title);
  } catch (error) {
    logger.error('Error displaying local notification:', error);
  }
}

/**
 * Set up notification listeners
 * Call this in your root component (e.g., _layout.js or index.js)
 * 
 * Handles:
 * - Foreground messages (displays local notification via Notifee)
 * - Background/quit message handling
 * - Notification tap interactions
 * 
 * @param {Function} onNotificationReceived - Called when notification is received while app is in foreground
 * @param {Function} onNotificationTapped - Called when user taps on notification
 * @returns {Function} Cleanup function to remove listeners
 */
interface NotificationTapEvent {
  type: 'background' | 'quit' | 'foreground';
  data: NotificationData;
  notification: unknown;
}

export function setupNotificationListeners(
  onNotificationReceived?: (message: unknown) => void,
  onNotificationTapped?: (event: NotificationTapEvent) => void,
): () => void {
  const unsubscribers: Array<() => void> = [];

  // Initialize notification channels
  void initializeNotifications();

  // 1. Foreground message handler (FCM)
  // When app is in foreground, FCM won't display notifications automatically
  // We use Notifee to display them
  const unsubscribeForeground = onMessage(messaging, async (remoteMessage) => {
    logger.debug('📬 FCM foreground message received:', remoteMessage);
    
    const { notification, data } = remoteMessage;
    
    if (notification) {
      // Display notification using Notifee
      await displayLocalNotification({
        title: notification.title || 'New Notification',
        body: notification.body || '',
        data: normalizeNotificationData(data),
      });
    }
    
    // Call user callback
    if (onNotificationReceived) {
      onNotificationReceived(remoteMessage);
    }
  });
  unsubscribers.push(unsubscribeForeground);

  // 2. Background message handler is set up in index.js (must be outside component)

  // 3. Notification opened app (from background state)
  const unsubscribeNotificationOpened = onNotificationOpenedApp(messaging, (remoteMessage) => {
    logger.debug('👆 Notification opened app from background:', remoteMessage);
    
    if (onNotificationTapped) {
      onNotificationTapped({
        type: 'background',
        data: normalizeNotificationData(remoteMessage.data),
        notification: remoteMessage.notification,
      });
    }
  });
  unsubscribers.push(unsubscribeNotificationOpened);

  // 4. Check if app was opened from a quit state by notification
  getInitialNotification(messaging)
    .then((remoteMessage) => {
      if (remoteMessage) {
        logger.debug('🚀 App opened from quit state by notification:', remoteMessage);
        
        if (onNotificationTapped) {
          onNotificationTapped({
            type: 'quit',
            data: normalizeNotificationData(remoteMessage.data),
            notification: remoteMessage.notification,
          });
        }
      }
    });

  // 5. Notifee foreground event handler (for notification interactions)
  const unsubscribeNotifee = notifee.onForegroundEvent(({ type, detail }) => {
    logger.debug('🔔 Notifee foreground event:', type, detail);
    
    switch (type) {
      case EventType.PRESS:
        // User pressed on notification
        if (onNotificationTapped) {
          onNotificationTapped({
            type: 'foreground',
            data: normalizeNotificationData(detail.notification?.data),
            notification: detail.notification,
          });
        }
        break;
      case EventType.DISMISSED:
        // User dismissed notification
        logger.debug('Notification dismissed');
        break;
      default:
        break;
    }
  });
  unsubscribers.push(unsubscribeNotifee);

  // 6. Token refresh listener — P1-8: save refreshed tokens to server
  const unsubscribeTokenRefresh = onTokenRefresh(messaging, async (newToken) => {
    logger.debug('🔄 FCM token refreshed:', newToken.substring(0, 30) + '...');
    const activeUserId = auth.currentUser?.uid;
    if (!activeUserId) {
      logger.debug('Skipping refreshed FCM token sync because no user is authenticated');
      return;
    }

    try {
      await persistPushToken(newToken);
      logger.debug('✅ Refreshed FCM token saved to server');
    } catch (err) {
      logger.error('Failed to save refreshed FCM token:', err);
    }
  });
  unsubscribers.push(unsubscribeTokenRefresh);

  // Return cleanup function
  return () => {
    unsubscribers.forEach((unsubscribe) => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    });
  };
}

/**
 * Get the last notification that opened the app (from quit state)
 * Call this on app startup to check if app was opened from a notification
 * 
 * @returns {Promise<Object|null>} Notification data or null
 */
export async function getLastNotificationResponse(): Promise<{ data: NotificationData; notification: unknown } | null> {
  try {
    const remoteMessage = await getInitialNotification(messaging);
    if (remoteMessage) {
      return {
        data: normalizeNotificationData(remoteMessage.data),
        notification: remoteMessage.notification,
      };
    }
    return null;
  } catch (error) {
    logger.error('Error getting initial notification:', error);
    return null;
  }
}

/**
 * Clear all notifications from the notification center
 * @returns {Promise<void>}
 */
export async function clearAllNotifications(): Promise<void> {
  try {
    await notifee.cancelAllNotifications();
    logger.debug('✅ All notifications cleared');
  } catch (error) {
    logger.error('Error clearing notifications:', error);
  }
}

/**
 * Set badge count on app icon
 * @param {number} count - Badge count (0 to clear)
 * @returns {Promise<void>}
 */
export async function setBadgeCount(count: number): Promise<void> {
  try {
    await notifee.setBadgeCount(count);
    logger.debug(`✅ Badge count set to ${count}`);
  } catch (error) {
    logger.error('Error setting badge count:', error);
  }
}

/**
 * Get current badge count
 * @returns {Promise<number>} Current badge count
 */
export async function getBadgeCount(): Promise<number> {
  try {
    const count = await notifee.getBadgeCount();
    return count;
  } catch (error) {
    logger.error('Error getting badge count:', error);
    return 0;
  }
}

/**
 * Check if notifications are enabled
 * @returns {Promise<boolean>} Whether notifications are enabled
 */
export async function areNotificationsEnabled(): Promise<boolean> {
  try {
    if (Platform.OS === 'ios') {
      const authStatus = await hasPermission(messaging);
      return (
        authStatus === AuthorizationStatus.AUTHORIZED ||
        authStatus === AuthorizationStatus.PROVISIONAL
      );
    } else {
      // For Android, check the notification settings
      const settings = await notifee.getNotificationSettings();
      return settings.authorizationStatus >= 1; // AUTHORIZED or PROVISIONAL
    }
  } catch (error) {
    logger.error('Error checking notification status:', error);
    return false;
  }
}

/**
 * Request notification permissions and get FCM token
 * Convenience function that combines permission request and token retrieval
 * 
 * @returns {Promise<{granted: boolean, token: string|null}>}
 */
export async function setupPushNotifications(): Promise<{ granted: boolean; token: string | null }> {
  const granted = await requestNotificationPermission();
  
  if (!granted) {
    return { granted: false, token: null };
  }
  
  const token = await getFCMToken();
  return { granted: true, token };
}

/**
 * Subscribe to a topic for broadcast notifications
 * Useful for sending notifications to all users or specific groups
 * 
 * @param {string} topic - Topic name to subscribe to
 * @returns {Promise<boolean>} Success status
 */
export async function subscribeToTopic(topic: string): Promise<boolean> {
  try {
    await fcmSubscribeToTopic(messaging, topic);
    logger.debug(`✅ Subscribed to topic: ${topic}`);
    return true;
  } catch (error) {
    logger.error(`Error subscribing to topic ${topic}:`, error);
    return false;
  }
}

/**
 * Unsubscribe from a topic
 * 
 * @param {string} topic - Topic name to unsubscribe from
 * @returns {Promise<boolean>} Success status
 */
export async function unsubscribeFromTopic(topic: string): Promise<boolean> {
  try {
    await fcmUnsubscribeFromTopic(messaging, topic);
    logger.debug(`✅ Unsubscribed from topic: ${topic}`);
    return true;
  } catch (error) {
    logger.error(`Error unsubscribing from topic ${topic}:`, error);
    return false;
  }
}

/**
 * Get APNs token for iOS (useful for debugging)
 * @returns {Promise<string|null>} APNs token or null
 */
export async function getAPNsToken(): Promise<string | null> {
  if (Platform.OS !== 'ios') {
    return null;
  }
  
  try {
    const apnsToken = await getAPNSToken(messaging);
    if (apnsToken) {
      logger.debug('🍎 APNs token:', apnsToken.substring(0, 30) + '...');
    }
    return apnsToken;
  } catch (error) {
    logger.error('Error getting APNs token:', error);
    return null;
  }
}


