import { getApp } from '@react-native-firebase/app';
import {
  AuthorizationStatus,
  getAPNSToken,
  getInitialNotification,
  getMessaging,
  getToken,
  hasPermission,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  requestPermission,
  subscribeToTopic,
  unsubscribeFromTopic,
} from '@react-native-firebase/messaging';

export const messaging = getMessaging(getApp());

export {
  AuthorizationStatus,
  getAPNSToken,
  getInitialNotification,
  getToken,
  hasPermission,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  requestPermission,
  subscribeToTopic,
  unsubscribeFromTopic,
};
