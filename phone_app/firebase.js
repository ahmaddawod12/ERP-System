// firebase.js - React Native Firebase Implementation (Modular API v22+)
// This file exports Firebase services using @react-native-firebase modular API
// Note: Native configuration is in GoogleService-Info.plist (iOS) and google-services.json (Android)

import { getApp } from '@react-native-firebase/app';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  writeBatch,
  runTransaction,
  Timestamp as FirestoreTimestamp,
  FieldValue as FirestoreFieldValue,
  GeoPoint as FirestoreGeoPoint,
} from '@react-native-firebase/firestore';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from '@react-native-firebase/auth';
import storage from '@react-native-firebase/storage';
import {
  getFunctions,
  httpsCallable,
} from '@react-native-firebase/functions';
import {
  getMessaging,
  getToken,
  onMessage,
  onNotificationOpenedApp,
  getInitialNotification,
  onTokenRefresh,
  requestPermission,
  hasPermission,
  subscribeToTopic,
  unsubscribeFromTopic,
  getAPNSToken,
  AuthorizationStatus,
} from '@react-native-firebase/messaging';

// Get the default app instance (modular API)
export const app = getApp();

// Firestore instance (modular API)
export const db = getFirestore(app);

// Auth instance (modular API)
export const auth = getAuth(app);

// Storage - chainable API (use storage().ref())
export { storage };

// Cloud Functions instances (modular API)
export const functions = getFunctions(app);
export const middleEastFunctions = getFunctions(app, 'me-west1');

// Messaging instance (modular API)
export const messaging = getMessaging(app);

// Firestore helper exports (modular API)
export const Timestamp = FirestoreTimestamp;
export const FieldValue = FirestoreFieldValue;
export const GeoPoint = FirestoreGeoPoint;

// Re-export Firestore modular functions for use in other files
export {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  writeBatch,
  runTransaction,
};

// Re-export Auth modular functions
export {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
};

// Note: Storage uses chainable API - use storage().ref().put() for uploads

// Re-export Functions modular functions
export {
  httpsCallable,
};

// Re-export Messaging modular functions
export {
  getToken,
  onMessage,
  onNotificationOpenedApp,
  getInitialNotification,
  onTokenRefresh,
  requestPermission,
  hasPermission,
  subscribeToTopic,
  unsubscribeFromTopic,
  getAPNSToken,
  AuthorizationStatus,
};
