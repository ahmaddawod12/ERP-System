# GitHub Copilot Instructions for Smart-Job ERP

## 🎯 Application Overview

**Smart-Job ERP** is a comprehensive **cross-platform business management system** built with **React Native Expo Router**. The app is designed for **both iOS and Android platforms** and serves **solo business owners** and **business owners with teams of workers** to efficiently manage jobs, track inventory parts, and generate professional business documents.

**Target Users**:
- **Solo business owners** (User/Basic roles) — manage their own jobs, inventory, and documents
- **Business owners with teams** (Manager role) — manage workers, assign jobs, track company-wide inventory
- **Team members** (Worker role) — complete assigned jobs, track personal inventory from company stock
- **Developers** (Dev role) — internal access for development and testing

**⚠️ CRITICAL: All code written for this project MUST be compatible with both iOS and Android platforms. Always use platform-agnostic React Native components and APIs, or use Platform-specific code when necessary.**

---

## 🚨 IDENTITY MODEL — uid & companyId

### ⚠️ NEVER USE `username` OR `getUsernameFromEmail` — ALWAYS USE `uid`

The app uses **Firebase Auth UID** (`auth().currentUser.uid`) as the primary user identifier. The old `username` model (derived from email prefix) has been **completely removed**.

- **`uid`**: Firebase Auth UID — used for ALL Firestore document paths and field references
- **`companyId`**: Company identifier — used for ALL company-related Firestore paths
- **`getUsernameFromEmail()`**: **REMOVED** — this function no longer exists in the codebase

### ⛔ FORBIDDEN — DO NOT USE
```javascript
// ❌ NEVER DO THIS — getUsernameFromEmail was removed
const username = getUsernameFromEmail(email);

// ❌ NEVER reference username-based paths
db.collection(username).doc('profile')

// ❌ NEVER use companyName for Firestore paths
db.collection('companies').doc(companyName)

// ❌ NEVER use these old field names
{ workerUsername: '...', companyName: '...', senderUsername: '...' }
```

### ✅ REQUIRED — ALWAYS DO THIS
```javascript
// ✅ Get uid from Firebase Auth
const uid = auth().currentUser.uid;

// ✅ Use uid for all user document paths
db.collection(uid).doc('profile')

// ✅ Use companyId for company paths
db.collection('companies').doc(companyId)

// ✅ Use these field names
{ workerId: '...', companyId: '...', senderUid: '...' }
```

### Field Name Mapping (Old → New)
| Old Field | New Field |
|-----------|-----------|
| `workerUsername` | `workerId` |
| `senderUsername` | `senderUid` |
| `createdByUsername` | `createdByUid` |
| `completedByUsername` | `completedByUid` |
| `companyName` | `companyId` |
| `username` (in profiles) | `uid` |

---

## 🚨 CUSTOM ALERT SYSTEM - REQUIRED

### ⚠️ NEVER USE Alert.alert() - ALWAYS USE CUSTOM ALERT

The app uses a **custom alert dialog system** instead of the default React Native `Alert.alert()`. This provides:
- ✨ Modern gradient design matching app aesthetic
- 🎨 Automatic dark/light mode support  
- 📱 Identical behavior on iOS & Android
- 🎯 Multiple alert types (success, error, warning, info, confirm)
- 🌊 Smooth animations
- 🎭 Custom icons support

### How to Use Custom Alert

1. **Import the hook:**
```javascript
import { useAlert } from '../contexts/AlertContext';
```

2. **Get alert instance:**
```javascript
const alert = useAlert();
```

3. **Show alerts:**
```javascript
// Simple alerts
alert.success('Success', 'Operation completed!');
alert.error('Error', 'Something went wrong');
alert.warning('Warning', 'Please check your input');
alert.info('Info', 'Here is some information');

// Confirmation dialog
alert.confirm(
  'Delete Item',
  'Are you sure you want to delete this item?',
  [
    {
      text: 'Cancel',
      style: 'cancel',
      onPress: () => {}  // Always dismiss the alert
    },
    {
      text: 'Delete',
      style: 'destructive',
      onPress: () => {
        // Handle delete
        console.log('Item deleted');
      }
    }
  ]
);
```

### Button Styles
- `primary` or `default` - Blue gradient (positive actions)
- `destructive` - Red gradient (dangerous actions like delete)
- `cancel` - Gray button (cancel/dismiss)

### Alert Types
- `info` 🔵 - Blue gradient with info icon
- `success` 🟢 - Green gradient with checkmark icon
- `error` 🔴 - Red gradient with X icon
- `warning` 🟡 - Yellow/orange gradient with warning icon
- `confirm` 🟣 - Purple gradient with question icon

### ⛔ FORBIDDEN - DO NOT USE
```javascript
// ❌ NEVER DO THIS
Alert.alert('Title', 'Message');

// ✅ ALWAYS DO THIS INSTEAD
alert.info('Title', 'Message');
```

---

## 🏗️ Project Architecture

### Technology Stack
- **Framework**: React Native with Expo SDK ~54.0
- **Navigation**: Expo Router v6 (file-based routing)
- **Backend**: Firebase (Firestore, Authentication, Storage, Cloud Functions)
- **State Management**: React Context API
- **Caching**: MMKV (react-native-mmkv) for high-performance local caching with version-based invalidation
- **Alert System**: Custom alert dialogs (CustomAlert component + AlertContext)
- **Language Support**: Multi-language (English, Hebrew, Arabic)
- **Theme**: Light/Dark mode with AsyncStorage persistence
- **Cross-Platform**: iOS & Android compatible
- **Document Generation**: Server-side PDF generation with Firebase Cloud Functions + Cloud Run
- **Subscription Gating**: `withGate` HOC for feature access control

### Key Features
- **Custom Alert System**: Modern gradient-based alerts replacing native Alert.alert()
- **Role-based access control** (Manager, Worker, User, Basic, Dev)
- **Subscription-based feature gating** via `withGate` HOC
- **Module architecture** — screens in `modules/`, thin wrappers in `app/`
- **Real-time job tracking** and monitoring
- **Role-split inventory management** (personal, team, company)
- **Photo capture** and gallery integration
- **Digital signature** collection
- **GPS location** tracking
- **Multi-language support** (EN, HE, AR)
- **Dark/Light theme** switching
- **Offline-first** with MMKV caching
- **Professional document generation** (Tax Invoices, Price Proposals, Refunds, Return Certificates)
- **Global navigation** with centralized header (back button + settings)

---

## 🏛️ Module Architecture & withGate Pattern

### Overview

The app uses a **module-based architecture** where:
1. **`modules/`** contains all business logic and screen implementations, organized by feature
2. **`app/`** contains **thin wrapper files** that import from modules and apply subscription gating via `withGate`
3. **`modules/shared/gating/`** contains the gating infrastructure

### The `withGate` HOC

Every gated screen in `app/` follows this 3-line pattern:

```javascript
import { withGate } from '../modules/shared/gating/withGate';
import Screen from '../modules/team/screens/ManageJobs';
export default withGate(Screen, { module: 'team', roles: ['manager'] });
```

**What `withGate` does:**
1. Checks if user's **role** is in the allowed `roles` array
2. Checks if user's **subscription** includes the required `module`
3. If either check fails, shows `NotAvailableScreen`
4. While loading, shows a spinner

**Options:**
- `module` (string) — Required module name in subscription's `enabledModules`
- `roles` (string[]) — Allowed roles for this screen
- `roleModules` (object) — Role-specific additional module requirements

### Module Directory Structure

