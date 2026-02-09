# Push Notification Setup Guide

This guide explains how to set up push notifications for the Smart-Job app using **Firebase Cloud Messaging (FCM)** and **Notifee**.

## 🔄 Migration from Expo Notifications

The app has migrated from `expo-notifications` to:
- **`@react-native-firebase/messaging`** - For FCM token management and receiving push messages
- **`@notifee/react-native`** - For displaying local notifications and advanced notification features

### Why the change?
- More reliable notification delivery
- Better control over notification display
- Native FCM integration (no Expo push server dependency)
- Advanced notification features (channels, categories, etc.)

---

## 📋 Prerequisites

Before setting up push notifications, ensure you have:

1. **Firebase Project** with:
   - Cloud Messaging enabled
   - iOS app registered
   - Android app registered

2. **Apple Developer Account** (for iOS)

3. **EAS CLI** installed: `npm install -g eas-cli`

---

## 🔥 Firebase Console Setup

### 1. Create/Access Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project or create a new one
3. Navigate to **Project Settings** (gear icon)

### 2. Register Android App

1. Go to **Project Settings > General > Your apps**
2. Click **Add app** > **Android**
3. Enter package name: `com.coolinginventory.app`
4. Download `google-services.json`
5. Place it in your project root: `./google-services.json`

### 3. Register iOS App

1. Go to **Project Settings > General > Your apps**
2. Click **Add app** > **iOS**
3. Enter bundle ID: `com.coolinginventory.app`
4. Download `GoogleService-Info.plist`
5. Place it in your project root (EAS Build will handle it)

---

## 🍎 iOS APNs Setup (Critical!)

Push notifications on iOS require an **APNs Key** or **APNs Certificate** uploaded to Firebase.

### Option 1: APNs Key (Recommended)

1. **Generate APNs Key:**
   - Go to [Apple Developer Portal](https://developer.apple.com/account/resources/authkeys/list)
   - Click **Keys** > **+** (Create Key)
   - Name: `Smart-Job FCM Key`
   - Enable: **Apple Push Notifications service (APNs)**
   - Click **Continue** > **Register**
   - **Download the .p8 file** (you can only download it ONCE!)
   - Note the **Key ID** (shown on the key details page)

2. **Get Your Team ID:**
   - Go to [Apple Developer Account](https://developer.apple.com/account/#/membership/)
   - Note your **Team ID**

3. **Upload to Firebase:**
   - Go to Firebase Console > **Project Settings > Cloud Messaging**
   - Scroll to **Apple app configuration**
   - Under **APNs Authentication Key**, click **Upload**
   - Upload your `.p8` file
   - Enter the **Key ID** (from step 1)
   - Enter your **Team ID** (from step 2)

### Option 2: APNs Certificate (Alternative)

1. **Create Certificate in Apple Developer Portal:**
   - Go to **Certificates, Identifiers & Profiles** > **Certificates**
   - Click **+** > Select **Apple Push Notification service SSL**
   - Follow the wizard to create a certificate
   - Download the certificate (`.cer` file)

2. **Convert to .p12:**
   - Open the `.cer` in Keychain Access
   - Export as `.p12` with a password

3. **Upload to Firebase:**
   - Go to Firebase Console > **Project Settings > Cloud Messaging**
   - Under **APNs Certificates**, upload the `.p12` file

---

## 🤖 Android Setup

Android push notifications work automatically with the `google-services.json` file.

### Notification Icon (Optional but Recommended)

Create a notification icon for Android:

1. Create a 24x24 dp white icon (transparent background)
2. Generate multiple sizes using [Android Asset Studio](https://romannurik.github.io/AndroidAssetStudio/icons-notification.html)
3. Place in `android/app/src/main/res/` directories:
   - `drawable-mdpi/ic_notification.png` (24x24)
   - `drawable-hdpi/ic_notification.png` (36x36)
   - `drawable-xhdpi/ic_notification.png` (48x48)
   - `drawable-xxhdpi/ic_notification.png` (72x72)
   - `drawable-xxxhdpi/ic_notification.png` (96x96)

**Note:** For Expo managed workflow with EAS Build, you may need to configure this differently or use the default icon.

---

## 📦 Dependencies

The following packages are required (already in package.json):

```json
{
  "@notifee/react-native": "^9.1.8",
  "@react-native-firebase/app": "^21.10.2",
  "@react-native-firebase/messaging": "^21.10.2",
  "expo-build-properties": "~0.14.4"
}
```

### Install Dependencies

```bash
npm install
# or
yarn install
```

---

## ⚙️ Configuration Files

### app.json

Key configuration in `app.json`:

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "UIBackgroundModes": ["remote-notification", "fetch"]
      },
      "entitlements": {
        "aps-environment": "production"
      }
    },
    "android": {
      "googleServicesFile": "./google-services.json",
      "permissions": [
        "android.permission.POST_NOTIFICATIONS",
        "android.permission.VIBRATE",
        "android.permission.RECEIVE_BOOT_COMPLETED"
      ]
    },
    "plugins": [
      "expo-router",
      [
        "expo-build-properties",
        {
          "ios": {
            "useFrameworks": "static"
          }
        }
      ],
      "@react-native-firebase/app",
      "@react-native-firebase/messaging"
    ]
  }
}
```

### eas.json

For iOS builds, ensure credentials are set up:

```json
{
  "build": {
    "production": {
      "ios": {
        "credentialsSource": "remote"
      }
    }
  }
}
```

---

## 🏗️ Building the App

### Development Build (with push notifications)

Push notifications require a **development build** (not Expo Go).

```bash
# Build for iOS (physical device)
eas build --profile development --platform ios