```
modules/
├── team/                        # Team management features (manager/worker)
│   ├── index.js                 # Module barrel exports
│   └── screens/
│       ├── ManageJobs.js        # Manager: manage pending jobs, accept/deny
│       ├── CreateJob.js         # Manager: assign jobs to workers
│       ├── WorkersMonitor.js    # Manager: monitor worker inventory & jobs
│       ├── JobMonitor.js        # Manager: real-time company job monitoring
│       ├── WorkersUsers.js      # Manager: create/edit/delete worker accounts
│       └── Workerjob.js         # Worker: view/complete assigned jobs
│
├── solojob/                     # Solo job management (user/manager)
│   ├── index.js
│   └── screens/
│       ├── Userjob.js           # User: job list and creation hub
│       ├── FillJob.js           # User: fill out a new job
│       └── EditJob.js           # User: edit existing job
│
├── documents/                   # Document generation features
│   ├── index.js
│   └── screens/
│       ├── GeneralDocuments.js  # Document hub / type selection
│       ├── CreateDocument.js    # Create new documents (invoice, proposal, etc.)
│       ├── GenerateTaxInvoice.js # Generate tax invoice from completed job
│       ├── DocumentHistory.js   # View document history
│       └── ViewCertification.js # View individual certification/document
│
├── inventory/                   # Inventory management (split by role)
│   ├── personal/               # Solo user inventory (free-form parts)
│   │   ├── index.js
│   │   └── screens/
│   │       └── UserInventory.js
│   ├── teaminventory/          # Worker inventory (picks from company stock)
│   │   ├── index.js
│   │   └── screens/
│   │       └── inventory.js     # WorkerInventory
│   └── company/                # Manager company-wide stock management
│       ├── index.js
│       └── screens/
│           └── CompanyInventory.js
│
└── shared/                     # Shared infrastructure
    └── gating/
        ├── index.js            # isSubscriptionActive, isModuleEnabled, hasRoleAccess
        ├── withGate.js         # HOC for subscription gating
        └── NotAvailableScreen.js # Shown when access is denied
```

### App Wrapper Files

Each gated screen in `app/` is a thin 3-line wrapper:

| App File | Module Screen | Gate Config |
|----------|--------------|-------------|
| `app/ManageJobs.js` | `modules/team/screens/ManageJobs` | `module: 'team', roles: ['manager']` |
| `app/CreateJob.js` | `modules/team/screens/CreateJob` | `module: 'team', roles: ['manager']` |
| `app/WorkersMonitor.js` | `modules/team/screens/WorkersMonitor` | `module: 'team', roles: ['manager']` |
| `app/JobMonitor.js` | `modules/team/screens/JobMonitor` | `module: 'team', roles: ['manager']` |
| `app/WorkersUsers.js` | `modules/team/screens/WorkersUsers` | `module: 'team', roles: ['manager']` |
| `app/Workerjob.js` | `modules/team/screens/Workerjob` | `module: 'team', roles: ['worker']` |
| `app/Userjob.js` | `modules/solojob/screens/Userjob` | `module: 'jobs', roles: ['user', 'manager']` |
| `app/FillJob.js` | `modules/solojob/screens/FillJob` | `module: 'jobs', roles: ['user', 'manager']` |
| `app/EditJob.js` | `modules/solojob/screens/EditJob` | `module: 'jobs', roles: ['user', 'manager']` |
| `app/GeneralDocuments.js` | `modules/documents/screens/GeneralDocuments` | `module: 'documents', roles: ['user', 'basic', 'manager']` |
| `app/CreateDocument.js` | `modules/documents/screens/CreateDocument` | `module: 'documents', roles: ['user', 'basic', 'manager']` |
| `app/GenerateTaxInvoice.js` | `modules/documents/screens/GenerateTaxInvoice` | `module: 'documents', roles: ['user', 'basic', 'manager']` |
| `app/DocumentHistory.js` | `modules/documents/screens/DocumentHistory` | `module: 'documents', roles: ['user', 'basic', 'manager']` |
| `app/ViewCertification.js` | `modules/documents/screens/ViewCertification` | `module: 'documents', roles: ['user', 'basic', 'manager']` |
| `app/CompanyInventory.js` | `modules/inventory/company/screens/CompanyInventory` | `module: 'inventory', roles: ['manager', 'user']` |

### Special: `app/inventory.js` (Role-Aware Router)

`app/inventory.js` is **not** a simple 3-line wrapper. It's a role-aware router wrapped with `withGate`:

```javascript
import WorkerInventory from '../modules/inventory/teaminventory/screens/inventory';
import UserInventory from '../modules/inventory/personal/screens/UserInventory';

function InventoryRouter() {
  const { profile } = useCache();
  const role = profile?.role;
  // worker / manager → WorkerInventory (company-linked parts)
  // user / basic     → UserInventory   (personal free-form parts)
  if (role === 'worker' || role === 'manager') return <WorkerInventory />;
  return <UserInventory />;
}

export default withGate(InventoryRouter, {
  module: 'inventory',
  roles: ['manager', 'worker', 'user', 'basic'],
  roleModules: { worker: ['teaminventory', 'inventory'] }
});
```

### Non-Gated App Screens

These screens in `app/` are **NOT wrapped with `withGate`** (they are full implementations or special screens):

- `app/_layout.js` — Root layout with providers
- `app/index.js` — Auth gate / entry point
- `app/Login.js` — Authentication screen
- `app/ManagerHomepage.js` — Manager dashboard
- `app/WorkerHomepage.js` — Worker dashboard
- `app/UserHomepage.js` — User dashboard
- `app/BasicHomepage.js` — Basic user dashboard
- `app/Settings.js` — Settings screen
- `app/BusinessReg.js` — Business registration
- `app/ClientBook.js` — Client address book
- `app/Permission.js` — Permission management
- `app/DevInbox.js` — Developer inbox
- `app/SupportChat.js` — Support chat

---

## 📁 File Structure & Detailed Explanations

**Cross-Platform Note**: All dependencies are Expo-compatible and work on both iOS and Android.

---

#### `app.json`
**Purpose**: Expo configuration for app metadata, permissions, and platform-specific settings.
- **Cross-Platform Configuration**:
  - `orientation`: "portrait" (locked for both iOS and Android)
  - `ios.supportsTablet`: true (iPad support)
  - `android.permissions`: Camera, Storage, Location
  - `ios.infoPlist`: Camera, Photo Library, Location permissions
- **Splash Screen**: Custom splash with `#1e3a8a` background (both platforms)
- **Bundle Identifiers**: 
  - iOS: `com.coolinginventory.app`
  - Android: `com.coolinginventory.app`

**Platform-Specific Permissions**:
- **iOS**: Camera, Photo Library, Location (always and when in use)
- **Android**: CAMERA, READ_EXTERNAL_STORAGE, WRITE_EXTERNAL_STORAGE, ACCESS_FINE_LOCATION

---

#### `firebase.js`
**Purpose**: React Native Firebase initialization for backend services (works identically on iOS and Android).
- **Uses**: `@react-native-firebase/*` modules (v23.8.5) - NOT the Firebase Web SDK
- **Exports**:
  - `app`: Firebase app instance
  - `db`: Firestore database instance (chainable API)
  - `storage`: Firebase Storage for images/files
  - `auth`: Firebase Authentication with native persistence
  - `functions`: Cloud Functions instance (us-central1)
  - `middleEastFunctions`: Cloud Functions instance (me-west1)
  - `Timestamp`: Firestore Timestamp class
  - `FieldValue`: Firestore FieldValue (serverTimestamp, increment, delete, etc.)
  - `GeoPoint`: Firestore GeoPoint class
- **Key Feature**: Uses native Firebase SDKs with configuration from `GoogleService-Info.plist` (iOS) and `google-services.json` (Android)
- **API Pattern**: Uses chainable API (NOT Web SDK modular imports)
  - `db.collection('col').doc('id').get()` instead of `getDoc(doc(db, 'col', 'id'))`
  - `storage.ref('path').put(blob)` instead of `uploadBytesResumable(ref(storage, 'path'), blob)`
  - `functions.httpsCallable('name')` instead of `httpsCallable(functions, 'name')`

---

#### `theme.js`
**Purpose**: Centralized design system with light/dark mode support (identical rendering on iOS and Android).
- **Exports**:
  - `lightColors`: Light mode color palette
  - `darkColors`: Dark mode color palette
  - `getColors(isDarkMode)`: Returns appropriate color scheme
  - `gradients`: Predefined gradient combinations
  - `spacing`: Consistent spacing values (xs, sm, md, lg, xl, xxl)
  - `borderRadius`: Border radius values
  - `typography`: Font sizes and weights
  - `shadows`: Platform-adaptive shadow styles (iOS uses shadowColor/shadowOffset, Android uses elevation)