# Build for Android
eas build --profile development --platform android
```

### Production Build

```bash
# Build for both platforms
eas build --profile production --platform all
```

---

## 🔑 Firestore Token Storage

The FCM token is stored in the user's Firestore profile:

```
{username}/profile
├── pushToken: "fcm-token-string..."
├── pushTokenUpdatedAt: "2026-02-01T10:30:00.000Z"
├── pushTokenPlatform: "ios" | "android"
└── pushTokenType: "fcm"
```

---

## 📱 How It Works

### 1. Token Registration (Frontend)

On app launch and user login:
1. `initializeNotifications()` creates Android notification channels
2. `requestNotificationPermission()` requests iOS/Android permission
3. `getFCMToken()` retrieves the FCM device token
4. `registerPushTokenForUser()` saves token to Firestore

### 2. Sending Notifications (Cloud Functions)

When a notification needs to be sent:
1. Cloud Function retrieves user's `pushToken` from Firestore
2. Calls `sendPushNotification()` with token and message
3. FCM delivers to device via:
   - **iOS:** APNs (Apple Push Notification service)
   - **Android:** FCM directly

### 3. Receiving Notifications (Frontend)

**App in Foreground:**
- `messaging().onMessage()` receives the message
- `displayLocalNotification()` shows it via Notifee

**App in Background/Quit:**
- System shows notification automatically
- `onNotificationOpenedApp()` handles tap when app was in background
- `getInitialNotification()` handles tap when app was quit

---

## 🧪 Testing Push Notifications

### Test via Firebase Console

1. Go to Firebase Console > **Messaging**
2. Click **Create your first campaign** or **New campaign**
3. Select **Firebase Notification messages**
4. Enter title and body
5. Target:
   - Select your app
   - Or send to specific device with FCM token
6. Review and send

### Test via Cloud Functions

You can test by triggering the Cloud Functions that send notifications:
- Create a job (triggers `onJobAssignTrigger`)
- Submit a job (triggers `onJobSubmitTrigger`)

### Debug Tokens

To debug FCM tokens, add logging in your app:

```javascript
import { getFCMToken, getAPNsToken } from '../utils/notifications';

// Get and log tokens
const fcmToken = await getFCMToken();
console.log('FCM Token:', fcmToken);

// iOS only - check APNs token
const apnsToken = await getAPNsToken();
console.log('APNs Token:', apnsToken);
```

---

## 🐛 Troubleshooting

### iOS Issues

**"Notifications not received"**
1. Verify APNs key is uploaded to Firebase
2. Check `aps-environment` entitlement is set
3. Ensure physical device (not simulator)
4. Check iOS Settings > Notifications > Your App

**"Failed to get APNs token"**
- APNs requires a physical device
- Ensure push notification capability in Xcode

### Android Issues

**"Notifications not showing"**
1. Verify `google-services.json` is correct
2. Check notification permission granted (Android 13+)
3. Verify notification channel exists

**"Token is null"**
- Check Google Play Services is available
- Verify internet connection

### General Issues

**"Invalid token" errors in Cloud Functions**
- Token may be expired - user needs to reopen app
- Token was for a different environment (dev vs prod)
- Old Expo push token instead of FCM token

---

## 📊 Notification Data Payload

When sending from Cloud Functions:

```javascript
const message = {
  notification: {
    title: 'Job Assigned',
    body: 'You have a new job: Fix AC Unit',
  },
  data: {
    type: 'job_assigned',
    screen: 'Workerjob',
    jobId: 'abc123',
  },
  token: pushToken,
};
```

The `data` payload is used for navigation when user taps notification.

---

## 🔐 Security Considerations

1. **Never expose FCM tokens** in logs or errors visible to users
2. **Cloud Functions validate auth** before sending notifications
3. **Token cleanup** happens automatically for invalid tokens
4. **Rate limiting** - FCM has built-in rate limits

---

## 📚 References

- [Firebase Cloud Messaging Documentation](https://firebase.google.com/docs/cloud-messaging)
- [React Native Firebase Messaging](https://rnfirebase.io/messaging/usage)
- [Notifee Documentation](https://notifee.app/react-native/docs/overview)
- [Apple Push Notification service](https://developer.apple.com/documentation/usernotifications)
- [EAS Build Documentation](https://docs.expo.dev/build/introduction/)

---

## ✅ Checklist

Before going to production, ensure:

- [ ] Firebase project created
- [ ] Android app registered in Firebase
- [ ] iOS app registered in Firebase
- [ ] APNs Key uploaded to Firebase (iOS)
- [ ] `google-services.json` in project root
- [ ] `GoogleService-Info.plist` in project root (for reference)
- [ ] Development build tested with real notifications
- [ ] Production build tested
- [ ] Cloud Functions deployed with updated `sendPushNotification`

---

*Last Updated: February 1, 2026*