- **Colors**: Professional navy blue primary (#0F2A4D), teal secondary (#00ACC1)
- **Status Colors**: Success, error, warning, info, low-stock indicators

**Cross-Platform Note**: Shadows use Platform.select to apply iOS-specific shadow properties and Android elevation.

---

### 🔷 App Directory (Routes & Wrappers)

Files in `app/` fall into two categories:
1. **Full screens** — homepages, login, settings, etc.
2. **Thin wrappers** — 3-line files using `withGate` to gate module screens

---

#### `app/_layout.js`
**Purpose**: Root layout wrapper that provides global context providers and navigation structure.
- **Providers Stack** (outer to inner):
  1. `ErrorBoundary`: Catches and displays JavaScript errors
  2. `SafeAreaProvider`: Handles notch/status bar on iOS and Android
  3. `ThemeProvider`: Global dark/light mode state
  4. `LanguageProvider`: Global language state (EN, HE, AR)
  5. `CacheProvider`: MMKV caching + subscription state
  6. `AlertProvider`: Custom alert system
  7. `Stack`: Expo Router navigation stack
- **Registered Screens**: All app screens with `headerShown: false`
- **Navigation Flow**: Handles role-based routing (Manager/Worker/User/Basic)

**Cross-Platform Note**: SafeAreaProvider automatically handles iPhone notches and Android system bars.

---

#### `app/index.js`
**Purpose**: App entry point and authentication gate (works identically on iOS and Android).
- **Functionality**:
  - Listens to Firebase auth state changes
  - Shows loading spinner during initialization
  - Routes authenticated users based on role:
    - `manager` → ManagerHomepage
    - `worker` → WorkerHomepage
    - `user` → UserHomepage
    - `basic` → BasicHomepage
  - Shows Login screen for unauthenticated users
- **User Role Detection**: Fetches user profile from Firestore using `uid` (Firebase Auth UID)
- **Cache Initialization**: Calls `initializeCache(uid)` after login
- **Error Handling**: Defaults to UserHomepage if profile fetch fails

---

#### `app/Login.js`
**Purpose**: Authentication screen with email/password login (iOS and Android compatible).
- **Features**:
  - Email and password input fields
  - Language toggle (EN/HE/AR) in header
  - Theme toggle (light/dark) in header
  - Error handling with custom alerts
  - Auto-navigation after successful login
- **Authentication Flow**:
  1. Validates input fields
  2. Signs in with Firebase Authentication
  3. Gets `uid` from `auth().currentUser.uid`
  4. Fetches user profile from `{uid}/profile`
  5. Initializes cache via `initializeCache(uid)`
  6. Routes to appropriate homepage based on role

---

#### `app/ManagerHomepage.js`
**Purpose**: Manager dashboard with tabs — Management, Work, Job Monitor, and Documents (iOS and Android).
- **Features**:
  - **Management Tab**: Workers Monitor, Manage Workers, Company Inventory
  - **Work Tab**: My Inventory, My Jobs
  - **Job Monitor Tab**: Company-wide job tracking
  - **Documents Tab**: General Documents, Document History
  - Logout button with confirmation
  - GlobalHeader component (back button + settings)

---

#### `app/WorkerHomepage.js`
**Purpose**: Worker dashboard with job and inventory access (iOS and Android).
- **Features**: My Jobs, My Inventory, Logout
- **Role**: Workers can only view assigned jobs, not create them

---

#### `app/UserHomepage.js`
**Purpose**: Standard user dashboard for creating and managing own jobs (iOS and Android).
- **Features**: Create & Fill Job, My Inventory, Documents, Logout
- **Role**: Users create their own jobs (not assigned by managers)

---

#### `app/BasicHomepage.js`
**Purpose**: Basic user dashboard with limited features (iOS and Android).
- **Role**: Basic users have limited access based on subscription

---

#### Thin Wrapper Files in `app/`

All other gated screen files (ManageJobs.js, CreateJob.js, Workerjob.js, Userjob.js, FillJob.js, EditJob.js, etc.) are **3-line wrappers** as documented in the Module Architecture section above.

---

### 🔷 Module Screens — Key Details

#### `modules/solojob/screens/Userjob.js`
**Purpose**: Job list and creation hub for solo users.
- **Firestore Path**: `{uid}/jobs/all/{jobId}`
- **Features**: Job list view, create new job (navigates to FillJob), edit/delete jobs

#### `modules/solojob/screens/FillJob.js`
**Purpose**: Full job form for creating a new job.
- **Features**:
  - Job title and description
  - Time worked (from/to) with custom time picker
  - Customer name via ClientSelector
  - Location (manual entry or GPS)
  - Photo capture (camera or gallery, max 5 photos)
  - Client signature pad
  - Parts used (select from inventory with quantity)
  - Draft system (auto-saves to AsyncStorage)
- **Storage**:
  - Firebase Storage: Photos and signatures
  - Firebase Firestore: Job data in `{uid}/jobs/all/{jobId}`
  - AsyncStorage: Draft data persistence

#### `modules/solojob/screens/EditJob.js`
**Purpose**: Edit an existing job.
- **Firestore Path**: `{uid}/jobs/all/{jobId}`

#### `modules/team/screens/Workerjob.js`
**Purpose**: Worker screen to view and complete assigned jobs.
- **Firestore Path**: `companies/{companyId}/PendingJobs/{jobId}`
- **Features**:
  - Job list with status filters (pending, received, waiting, accepted, denied)
  - Fill job details (time, location, photos, signature, parts)
  - Mark as received, submit for approval
  - Quick actions: Waze navigation, phone dialer, WhatsApp
- **Field References**: Uses `workerId` (not `workerUsername`)

**WhatsApp Integration (Israeli Phone Validation)**:
```javascript
// Valid formats: 05XXXXXXXX, +97205XXXXXXXX, 97205XXXXXXXX
// Israeli mobile prefixes: 050, 052, 053, 054, 055, 058
const israeliMobileRegex = /^(?:\+?972|0)(5[0-9])([0-9]{7})$/;
// Opens: https://wa.me/972XXXXXXXXX
```

#### `modules/team/screens/ManageJobs.js`
**Purpose**: Manager screen for accepting/denying submitted jobs.
- **Firestore Paths**:
  - Reads: `companies/{companyId}/PendingJobs`
  - Writes: `companies/{companyId}/finishedJobs` (on accept)
  - Updates worker inventory: `{workerId}/inventory/parts` (on accept)

#### `modules/team/screens/CreateJob.js`
**Purpose**: Manager tool to assign jobs to workers.
- **Firestore Path**: `companies/{companyId}/PendingJobs/{jobId}`
- **Job includes**: `assignedTo` (workerId), `assignedBy` (manager uid), `status: 'pending'`

#### `modules/team/screens/JobMonitor.js`
**Purpose**: Real-time monitoring of all company jobs.
- **Firestore Path**: `companies/{companyId}/PendingJobs` + `companies/{companyId}/finishedJobs`
- **Features**: Status filters, date filters, approve/deny, photo gallery, signature display

#### `modules/team/screens/WorkersMonitor.js`
**Purpose**: Monitor worker inventory and jobs.
- **Firestore Paths**:
  - Worker list: `companies/{companyId}/workers/{workerId}`
  - Worker inventory: `{workerId}/inventory/parts`
  - Worker jobs: filtered from `companies/{companyId}/PendingJobs`

#### `modules/team/screens/WorkersUsers.js`
**Purpose**: Create, edit, delete worker accounts.
- **Firestore Paths**:
  - `companies/{companyId}/workers/{workerId}`: Worker data
  - `{workerId}/profile`: Worker profile with `role: 'worker'`, `companyId`
- **Worker Profile**:
  ```javascript
  {
    email: string,
    phoneNumber: string,
    name: string,
    role: 'worker',
    companyId: string
  }
  ```

#### `modules/documents/screens/GeneralDocuments.js`
**Purpose**: Document hub for selecting document types.
- **Document Types**: Tax Invoice, Price Proposal, Refund, Return Certificate

#### `modules/documents/screens/CreateDocument.js`
**Purpose**: Create new documents (all types except tax invoice from job).
- **Features**: Customer details, line items, calculations, PDF generation via Cloud Function

#### `modules/documents/screens/GenerateTaxInvoice.js`
**Purpose**: Generate tax invoices from completed jobs.
- **Firestore Queries**:
  - Solo: `{uid}/jobs/all` where status = 'finished'
  - Manager: `companies/{companyId}/finishedJobs`

#### `modules/documents/screens/DocumentHistory.js`
**Purpose**: View history of generated documents/certifications.

#### `modules/documents/screens/ViewCertification.js`
**Purpose**: View individual certification/document details.

---

### 🔷 Inventory System (Split by Role)

#### `modules/inventory/personal/screens/UserInventory.js`
**Purpose**: Inventory for solo users (User/Basic roles).
- **Features**: Free-form add/edit/delete parts, no company link
- **Firestore Path**: `{uid}/inventory/parts`
- **Data**: `{ partName: { quantity, lowThreshold } }`

#### `modules/inventory/teaminventory/screens/inventory.js` (WorkerInventory)
**Purpose**: Inventory for workers — picks parts from company inventory.
- **Features**: Select parts from company stock, track personal quantities
- **Firestore Paths**:
  - Personal: `{uid}/inventory/parts`
  - Company stock: `companies/{companyId}/business_data/inventory`

#### `modules/inventory/company/screens/CompanyInventory.js`
**Purpose**: Manager screen for company-wide stock management.
- **Features**: Add/edit/delete company parts, set thresholds, low-stock alerts
- **Firestore Path**: `companies/{companyId}/business_data/inventory`

#### `app/inventory.js` (Role Router)
**Purpose**: Routes to the correct inventory screen based on user role.
- `worker` / `manager` → WorkerInventory
- `user` / `basic` → UserInventory

---

### 🔷 Components Directory

All components are **reusable, cross-platform UI elements** that work identically on iOS and Android.

---

#### `components/CustomAlert.js`
**Purpose**: Beautiful custom alert modal replacing React Native's Alert.alert()
- **Usage**: Should NOT be used directly — use `useAlert()` hook instead
- **Features**: 5 alert types, gradient headers, smooth animations, dark mode support

#### `components/Button.js`
**Purpose**: Reusable button components (PrimaryButton, SecondaryButton, DangerButton, TextButton).

#### `components/Card.js`
**Purpose**: Reusable card containers (Card, CardHeader, CardContent, CardFooter).

#### `components/Input.js`
**Purpose**: Text input components with validation (Input, SearchInput).

#### `components/Loading.js`
**Purpose**: Loading indicators (LoadingSpinner, FullScreenLoader, SkeletonLoader).

#### `components/LoadingOverlay.js`
**Purpose**: Full-screen loading overlay for blocking operations.

#### `components/PhotoPicker.js`
**Purpose**: Photo selection with camera and gallery support (max 5 photos, 0.8 quality compression).

#### `components/SignaturePad.js`
**Purpose**: Digital signature capture via WebView canvas.

#### `components/TimePicker.js`
**Purpose**: Custom scrollable time picker (HH:MM format).

#### `components/ViewJobDetails.js`
**Purpose**: Modal to display full job details (info, photos, signature, parts).

#### `components/GlobalHeader.js`
**Purpose**: Global navigation header with back button, theme, and language controls.
- **Back Button**: Automatically appears on all pages except homepages
- **Settings Button**: Opens modal with theme and language options
- **IMPORTANT**: GlobalHeader should be included on every screen

#### `components/ClientSelector.js` / `components/ClientSelectorModal.js`
**Purpose**: Client selection components for job forms and documents.
- **Data Source**: `cachedClients` from CacheContext

#### `components/InventoryItemSearch.js`
**Purpose**: Searchable inventory item picker for job parts selection.

#### `components/PartsSelector.js`
**Purpose**: Parts selection modal for choosing inventory items with quantities.

#### `components/DateFilter.js`
**Purpose**: Date filtering component for job/document lists.

#### `components/ScrollableContainer.js`
**Purpose**: Reusable scrollable container with keyboard avoidance.

#### `components/ErrorBoundary.js`
**Purpose**: Catches JavaScript errors and displays fallback UI.

#### `components/index.js`
**Purpose**: Barrel export file for easy component imports.

---

### 🔷 Contexts Directory

Global state management using React Context API (works identically on iOS and Android).

---

#### `contexts/LanguageContext.js`
**Purpose**: Global language state management (EN, HE, AR).
- **Exports**: `LanguageProvider`, `useLanguageContext`
- **Methods**: `language`, `setLanguage(code)`, `toggleLanguage()`
- **Persistence**: AsyncStorage with key `app_language`

#### `contexts/ThemeContext.js`
**Purpose**: Global theme state management (light/dark mode).
- **Exports**: `ThemeProvider`, `useThemeContext`
- **Methods**: `isDarkMode`, `setTheme(isDark)`, `toggleTheme()`
- **Persistence**: AsyncStorage with key `app_theme`

#### `contexts/AlertContext.js`
**Purpose**: Global alert state management for custom alert dialogs.
- **Exports**: `AlertProvider`, `useAlert`
- **Methods**: `showAlert()`, `hideAlert()`, `success()`, `error()`, `warning()`, `info()`, `confirm()`

#### `contexts/HeaderContext.js`
**Purpose**: Global header state management for dynamic header content.

#### `contexts/CacheContext.js` (~2500 lines) **CRITICAL**
**Purpose**: High-performance MMKV-based caching system to minimize Firebase reads and enable offline-first functionality.

⚠️ **CRITICAL: This is the primary data caching system. NEVER use AsyncStorage for user profile data. Always use the `useCache()` hook.**

- **Features**:
  1. **MMKV Storage**: Uses `react-native-mmkv` for ultra-fast synchronous key-value storage (10x faster than AsyncStorage)
  2. **Role-Based Cache Structure**: Separate cache structures for Manager, Worker, User, and Basic roles
  3. **Version-Based Invalidation**: Real-time Firebase listeners track version changes to trigger cache refresh
  4. **90-Day Expiry**: Automatically cleans up old `finishedJobs` and `certifications`
  5. **Offline-First**: Immediate UI updates from cache while Firebase syncs in background
  6. **Cross-Device Sync**: Version increments in Firestore trigger all devices to refresh
  7. **Subscription State**: Tracks user subscription for feature gating

- **Exports**: `CacheProvider`, `useCache`

- **MMKV Cache Keys**:
  - `cache_uid` (was `cache_username`)
  - `cache_company_id` (was `cache_company_name`)
  - `cache_profile`, `cache_inventory`, `cache_pending_jobs`, etc.

- **Cache Structure by Role**:

  **Manager Cache** (Firestore: `{uid}/cache` + `companies/{companyId}/business_data/cache`):
  ```javascript
  {
    profile: { role, email, companyId, name, phoneNumber },
    inventory: { partName: { quantity, lowThreshold } },
    workersList: [{ email, name, phoneNumber }],
    pendingJobs: [{ id, title, status, assignedTo, ... }],
    finishedJobs: [{ id, title, finishedAt, ... }],
    certifications: [{ id, type, createdAt, ... }],
    businessInfo: { businessName, businessNumber, ... },
    clients: [{ id, name, phone, email, address, city, vatNumber }]
  }
  ```

  **Worker Cache** (Firestore: `{uid}/cache`):
  ```javascript
  {
    profile: { role, email, companyId, name, phoneNumber },
    inventory: { partName: { quantity, lowThreshold } },
    pendingJobs: [{ id, title, status, ... }],
    finishedJobs: [{ id, title, finishedAt, ... }],
    clients: [{ id, name, phone, email, address, city, vatNumber }]
  }
  ```

  **User/Basic Cache** (Firestore: `{uid}/cache`):
  ```javascript
  {
    profile: { role, email, companyId, name, phoneNumber },
    inventory: { partName: { quantity, lowThreshold } },
    finishedJobs: [{ id, title, finishedAt, ... }],
    certifications: [{ id, type, createdAt, ... }],
    businessInfo: { businessName, businessNumber, ... },
    clients: [{ id, name, phone, email, address, city, vatNumber }]
  }
  ```

- **Primary Methods**:
  - `initializeCache(uid)`: Initialize cache for logged-in user (takes single `uid` param)
  - `clearCache()`: Clear all cached data (call on logout)
  - `getUid()`: Get cached user UID **(PRIMARY)**
  - `getCompanyId()`: Get cached company ID **(PRIMARY)**
  - `getUsername()`: **Deprecated alias** → same as `getUid()`
  - `getCompanyName()`: **Deprecated alias** → same as `getCompanyId()`
  - `profile`: Current user profile object (alias: `cachedProfile`)
  - `subscription`: Current subscription state (used by `withGate`)
  - `cachedInventory`, `cachedWorkersList`, `cachedPendingJobs`, `cachedFinishedJobs`
  - `cachedCertifications`, `cachedBusinessInfo`, `cachedClients`
  - `updateInventory()`, `updateWorkersList()`, `addJob()`, `updateJob()`
  - `moveJobToFinished()`, `incrementCacheVersion(field)`
  - `fetchClients()`, `addClient()`, `updateClient()`, `deleteClient()`
  - `fetchOlderJobs()`, `cleanupExpiredCache()`

- **Version-Based Invalidation**:
  Each cache field has a version in Firestore (e.g., `inventory: 3`):
  
  **Client cache versioning is role-based:**
  - Manager → increments `clients` in company cache (`isCompanyCache = true`)
  - Worker/User/Basic → increments `clients` in user cache (`isCompanyCache = false`)
  
  ```javascript
  // When data changes, increment version
  await incrementCacheVersion('inventory');
  await incrementCacheVersion('pendingJobs');
  ```

- **Usage Example**:
  ```javascript
  import { useCache } from '../contexts/CacheContext';

  function MyComponent() {
    const {
      getCompanyId,    // PRIMARY — use this
      getUid,          // PRIMARY — use this
      profile,
      cachedProfile,
      cachedBusinessInfo,
      cachedInventory,
      cachedPendingJobs,
      cachedClients,
      updateInventory,
      addClient,
      incrementCacheVersion,
      moveJobToFinished
    } = useCache();

    const companyId = getCompanyId();
    const uid = getUid();

    const handleAcceptJob = async (job) => {
      await moveJobToFinished(job);
      await incrementCacheVersion('pendingJobs');
    };
  }
  ```

- **Integration with Firestore**:
  The CacheContext sets up `onSnapshot` listeners on version documents:
  - User cache versions: `{uid}/cache`
  - Company cache versions: `companies/{companyId}/business_data/cache`

- **3-Tier Data Access**:
  | Age | Storage Tier | Access Method |
  |-----|-------------|---------------|
  | 0-90 days | MMKV cache | `cachedFinishedJobs`, `cachedCertifications` |
  | 90-180 days | Firestore | `getDataForMonth()` queries Firestore |
  | 180+ days | Cloud Storage | `getDataForMonth()` falls back to `fetchFromArchive()` |

- **Archive Fallback**:
  ```javascript
  const data = await getDataForMonth(new Date(2025, 6, 1), 'finishedJobs');
  const archived = await fetchFromArchive(companyId, 2025, 7, 'finishedJobs');
  ```

**Cross-Platform Note**: MMKV uses native iOS Keychain and Android SharedPreferences for secure, fast storage.

### ⚠️ CACHE SYSTEM RULES

1. **NEVER use AsyncStorage for user profile data** — Always use `useCache()` hook
2. **ALWAYS call `incrementCacheVersion(field)` after modifying data** — This triggers other devices to refresh
3. **ALWAYS use `getCompanyId()` instead of reading from AsyncStorage profile**
4. **ALWAYS use `getUid()` to get the current user identifier**
5. **Draft data can still use AsyncStorage** — Only profile/inventory/jobs data must use cache

### Example: Correct Cache Usage

**❌ OLD WAY (DO NOT USE)**:
```javascript
// WRONG — getUsernameFromEmail was removed, companyName is deprecated
const username = getUsernameFromEmail(email);
const companyName = profile.companyName;
```

**✅ NEW WAY (REQUIRED)**:
```javascript
import { useCache } from '../contexts/CacheContext';

const { getUid, getCompanyId } = useCache();
const uid = getUid();           // Synchronous from MMKV
const companyId = getCompanyId(); // Synchronous from MMKV
```

---

### 🔷 Hooks Directory

Custom React hooks for reusable logic (iOS and Android).

---

#### `hooks/index.js`
**Purpose**: Collection of custom hooks to reduce boilerplate.
- **Exports**:
  1. **useAuth()**: Authentication state and user info
     - Returns: `{ user, loading, error, uid, username: uid, userRole }`
     - `uid` is the PRIMARY identifier (Firebase Auth UID)
     - `username` is a **backward-compatible alias** for `uid`
     - Listens to Firebase auth state
     - Fetches user profile from `{uid}/profile`
  2. **useLanguage(translations)**: Language state with translations
     - Returns: `{ language, setLanguage, t }`
  3. **useFirestoreDoc(...pathSegments)**: Real-time Firestore document
     - Returns: `{ data, loading, error, refresh }`
  4. **useFirestoreCollection(...)**: Real-time Firestore collection
     - Returns: `{ data, loading, error, refresh }`
  5. **useDebouncedValue(value, delay)**: Debounced value for search
  6. **useUserProfile(uid)**: Fetch user profile by UID
     - Param: `uid` (NOT username)
  7. **useCompanyData(companyId)**: Fetch company data
     - Param: `companyId` (NOT companyName)

#### `hooks/useDocumentTask.js` **CRITICAL FOR DOCUMENT GENERATION**
**Purpose**: Custom hook for publishing document generation tasks to Cloud Functions via Pub/Sub.

⚠️ **CRITICAL: This hook sends `cachedBusinessInfo`, `cachedProfile`, `uid`, and `companyId` to Cloud Functions.**

- **Usage**:
  ```javascript
  import { useDocumentTask } from '../hooks/useDocumentTask';

  function DocumentScreen() {
    const { publishPreview, publishGenerate, isPublishing, error } = useDocumentTask();
    
    const handlePreview = async () => {
      const result = await publishPreview({
        type: 305,  // NUMERIC! DOC_TYPE.TAX_INVOICE
        client: { name, email, phone, address, clientVatNumber },
        items: [{ description, quantity, price }],
        language: 'he'
      });
    };
    
    const handleGenerate = async () => {
      const result = await publishGenerate({
        type: 305,
        client: { name, email, phone, address, clientVatNumber },
        items: [{ description, quantity, price }],
        documentName: 'Invoice #123',
        language: 'he'
      });
    };
  }
  ```

- **What it sends to Cloud Functions**:
  ```javascript
  {
    ...documentParams,
    businessInfo: cachedBusinessInfo,
    userProfile: cachedProfile,
    uid: getUid(),
    companyId: getCompanyId()
  }
  ```

#### `hooks/useAppStateListener.js`
**Purpose**: Listens to app state changes (foreground/background) for cache sync.

---

### 🔷 Utils Directory

Utility helper functions (platform-agnostic).

---

#### `utils/helpers.js`
**Purpose**: Common utility functions to reduce code duplication.
- **Exports**:
  1. **generateBase62Id()**: Generate a base-62 random ID
  2. **generateJobId()**: Generate a job ID with prefix
  3. **generatePendingJobId()**: Generate pending job ID
  4. **generateFinishedJobId()**: Generate finished job ID
  5. **generateCertificationId()**: Generate certification ID
  6. **getDocTypeFromId(docId)**: Extract document type from ID
  7. **convertToFinishedJobId(pendingJobId)**: Convert pending → finished job ID
  8. **formatDate(date, locale)**: Format date to locale string
  9. **formatDateTime(date, locale)**: Format date and time
  10. **isValidEmail(email)**: Validate email format with regex
  11. **truncateText(text, maxLength)**: Truncate long text with ellipsis
  12. **calculateTimeDifference(timeFrom, timeTo)**: Calculate minutes between times
  13. **formatDuration(minutes)**: Format minutes to "Xh Ym" string
  14. **debounce(func, wait)**: Debounce function calls
  15. **deepClone(obj)**: Deep clone an object

⚠️ **`getUsernameFromEmail()` has been REMOVED** — it no longer exists. Always use `auth().currentUser.uid`.

#### `utils/notifications.js`
**Purpose**: Push notification utilities for sending/handling notifications.

---

## 🗂️ Firestore Database Structure

The app uses Firebase Firestore with the following structure. **All paths use `uid` (Firebase Auth UID) and `companyId`**.

```
Firestore Root
│
├── {uid} (document per user — keyed by Firebase Auth UID)
│   ├── profile (document)
│   │   └── { role, email, companyId, phoneNumber, name }
│   │
│   ├── inventory (document)
│   │   └── { parts: { partName: { quantity, lowThreshold } } }
│   │
│   ├── cache (document - version tracking)
│   │   └── { profile: 1, inventory: 5, clients: 2, ... }
│   │
│   └── jobs (collection)
│       └── all (collection)
│           └── {jobId} (document)
│               └── { title, description, location, photos[], signature, ... }
│
└── companies (collection)
    └── {companyId} (document — keyed by company identifier)
        │   └── { nextClientId: number }
        │
        ├── workers (collection)
        │   └── {workerId} (document — workerId = worker's uid)
        │       └── { email, phoneNumber, name, role }
        │
        ├── clients (collection)
        │   └── {clientId} (document - numeric string ID)
        │       └── { name, phone, email, address, city, vatNumber, createdAt }
        │
        ├── PendingJobs (collection)
        │   └── {jobId} (document)
        │       └── { title, status, assignedTo (workerId), completedByUid, ... }
        │
        ├── finishedJobs (collection)
        │   └── {jobId} (document)
        │       └── { ...completed job data, finishedAt }
        │
        ├── certifications (collection)
        │   └── {certId} (document)
        │       └── { type, documentNumber, clientName, items[], downloadURL, createdByUid, ... }
        │
        └── business_data (collection)
            ├── business_info (document)
            │   └── { businessName, businessNumber, address, phone, email, ... }
            ├── inventory (document - company-wide parts list)
            │   └── { parts: { partName: { quantity, lowThreshold } } }
            └── cache (document - version tracking for company data)
                └── { workers: 2, business_info: 1, clients: 3, ... }
```

### Key Field Names

| Field | Description | Notes |
|-------|-------------|-------|
| `companyId` | Company identifier | Was `companyName` |
| `workerId` | Worker's Firebase Auth UID | Was `workerUsername` |
| `assignedTo` | Worker UID job is assigned to | Uses `workerId` |
| `createdByUid` | UID of user who created the record | Was `createdByUsername` |
| `completedByUid` | UID of user who completed the job | Was `completedByUsername` |
| `senderUid` | UID of message sender | Was `senderUsername` |

**Cross-Platform Note**: Firestore SDK handles data synchronization identically on iOS and Android.

---

## 📄 Document Generation System

The app uses a **custom Puppeteer-based document generation system** via Cloud Run for creating professional PDFs, with automatic email delivery to clients.

### Architecture Overview

```
┌─────────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Mobile App        │────▶│  Cloud Functions │────▶│   Cloud Run     │
│  (CreateDocument)   │     │  (Pub/Sub tasks) │     │  (PDF Service)  │
└─────────────────────┘     └──────────────────┘     └─────────────────┘
                                                              │
                                    ┌─────────────────────────┼─────────────────────────┐
                                    ▼                         ▼                         ▼
                            ┌──────────────┐          ┌──────────────┐          ┌──────────────┐
                            │   Firebase   │          │    Email     │          │   Firebase   │
                            │   Storage    │          │   Delivery   │          │   Firestore  │
                            │   (PDF)      │          │ (SendGrid/SES)│          │  (metadata)  │
                            └──────────────┘          └──────────────┘          └──────────────┘
```

### Cloud Run PDF Service (`cloudrun-pdf/`)

```
cloudrun-pdf/
├── index.js           # Express server with /preview and /generate endpoints
├── htmlTemplate.js    # HTML template generator for PDF documents
├── emailService.js    # Email delivery (SendGrid + Amazon SES)
├── EMAIL_SETUP.md     # Email configuration documentation
├── package.json       # Dependencies
└── Dockerfile         # Container configuration
```

#### Role-Based Cache Paths

**⚠️ CRITICAL**: When generating documents, cache versions must be updated based on user role:
- **Manager**: `companies/{companyId}/business_data/cache`
- **User/Basic**: `{uid}/cache`

The `userProfile` is passed from the mobile app through Cloud Functions to Cloud Run, which uses `userProfile.role` to determine the correct cache path.

#### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/preview` | POST | Generate preview PDF (Pub/Sub push) |
| `/generate` | POST | Generate final PDF + send email (Pub/Sub push) |
| `/health` | GET | Health check |

### Email Delivery System

When a document is generated, if the client has an email address, the system automatically sends an email with the download link.

| Provider | Environment Variable | Best For |
|----------|---------------------|----------|
| **SendGrid** (default) | `EMAIL_PROVIDER=sendgrid` | Most use cases |
| **Amazon SES** | `EMAIL_PROVIDER=ses` | AWS infrastructure |

See `cloudrun-pdf/EMAIL_SETUP.md` for complete setup instructions.

### Tax Invoice Special Features

- **Confirmation Number (מספר הקצאה)**: Obtained via `getInvoiceApproval` Cloud Function for Israeli Tax Authority compliance
- **Client VAT Number (ע.מ לקוח)**: Stored as `clientVatNumber` in Firestore

### Cloud Functions (functions/index.js)

All Cloud Functions use `uid` and `companyId` (not `username`/`companyName`).

#### Document Type Constants (DOC_TYPE)

**⚠️ CRITICAL: Document types are ALWAYS numeric. Never use string identifiers.**

```javascript
const DOC_TYPE = {
  PRICE_PROPOSAL: 10,      // הצעת מחיר
  DELIVERY_NOTE: 200,      // תעודת משלוח
  RETURN_CERTIFICATE: 210, // תעודת החזרה
  TAX_INVOICE: 305,        // חשבונית מס
  REFUND: 330,             // זיכוי
  RECEIPT: 400             // קבלה
};

const DOC_SUFFIX = {
  [DOC_TYPE.TAX_INVOICE]: 'TI',
  [DOC_TYPE.PRICE_PROPOSAL]: 'PP',
  [DOC_TYPE.REFUND]: 'RD',
  [DOC_TYPE.RETURN_CERTIFICATE]: 'RC',
  [DOC_TYPE.DELIVERY_NOTE]: 'DN',
  [DOC_TYPE.RECEIPT]: 'RT'
};
```

#### Document ID Format

`${YYYYMMDD}${paddedDocNumber}${suffix}` — e.g., `20260130000001TI`

#### Key Functions

1. **`publishPreviewTask`** — Publish preview task to Pub/Sub
2. **`publishGenerateTask`** — Generate final PDF + send email
3. **`getInvoiceApproval`** — Get Israeli Tax Authority confirmation number

All functions receive `uid` and `companyId` (not `username`/`companyName`).

**Input example**:
```javascript
{
  type: 305,  // NUMERIC!
  client: { name, email, phone, address, clientVatNumber },
  items: [{ description, quantity, price }],
  language: 'he',
  companyId: string,  // NOT companyName
  uid: string         // NOT username
}
```

### ⚠️ Document Type Usage Rules

**❌ NEVER DO THIS:**
```javascript
const type = 'taxInvoice';     // WRONG — string types are deprecated
const type = 'priceProposal';  // WRONG
```

**✅ ALWAYS DO THIS:**
```javascript
const type = DOC_TYPE.TAX_INVOICE;  // 305
const type = DOC_TYPE.PRICE_PROPOSAL;  // 10
const isTaxInvoice = type === 305;
```

### Storage & Firestore Structure (Documents)

```
Firebase Storage:
├── companies/{companyId}/{YYYY-MM}/{documentId}/
│   └── {documentId}.pdf
└── previews/{uid}/
    └── preview_{type}_{timestamp}.pdf

Firestore:
├── companies/{companyId}/certifications/c_{documentId}
│   ├── type: 305
│   ├── documentType: 'taxInvoice'  # Legacy display string only
│   ├── documentNumber: '000001'
│   ├── clientName, clientEmail, clientPhone, clientAddress
│   ├── clientVatNumber
│   ├── items[], totals
│   ├── downloadURL, storagePath
│   ├── taxAuthorityConfirmationNumber
│   └── createdByUid, createdAt
└── documentTasks/{taskId}
    ├── status: 'pending' | 'queued' | 'completed' | 'failed'
    ├── documentType: 305
    ├── emailSent, emailMessageId, emailRecipient
    └── downloadURL, pdfSize
```

### HTML Template Features (htmlTemplate.js)

- **Multi-language RTL Support**: Hebrew, Arabic, English
- **Professional Design**: Navy blue (#0F2A4D) and teal (#00ACC1) branding
- **Responsive A4 Layout**: Print-ready with proper margins
- **Automatic Calculations**: Subtotal + VAT (17%) = Grand Total
- **Company & Client Details**: Name, email, phone, address, VAT numbers
- **Tax Authority Confirmation**: Displayed for tax invoices (מספר הקצאה)
- **Client VAT Number**: Displayed for business customers (ע.מ לקוח)
- **Itemized Table**: Description, quantity, price, totals
- **Notes Section**: Optional custom notes
- **Footer**: Smart-Job branding + timestamp

---

## 📦 Data Archiver System (Firestore → Cloud Storage)

### Overview

A **Cloud Run Job** runs monthly to migrate old data from Firestore to Cloud Storage, reducing storage costs.

### Data Tiering

| Age | Storage | Access Method | Cost |
|-----|---------|---------------|------|
| 0-90 days | MMKV local cache | Instant, offline | Free |
| 90-180 days | Firestore | Live queries | $0.18/GB |
| 180+ days | Cloud Storage | JSON archives | $0.020/GB (Standard) |
| 365+ days | Cloud Storage | JSON archives | $0.010/GB (Nearline) |
| 1095+ days | Cloud Storage | JSON archives | $0.0012/GB (Archive) |

### What Gets Archived

- **finishedJobs**: `companies/{companyId}/finishedJobs` → archived by `finishedAt`
- **certifications**: `companies/{companyId}/certifications` → archived by `createdAt`

### Storage Structure

```
gs://{bucket}/companies/{companyId}/archives/
├── manifest.json
├── {YYYY}-{M}-j.json      # finishedJobs for that month
└── {YYYY}-{M}-c.json      # certifications for that month
```

### Cloud Run Job (`cloudrun-archiver/`)

```
cloudrun-archiver/
├── index.js        # Main archiver logic (uses companyId, not companyName)
├── package.json
└── Dockerfile
```

**Safety Guarantees**: Upload-before-delete, idempotent, per-company isolation, batch deletes.

### Mobile App Integration

```javascript
const data = await getDataForMonth(new Date(2025, 6, 1), 'finishedJobs');
const rangeData = await getDataForDateRange(startDate, endDate, 'certifications');
const archived = await fetchFromArchive(companyId, 2025, 7, 'finishedJobs');
```

See `ARCHIVER_SETUP.md` for complete deployment instructions.

---

## 🎨 UI/UX Patterns

### Cross-Platform Design Principles
1. **Platform-Adaptive Components**: Use Platform.select for iOS/Android differences
2. **Native Feedback**: TouchableOpacity for buttons, custom alerts
3. **Safe Areas**: SafeAreaView for notches and system bars
4. **Keyboard Handling**: KeyboardAvoidingView with platform-specific behavior
5. **Consistent Styling**: Use theme.js for all colors and spacing
6. **Responsive Design**: Use Dimensions API for screen size adaptation

### Common Patterns
- **Modal Dialogs**: Full-screen modals with close button
- **Loading States**: LoadingSpinner or ActivityIndicator during async operations
- **Error Handling**: Custom alert system (NEVER Alert.alert())
- **Form Validation**: Red borders and error messages below inputs
- **Confirmation Dialogs**: `alert.confirm()` for destructive actions
- **Image Display**: Optimized Image component with loading states
- **List Rendering**: FlatList for performance (virtualized scrolling)

---

## 🔐 Authentication & Authorization

### Role-Based Access Control
- **Manager**: Full access to all features, create workers, monitor all jobs, company inventory
- **Worker**: View assigned jobs, complete jobs, pick from company inventory
- **User**: Full solo features — create own jobs, manage own inventory, generate documents
- **Basic**: Limited solo features based on subscription
- **Dev**: Internal development access

### Firebase Authentication
- Email/Password authentication
- `uid` = `auth().currentUser.uid` — used as primary identifier everywhere
- Auto-logout on Firebase auth state change

### Subscription Gating
- Screens are gated by `withGate` HOC checking role + subscription + module
- Subscription state stored in CacheContext
- Module access controlled by `enabledModules` in subscription

### Firestore Security Rules
- Use `getUid()` helper (was `getUsername()`)
- All paths use `{uid}` and `{companyId}`
- Users can only read/write their own documents
- Managers can access company data
- Workers can access assigned jobs

**Cross-Platform Note**: Firebase Auth SDK handles platform-specific secure storage automatically.

---

## 📷 Media Handling (iOS and Android)

### Camera Permissions
- **iOS**: NSCameraUsageDescription, NSPhotoLibraryUsageDescription (via app.json)
- **Android**: CAMERA, READ_EXTERNAL_STORAGE (via app.json)

### Photo Capture Flow
1. Request permissions with `expo-image-picker`
2. Launch camera or gallery
3. Compress image (quality: 0.8)
4. Store temporarily in app cache
5. Upload to Firebase Storage
6. Save download URL in Firestore

### Signature Capture Flow
1. Open SignaturePad modal
2. User draws signature on canvas
3. Convert to base64 PNG
4. Save to cache directory with `expo-file-system`
5. Upload to Firebase Storage
6. Save download URL in Firestore

---

## 🌍 Multi-Language Support

### Supported Languages
- **English (EN)**: Default language
- **Hebrew (HE)**: Right-to-left (RTL) support
- **Arabic (AR)**: Right-to-left (RTL) support

### Translation Pattern
Each screen defines a `t` object with translations:
```javascript
const t = language === 'en' ? {
  title: 'Dashboard',
} : language === 'he' ? {
  title: 'לוח בקרה',
} : {
  title: 'لوحة التحكم',
};
```

---

## 🔧 Development Guidelines

### When Writing New Code

1. **NEVER use `username` or `getUsernameFromEmail`**
   - `getUsernameFromEmail` was completely removed from the codebase
   - Always use `uid` from `auth().currentUser.uid` or `getUid()` from CacheContext
   - All Firestore paths use `{uid}/` not `{username}/`

2. **NEVER use `companyName` for Firestore paths**
   - Always use `companyId` from `getCompanyId()` in CacheContext
   - All company paths use `companies/{companyId}/`

3. **Screens go in `modules/`, thin wrappers in `app/`**
   - New screen logic goes in `modules/{feature}/screens/`
   - `app/` files are 3-line wrappers: import withGate, import Screen, export gated screen
   - Only homepages, login, settings, and special screens are full implementations in `app/`

4. **Use `withGate` HOC for subscription gating**
   ```javascript
   import { withGate } from '../modules/shared/gating/withGate';
   import Screen from '../modules/{feature}/screens/{ScreenName}';
   export default withGate(Screen, { module: '{moduleName}', roles: ['{role1}', '{role2}'] });
   ```

5. **Inventory is split by role**
   - `UserInventory` — for `user`/`basic` roles, free-form parts
   - `WorkerInventory` — for `worker` role, picks from company stock
   - `CompanyInventory` — for `manager` role, company-wide stock management

6. **Always Check Platform Compatibility**
   - Use `Platform.OS === 'ios'` or `Platform.OS === 'android'` when needed
   - Prefer cross-platform APIs

7. **Use Theme System**
   - Import colors from `theme.js` using `getColors(isDarkMode)`
   - Never hardcode colors or spacing values

8. **Handle Loading States**
   - Show LoadingSpinner during async operations
   - Disable buttons during loading

9. **Error Handling & User Feedback**
   - **ALWAYS use custom alert system** — Never use Alert.alert()
   - `import { useAlert } from '../contexts/AlertContext';`
   - Use try-catch for all Firebase operations
   - `alert.error('Error', message)`, `alert.success('Success', message)`
   - `alert.confirm(title, message, buttons)` for confirmations

10. **Firestore Operations**
    - Always check if user is authenticated
    - Use `uid` from `auth().currentUser.uid` for user document paths
    - Use `companyId` from `getCompanyId()` for company paths
    - Use field names: `workerId`, `createdByUid`, `completedByUid`
    - Handle errors gracefully (user might be offline)
    - Use real-time listeners (`onSnapshot`) for live data

11. **Navigation**
    - Use `useRouter()` from expo-router
    - `router.push()` for forward, `router.back()` for backward, `router.replace()` for auth
    - **NEVER create individual back buttons** — GlobalHeader handles all navigation
    - Always include `<GlobalHeader />` at the end of your screen JSX

12. **Cache System**
    - Use `useCache()` for all profile/inventory/jobs data
    - Use AsyncStorage only for drafts and preferences (theme, language)
    - Always call `incrementCacheVersion(field)` after data mutations
    - Use `getUid()` and `getCompanyId()` (not the deprecated aliases)

### Platform-Specific Considerations

#### iOS-Specific
- Handle safe area insets for notched devices
- Use higher top padding for status bar (60-70px)
- Shadow properties: shadowColor, shadowOffset, shadowOpacity, shadowRadius

#### Android-Specific
- Use elevation for shadows
- Handle back button with `BackHandler` API
- Consider different screen densities

### Testing Checklist
- ✅ Test on iOS device/simulator
- ✅ Test on Android device/emulator
- ✅ Test light and dark themes
- ✅ Test all three languages (EN, HE, AR)
- ✅ Test offline behavior (Airplane mode)
- ✅ Test with slow network (3G)
- ✅ Test on different screen sizes
- ✅ Test camera permissions (deny/allow)
- ✅ Test gallery permissions (deny/allow)
- ✅ Test location permissions (deny/allow)
- ✅ Test keyboard behavior (inputs covered/visible)
- ✅ Test subscription gating (access denied screens)

---

### Building for Production
```bash
eas build --platform ios
eas build --platform android
eas build --platform all
```

---

## 📦 Key Dependencies (Cross-Platform)

### Core
- `expo`: ~54.0.25 (iOS & Android SDK)
- `react-native`: 0.81.5 (iOS & Android)
- `expo-router`: ~6.0.15 (File-based navigation)

### Firebase (React Native Firebase v23)
- `@react-native-firebase/app`: ^23.8.5
- `@react-native-firebase/auth`: ^23.8.5
- `@react-native-firebase/firestore`: ^23.8.5
- `@react-native-firebase/storage`: ^23.8.5
- `@react-native-firebase/functions`: ^23.8.5
- `@react-native-firebase/messaging`: ^23.8.5

### UI Components
- `expo-linear-gradient`: ~15.0.7
- `@expo/vector-icons`: ^15.0.3
- `react-native-safe-area-context`: ~5.6.0

### Media & Sensors
- `expo-camera`: ~17.0.9
- `expo-image-picker`: ~17.0.8
- `expo-location`: ~19.0.7
- `expo-file-system`: ^19.0.21

### Signature
- `react-native-signature-canvas`: ^4.7.2
- `react-native-webview`: 13.15.0

### Storage
- `@react-native-async-storage/async-storage`: 2.2.0 (drafts/preferences only)
- `react-native-mmkv`: ^4.1.1 (primary cache storage)

### Gestures & Animation
- `react-native-gesture-handler`: ~2.28.0
- `react-native-reanimated`: ~4.1.1

---

## ⚠️ Important Notes

1. **UID-first**: Always use `uid` (Firebase Auth UID) — never derive identifiers from email
2. **companyId-first**: Always use `companyId` — never use `companyName` for Firestore paths
3. **Module architecture**: Screen logic in `modules/`, thin wrappers in `app/`
4. **withGate**: Every gated screen must use the `withGate` HOC
5. **Cross-Platform First**: Always write code that works on both iOS and Android
6. **Firebase Config**: Never commit Firebase config to public repositories
7. **Custom Alerts Only**: Never use `Alert.alert()` — always use `useAlert()` hook
8. **Cache System**: Use `useCache()` for all persistent data, AsyncStorage only for drafts
9. **Permissions**: Always request permissions before accessing camera/location
10. **Error Handling**: Always wrap Firebase calls in try-catch
11. **Loading States**: Always show loading indicators during async operations
12. **Offline Support**: Handle offline scenarios gracefully
13. **Image Optimization**: Compress images before upload (max 800kb)

---

## 🏁 Summary

Smart-Job ERP is a **production-ready, cross-platform business management system** built with React Native and Expo that runs seamlessly on **both iOS and Android devices**. The app provides comprehensive job management, inventory tracking, and professional document generation for **solo business owners and teams**.

**Key Strengths**:
- ✅ Full iOS and Android compatibility
- ✅ Role-based access control (Manager, Worker, User, Basic, Dev)
- ✅ Subscription-based feature gating with `withGate` HOC
- ✅ Module architecture (modules/ for logic, app/ for routing)
- ✅ UID-based identity model (Firebase Auth UID)
- ✅ Real-time data synchronization with Firebase
- ✅ Offline-first architecture with MMKV caching
- ✅ Multi-language support (EN, HE, AR)
- ✅ Dark/Light theme with persistence
- ✅ Role-split inventory (personal, team, company)
- ✅ Professional document generation (Tax Invoices, Price Proposals, Refunds, Return Certificates)
- ✅ Server-side PDF generation via Cloud Run
- ✅ Centralized navigation with GlobalHeader
- ✅ Custom alert system (never native Alert.alert())
- ✅ 3-tier data access (MMKV → Firestore → Cloud Storage archives)

**Architecture Highlights**:
- **Module Architecture**: Business logic in `modules/`, thin wrappers in `app/` with `withGate`
- **UID Identity Model**: All user references use Firebase Auth UID, not email-derived usernames
- **CompanyId References**: All company paths use `companyId`, not `companyName`
- **Inventory Split**: Personal (solo users), Team (workers from company stock), Company (manager stock)
- **GlobalHeader Component**: Consistent navigation and settings on every screen
- **Document Generation System**: Numeric document types with server-side PDF generation

**When working with this codebase**:
1. Always use `uid` (never `username` or `getUsernameFromEmail`)
2. Always use `companyId` (never `companyName`)
3. Screen logic goes in `modules/`, thin wrappers in `app/`
4. Use `withGate` for subscription gating
5. Use `useCache()` for data access (getUid, getCompanyId)
6. Use custom alert system (never Alert.alert())
7. Always include `<GlobalHeader />` on every screen
8. Prioritize cross-platform compatibility

---

*Last Updated: February 10, 2026*
*App Version: 2.0.0*
*Platforms: iOS & Android*
