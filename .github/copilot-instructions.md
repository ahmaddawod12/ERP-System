# GitHub Copilot Instructions for Smart-Job Application

## 🎯 Application Overview

**Smart-Job** is a comprehensive **cross-platform mobile job management, inventory tracking, and document generation application** built with **React Native Expo Router**. The app is designed for **both iOS and Android platforms** and serves cooling/HVAC technicians, workers, and managers to efficiently manage jobs, track inventory parts, and generate professional business documents.

**⚠️ CRITICAL: All code written for this project MUST be compatible with both iOS and Android platforms. Always use platform-agnostic React Native components and APIs, or use Platform-specific code when necessary.**

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
- **Document Generation**: Server-side PDF generation with Firebase Cloud Functions

### Key Features
- **Custom Alert System**: Modern gradient-based alerts replacing native Alert.alert()
- **Role-based access control** (Manager, Worker, User)
- **Real-time job tracking** and monitoring
- **Inventory management** with low-stock alerts
- **Photo capture** and gallery integration
- **Digital signature** collection
- **GPS location** tracking
- **Multi-language support** (EN, HE, AR)
- **Dark/Light theme** switching
- **Offline-first** with AsyncStorage caching
- **Professional document generation** (Tax Invoices, Price Proposals, Refunds, Return Certificates)
- **Global navigation** with centralized header (back button + settings)

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

### 🔷 App Directory (Screens/Routes)

All files in the `app/` directory are **Expo Router screens** that render on both iOS and Android with identical functionality.

---

#### `app/_layout.js`
**Purpose**: Root layout wrapper that provides global context providers and navigation structure.
- **Providers Stack** (outer to inner):
  1. `ErrorBoundary`: Catches and displays JavaScript errors
  2. `SafeAreaProvider`: Handles notch/status bar on iOS and Android
  3. `ThemeProvider`: Global dark/light mode state
  4. `LanguageProvider`: Global language state (EN, HE, AR)
  5. `Stack`: Expo Router navigation stack
- **Registered Screens**: All app screens with `headerShown: false`
- **Navigation Flow**: Handles role-based routing (Manager/Worker/User)

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
  - Shows Login screen for unauthenticated users
- **User Role Detection**: Fetches user profile from Firestore using username (email prefix)
- **Error Handling**: Defaults to UserHomepage if profile fetch fails


---

#### `app/Login.js`
**Purpose**: Authentication screen with email/password login (iOS and Android compatible).
- **Features**:
  - Email and password input fields
  - Language toggle (EN/HE/AR) in header
  - Theme toggle (light/dark) in header
  - Error handling with platform-native alerts
  - Auto-navigation after successful login
- **UI Components**:
  - `GlobalHeader`: Language and theme controls
  - `Input`: Custom styled text inputs
  - `LinearGradient`: Visual polish
- **Authentication Flow**:
  1. Validates input fields
  2. Signs in with Firebase Authentication
  3. Fetches user profile from Firestore
  4. Routes to appropriate homepage based on role
  5. Creates default profile if none exists

---

#### `app/ManagerHomepage.js`
**Purpose**: Manager dashboard with four tabs - Management, Work, Job Monitor, and Documents (iOS and Android).
- **Features**:
  - **Management Tab**:
    - Workers Monitor card → Navigate to WorkersMonitor screen
    - Manage Workers card → Navigate to WorkersUsers screen
  - **Work Tab**:
    - My Inventory card → Navigate to inventory screen
    - My Jobs card → Navigate to Userjob screen
  - **Job Monitor Tab**:
    - Company-wide job tracking → Navigate to JobMonitor screen
  - **Documents Tab**: NEW!
    - General Documents card → Navigate to GeneralDocuments screen (view/generate business documents)
  - Logout button with confirmation
  - GlobalHeader component (back button + settings)
- **UI**: Colorful gradient cards with icons (MaterialCommunityIcons, Feather)
- **Navigation**: Uses Expo Router's `useRouter()` for navigation
- **Tab State**: URL-based tab management with query parameters

**Cross-Platform Note**: LinearGradient renders identically on iOS and Android. SafeAreaInsets handles different screen shapes.

---

#### `app/WorkerHomepage.js`
**Purpose**: Worker dashboard with job and inventory access (iOS and Android).
- **Features**:
  - My Jobs card → Navigate to Workerjob screen (view/complete assigned jobs)
  - My Inventory card → Navigate to inventory screen
  - Logout button
- **UI**: Clean card-based layout with icons
- **Role**: Workers can only view assigned jobs, not create them

---

#### `app/UserHomepage.js`
**Purpose**: Standard user dashboard for creating and managing own jobs (iOS and Android).
- **Features**:
  - Create & Fill Job card → Navigate to Userjob screen
  - My Inventory card → Navigate to inventory screen
  - Logout button
- **UI**: Consistent card design with icons
- **Role**: Users create their own jobs (not assigned by managers)

---

#### `app/Userjob.js` (1732 lines)
**Purpose**: Complex job creation and management screen for users (iOS and Android).
- **Features**:
  1. **Job List View**: Display all created jobs
  2. **Create New Job**: Full job form with:
     - Job title and description
     - Time worked (from/to) with custom time picker
     - Customer name
     - Location (manual entry or GPS)
     - Photo capture (camera or gallery, max 5 photos)
     - Client signature pad
     - Parts used (select from inventory with quantity)
  3. **Draft System**: Auto-saves drafts to AsyncStorage
  4. **Edit Jobs**: Modify existing jobs
  5. **Delete Jobs**: Remove jobs with confirmation
  6. **Parts Inventory Tracking**: Deducts parts from user's inventory
- **Modals**:
  - Time picker modal (custom scrollable)
  - Photo picker modal (camera/gallery)
  - Signature pad modal (canvas-based)
  - Parts selection modal (searchable list)
- **Storage**:
  - Firebase Storage: Photos and signatures
  - Firebase Firestore: Job data in `{username}/jobs/all/{jobId}`
  - AsyncStorage: Draft data persistence
- **Permissions**: Camera, Photo Library, Location (iOS and Android)

**Cross-Platform Considerations**:
- **Camera**: Uses `expo-image-picker` with platform permission requests
- **Location**: Uses `expo-location` with proper permission handling
- **File System**: Uses `expo-file-system` for signature file operations
- **KeyboardAvoidingView**: Platform-specific behavior (iOS: "padding", Android: "height")
- **SafeAreaView**: Handles notches and system bars

---

#### `app/Workerjob.js` (2654 lines)
**Purpose**: Worker screen to view and complete assigned jobs (iOS and Android).
- **Features**:
  1. **Job List**: Display jobs assigned by manager with status filters
     - Status: pending, received, waiting, accepted, denied
  2. **Fill Job Details**: Complete assigned jobs with:
     - Time worked (from/to)
     - Location (GPS or manual)
     - Customer name
     - Job description
     - Photos (camera/gallery)
     - Client signature
     - Parts used (inventory tracking)
  3. **Mark as Received**: Change status from pending to received
  4. **Submit for Approval**: Send completed job to manager
  5. **Draft System**: Resume incomplete jobs
  6. **Quick Actions on Job Cards**:
     - **Waze Button**: Opens Waze with job location for navigation
     - **Phone Button**: Opens phone dialer to call client
     - **WhatsApp Button**: Opens WhatsApp chat with client (validates Israeli phone numbers)
- **Firestore Structure**:
  - Jobs stored in `companies/{companyName}/jobs/{jobId}`
  - Worker username linked to job
  - Status updates in real-time
- **Inventory Deduction**: Automatically reduces inventory when parts are used and accepted by manager

**WhatsApp Integration (Israeli Phone Validation)**:
```javascript
// handleOpenWhatsApp validates Israeli mobile numbers before opening WhatsApp
// Valid formats: 05XXXXXXXX, +97205XXXXXXXX, 97205XXXXXXXX
// Israeli mobile prefixes: 050, 052, 053, 054, 055, 058
const israeliMobileRegex = /^(?:\+?972|0)(5[0-9])([0-9]{7})$/;

// Opens WhatsApp deep link: https://wa.me/972XXXXXXXXX
```

**Cross-Platform Considerations**:
- **Modal**: Platform-adaptive behavior on iOS and Android
- **ActivityIndicator**: Native loading spinners
- **Image**: Optimized image loading with caching
- **Platform-specific styling**: Different padding for iOS vs Android
- **Linking API**: Used for Waze, Phone, and WhatsApp deep links (works on both platforms)

---

#### `app/JobMonitor.js` (1080 lines)
**Purpose**: Manager screen to monitor all company jobs in real-time (iOS and Android).
- **Features**:
  1. **Job Status Filters**:
     - All, Pending, Received, Waiting, Finished
  2. **Date Filter**: Filter jobs by creation date
  3. **Real-time Updates**: Uses Firestore `onSnapshot` listeners
  4. **Job Details Modal**: View full job information
  5. **Approve/Deny Jobs**: Manager actions for submitted jobs
  6. **Worker Names**: Displays worker name for each job
  7. **Photo Gallery**: Scrollable horizontal photos
  8. **Signature Display**: View client signatures
- **Firestore Queries**:
  - Listens to `companies/{companyName}/jobs` collection
  - Categorizes by status in real-time
  - Fetches worker profiles for display names
- **UI**: Color-coded status badges, expandable job cards

**Cross-Platform Considerations**:
- **Firestore Listeners**: Work identically on iOS and Android
- **Image Loading**: Platform-optimized caching
- **ScrollView**: Native smooth scrolling
- **Date Picker**: Platform-native date pickers

---

#### `app/ManageJobs.js` (672 lines) **NEW**
**Purpose**: Manager screen for managing pending/in-process jobs with Accept/Deny functionality (iOS and Android).
- **Features**:
  1. **Create Job Button**: Navigate to CreateJob screen to assign new jobs to workers
  2. **Pending Jobs List**: Real-time display of jobs with status 'pending', 'received', or 'waiting'
  3. **Accept Job**: Approve submitted jobs with status 'waiting'
     - Automatically deducts parts from worker's inventory
     - Moves job to finished jobs collection
     - Updates job status to 'finished'
  4. **Deny Job**: Reject submitted jobs
     - Updates job status to 'denied'
     - Notifies worker
  5. **Job Details Modal**: View complete job information including photos, signatures, parts used
  6. **Real-time Updates**: Uses Firestore `onSnapshot` listeners for live job updates
  7. **Status Badges**: Color-coded job status indicators (pending, received, waiting)
- **Firestore Structure**:
  - Reads from: `companies/{companyName}/jobs` collection
  - Writes to: `companies/{companyName}/finishedJobs` collection (on accept)
  - Updates worker inventory: `{workerUsername}/inventory/parts` (on accept)
- **Manager Workflow**:
  1. View jobs in pending/received/waiting status
  2. Click job to view full details
  3. Accept job → Deduct parts from worker inventory → Move to finished jobs
  4. Deny job → Update status to 'denied'
- **UI**: Card-based layout with status badges, worker names, creation timestamps
- **Navigation**: Integrated in ManagerHomepage's Job Monitor tab (replaces old CreateJob button)

**Cross-Platform Considerations**:
- **Firestore Listeners**: Real-time updates work identically on iOS and Android
- **Custom Alerts**: Uses alert.confirm() for Accept/Deny confirmations
- **Modal**: Native modal component for job details
- **Image Rendering**: Optimized photo gallery display

---

#### `app/inventory.js` (872 lines)
**Purpose**: Inventory management screen for tracking parts (iOS and Android).
- **Features**:
  1. **Add New Parts**: Name, quantity, low-stock threshold
  2. **View Parts List**: Scrollable list with search
  3. **Use Parts**: Deduct quantity with modal
  4. **Add Quantity**: Increase stock
  5. **Delete Parts**: Remove with confirmation
  6. **Low Stock Warnings**: Visual indicators and alerts
  7. **Real-time Updates**: Firestore `onSnapshot` listener
- **Firestore Structure**:
  - `{username}/inventory/parts` (single document with parts object)
  - Each part: `{ name, quantity, lowThreshold }`
- **UI Components**:
  - Search bar for filtering parts
  - Color-coded cards (red for low stock)
  - Modals for add/use/delete actions

**Cross-Platform Considerations**:
- **Modal**: Native modal on both platforms
- **Alert**: Platform-native alert dialogs
- **TextInput**: Native keyboard handling
- **Real-time Listeners**: Firestore SDK works identically

---


#### `app/WorkersMonitor.js` (1428 lines)
**Purpose**: Manager tool to monitor worker inventory and jobs (iOS and Android).
- **Features**:
  1. **Worker Selection**: Dropdown/list of all company workers
  2. **Worker Jobs Tab**: View all jobs assigned to selected worker
     - Approve/deny submitted jobs
     - Edit job details
     - View job photos and signatures
  3. **Worker Inventory Tab**: View worker's parts inventory
     - Edit worker inventory quantities
     - Add/remove parts
  4. **Create Job**: Assign new job to selected worker
  5. **Real-time Updates**: Live monitoring with Firestore listeners
- **Firestore Structure**:
  - Worker list: `companies/{companyName}/workers/list`
  - Worker jobs: `companies/{companyName}/jobs` (filtered by worker)
  - Worker inventory: `{workerUsername}/inventory/parts`
- **Manager Actions**:
  - Approve job → Move to finished jobs collection
  - Deny job → Update status to denied
  - Edit job → Update job fields
  - Create job → New document in jobs collection

**Cross-Platform Considerations**:
- **Multiple Modals**: Native modal stacking
- **FlatList**: Optimized list rendering on both platforms
- **Complex State**: Works identically on iOS and Android

---

#### `app/WorkersUsers.js` (808 lines)
**Purpose**: Manager tool to create, edit, and delete worker accounts (iOS and Android).
- **Features**:
  1. **Worker List**: Display all workers with email/name/phone
  2. **Add Worker**: Create new worker account
     - Email, password, name, phone number
     - Auto-creates Firestore profile
  3. **Edit Worker**: Update worker details
  4. **Delete Worker**: Remove worker with confirmation
- **Firestore Structure**:
  - `companies/{companyName}/workers/list`: Worker credentials
  - `{workerUsername}/profile`: Worker profile with role='worker'
- **Worker Data**:
  ```javascript
  {
    email: string,
    password: string,
    phoneNumber: string,
    name: string,
    role: 'worker',
    companyName: string
  }
  ```
- **Security Note**: Passwords stored in Firestore (consider Firebase Auth in future)

**Cross-Platform Considerations**:
- **KeyboardAvoidingView**: Platform-specific behavior
- **TextInput**: Native keyboard types (email-address, phone-pad)
- **Modal**: Full-screen modal on both platforms

---

#### `app/GeneralDocuments.js`
**Purpose**: Document hub for generating and viewing business documents (iOS and Android).
- **Features**:
  1. **Document Types**:
     - Tax Invoice (חשבונית מס / فاتورة ضريبية)
     - Price Proposal (הצעת מחיר / عرض سعر)
     - Refund (זיכוי / رد)
     - Return Certificate (תעודת החזרה / شهادة إرجاع)
  2. **Navigation**: Routes to specific document creation/generation screens
  3. **Multi-language**: Full Hebrew and Arabic support for document types
- **UI**: Card-based layout with document type icons
- **Navigation Flow**:
  - Tax Invoice → GenerateTaxInvoice (view/generate from completed jobs)
  - Price Proposal → CreatePriceProposal (create new proposal)
  - Refund → CreateRefund (create refund document)
  - Return Certificate → CreateReturnCertificate (create return certificate)

**Cross-Platform Note**: Uses GlobalHeader for consistent navigation and settings access.

---

#### `app/GenerateTaxInvoice.js`
**Purpose**: Generate tax invoices from completed jobs (iOS and Android).
- **Features**:
  1. **Job Selection**: Browse all completed jobs with search
  2. **Job Details View**: Display job information, photos, and signatures
  3. **PDF Generation**: Generate professional tax invoice via Firebase Cloud Function
  4. **Real-time Data**: Fetch completed jobs from Firestore
  5. **Search & Filter**: Search jobs by title, customer name, or description
- **Firestore Queries**:
  - Fetches from `{username}/jobs/all` where status = 'finished'
  - Fetches from `companies/{companyName}/finishedJobs` for managers
- **PDF Generation Flow**:
  1. Select completed job
  2. Send job data to Cloud Function
  3. Cloud Function generates PDF
  4. Download/view PDF
- **UI**: Searchable list with job cards and modal details view

**Cross-Platform Considerations**:
- **Firebase Cloud Functions**: Server-side PDF generation (platform-independent)
- **PDF Viewing**: Uses platform-native PDF viewers
- **Real-time Listeners**: Firestore onSnapshot for live updates

---

#### `app/CreatePriceProposal.js`
**Purpose**: Create professional price proposals for customers (iOS and Android).
- **Features**:
  1. **Customer Details**: Name, email, phone, address
  2. **Proposal Details**: Project description, valid until date
  3. **Line Items**: Add multiple items with description, quantity, price
  4. **Calculations**: Auto-calculate subtotal, VAT (17%), and total
  5. **Terms & Conditions**: Custom notes section
  6. **PDF Generation**: Generate via Firebase Cloud Function
- **Form Fields**:
  - Customer: name*, email, phone, address
  - Proposal: description*, valid until date*
  - Items: [{ description*, quantity*, price* }]
  - Additional: notes, terms
- **Validation**: Required fields marked with asterisk
- **PDF Output**: Professional invoice-style PDF with company branding

**Cross-Platform Considerations**:
- **KeyboardAvoidingView**: Platform-specific behavior for input handling
- **ScrollView**: Smooth scrolling on both platforms
- **DateTimePicker**: Platform-native date pickers

---

#### `app/CreateRefund.js`
**Purpose**: Create refund documents for returned items/services (iOS and Android).
- **Features**:
  1. **Customer Information**: Name, email, phone
  2. **Original Invoice**: Reference number, date
  3. **Refund Items**: Multiple items with descriptions, quantities, amounts
  4. **Refund Reason**: Text field for explanation
  5. **Calculations**: Auto-calculate totals with VAT
  6. **PDF Generation**: Generate refund certificate via Cloud Function
- **Form Structure**:
  - Customer: name*, email, phone*
  - Original invoice: number*, date*
  - Items: [{ description*, quantity*, amount* }]
  - Reason: text field
- **Business Logic**:
  - Validates all required fields
  - Calculates VAT (17%)
  - Generates unique refund ID
- **PDF Output**: Official refund document with calculations

**Cross-Platform Considerations**:
- **Dynamic Form**: Add/remove items functionality
- **Platform Keyboard**: Proper keyboard type for number inputs
- **Modal Alerts**: Native alert dialogs

---

#### `app/CreateReturnCertificate.js`
**Purpose**: Create return certificates for equipment/materials (iOS and Android).
- **Features**:
  1. **Customer Details**: Name, phone, address
  2. **Return Information**: Item details, reason, condition
  3. **Item List**: Multiple returnable items with conditions
  4. **Signature Collection**: Customer signature for acknowledgment
  5. **PDF Generation**: Official return certificate document
- **Form Fields**:
  - Customer: name*, phone*, address
  - Items: [{ name*, quantity*, condition*, reason }]
  - Signature: digital signature pad
- **Item Conditions**: New, Used-Good, Used-Fair, Damaged
- **Return Reasons**: Defective, Wrong item, Not needed, Other
- **PDF Output**: Certificate with customer signature and itemized list

**Cross-Platform Considerations**:
- **SignaturePad Component**: WebView-based signature capture
- **FileSystem**: Signature file conversion and storage
- **Cloud Function**: Server-side PDF generation with signature embedding

---

#### `app/CreateJob.js`
**Purpose**: Manager tool to assign jobs to workers (iOS and Android).
- **Features**:
  1. **Worker Selection**: Choose worker from company list
  2. **Job Details**: Title, description, location, due date
  3. **Assignment**: Create job in company jobs collection
  4. **Notifications**: Worker receives assigned job
- **Form Fields**:
  - Worker: dropdown selection*
  - Job: title*, description*, location, due date
- **Firestore Structure**:
  - Saves to `companies/{companyName}/jobs/{jobId}`
  - Job includes: assignedTo, assignedBy, status='pending'
- **Workflow**:
  1. Manager creates job
  2. Job appears in worker's Workerjob screen
  3. Worker completes and submits
  4. Manager approves in JobMonitor

**Cross-Platform Considerations**:
- **Dropdown Picker**: Platform-native picker components
- **Date Picker**: Platform-specific date selection
- **Real-time Updates**: Job instantly appears for worker

---

#### `app/AlertDemo.js` (226 lines) **DEV/DEMO ONLY**
**Purpose**: Demo screen to showcase and test all custom alert styles (iOS and Android).
- **Features**:
  1. **Alert Type Showcase**: Demonstrates all 5 alert types (info, success, error, warning, confirm)
  2. **Interactive Buttons**: Touch to trigger each alert type
  3. **Multi-button Examples**: Shows confirm dialogs with 2-3 buttons
  4. **Custom Icons**: Demonstrates custom icon usage
  5. **Real-world Patterns**: Common alert patterns (delete confirm, save changes, etc.)
- **Purpose**: Testing and documentation for custom alert system
- **Usage**: Navigate to `/AlertDemo` to test alerts during development
- **UI**: Card-based layout with gradient buttons matching alert types
- **Note**: This is a development/demo screen and can be removed in production

**Cross-Platform Note**: All alert behaviors are identical on iOS and Android.

---

### 🔷 Components Directory

All components are **reusable, cross-platform UI elements** that work identically on iOS and Android.

---

#### `components/CustomAlert.js` (217 lines) **NEW**
**Purpose**: Beautiful custom alert modal replacing React Native's Alert.alert()
- **Exports**: CustomAlert component
- **Features**:
  1. **5 Alert Types**: info, success, error, warning, confirm
  2. **Gradient Headers**: Colorful gradient backgrounds with icons
  3. **Smooth Animations**: Scale and fade animations on appear/disappear
  4. **Flexible Buttons**: Support for 1-2 buttons with different styles
  5. **Dark Mode Support**: Automatic theme adaptation
  6. **Icon Customization**: Support for custom icons with Ionicons/MaterialCommunityIcons
- **Props**:
  - `visible`: Boolean to show/hide modal
  - `type`: 'info' | 'success' | 'error' | 'warning' | 'confirm'
  - `title`: Alert title
  - `message`: Alert message
  - `buttons`: Array of button objects with text, style, onPress
  - `icon`: Optional custom icon object
  - `onDismiss`: Callback when alert is dismissed
- **Button Styles**:
  - `primary`/`default`: Blue gradient
  - `destructive`: Red gradient
  - `cancel`: Gray button
- **Usage**: Should NOT be used directly - use `useAlert()` hook instead

**Cross-Platform Note**: Uses Animated API with native driver for 60 FPS animations on both iOS and Android.

---

#### `components/Button.js` (179 lines)
**Purpose**: Reusable button components with different styles (iOS and Android).
- **Exports**:
  1. **PrimaryButton**: Main action button (blue gradient)
  2. **SecondaryButton**: Secondary actions (outlined)
  3. **DangerButton**: Destructive actions (red)
  4. **TextButton**: Minimal text-only button
- **Props**:
  - `onPress`: Callback function
  - `title`: Button text
  - `loading`: Shows ActivityIndicator (platform-native)
  - `disabled`: Grays out and disables touch
  - `style`, `textStyle`: Custom styling
- **Features**:
  - Loading state with spinner
  - Disabled state styling
  - Active opacity feedback

**Cross-Platform Note**: TouchableOpacity and ActivityIndicator render natively on both platforms.

---

#### `components/Card.js` (88 lines)
**Purpose**: Reusable card container components (iOS and Android).
- **Exports**:
  1. **Card**: Base card container with optional elevation
  2. **CardHeader**: Header section with title/subtitle/action
  3. **CardContent**: Main content area with padding
  4. **CardFooter**: Footer section with top border
- **Props**:
  - `children`: Content to render inside
  - `onPress`: Optional press handler (makes card touchable)
  - `elevated`: Adds shadow/elevation (platform-adaptive)
  - `style`: Custom styling
- **Styling**: Uses theme colors, spacing, and shadows

**Cross-Platform Note**: Shadow styles adapt automatically using Platform.select in theme.js.

---

#### `components/Input.js` (139 lines)
**Purpose**: Reusable text input components with validation (iOS and Android).
- **Exports**:
  1. **Input**: Standard text input with label
  2. **SearchInput**: Search-specific input with icon
- **Props**:
  - `label`: Optional label text
  - `value`, `onChangeText`: Controlled input
  - `placeholder`: Placeholder text
  - `error`: Error message (shows red border)
  - `helperText`: Help text below input
  - `required`: Shows asterisk on label
  - `multiline`: Multi-line text area
  - `numberOfLines`: Lines for multiline
- **Features**:
  - Error state styling
  - Helper text
  - Required field indicator
  - Auto-dismiss keyboard on submit
  - Platform-adaptive keyboard behavior

**Cross-Platform Considerations**:
- **Keyboard.dismiss()**: Works on both platforms
- **returnKeyType**: Platform-specific keyboard return key
- **textAlignVertical**: Android-specific prop for multiline

---

#### `components/Loading.js` (317 lines)
**Purpose**: Beautiful loading indicators (iOS and Android).
- **Exports**:
  1. **LoadingSpinner**: Small rotating spinner with pulse animation
  2. **FullScreenLoader**: Full-screen loader with multiple rings and dots
  3. **SkeletonLoader**: Skeleton loading placeholders
- **Features**:
  - Animated with React Native Animated API
  - Customizable size
  - Smooth animations (60 FPS)
  - Linear gradients
- **Animations**:
  - Rotation animation
  - Pulse/scale animation
  - Fade-in animation
  - Bouncing dots animation

**Cross-Platform Note**: Animated API uses native driver (useNativeDriver: true) for 60 FPS performance on both platforms.

---

#### `components/PhotoPicker.js` (426 lines)
**Purpose**: Custom photo selection interface with camera and gallery support (iOS and Android).
- **Features**:
  1. **Take Photo**: Launch camera
  2. **Choose from Gallery**: Launch gallery (multi-select supported)
  3. **Photo Preview**: Display selected photos with remove option
  4. **Max Photos**: Limit number of photos (default 5)
  5. **Existing Photos**: Support for editing with pre-loaded photos
- **Props**:
  - `visible`: Modal visibility
  - `onClose`: Close callback
  - `onPhotosSelected`: Callback with selected photos array
  - `maxPhotos`: Maximum allowed photos
  - `existingPhotos`: Pre-selected photos
- **Permissions**:
  - **iOS**: Camera and Photo Library
  - **Android**: CAMERA and READ_EXTERNAL_STORAGE
- **Image Quality**: 0.8 compression for storage optimization

**Cross-Platform Considerations**:
- **expo-image-picker**: Handles platform permissions automatically
- **ImagePicker.requestCameraPermissionsAsync()**: Works on both platforms
- **ImagePicker.requestMediaLibraryPermissionsAsync()**: Works on both platforms
- **Multi-select**: Android native, iOS uses picker sheet

---

#### `components/SignaturePad.js` (190 lines)
**Purpose**: Digital signature capture component (iOS and Android).
- **Features**:
  1. **Canvas Drawing**: Smooth signature drawing with WebView
  2. **Clear Button**: Reset signature
  3. **Save Button**: Capture signature as base64 PNG
  4. **File Conversion**: Converts base64 to file URI using expo-file-system
- **Implementation**:
  - Uses `react-native-signature-canvas` (WebView-based)
  - Saves to cache directory as PNG file
  - Returns file URI for upload
- **Props**:
  - `onSave`: Callback with file URI
  - `onCancel`: Close handler
- **File System**:
  - **iOS**: Saves to cache directory
  - **Android**: Saves to cache directory
  - Uses legacy FileSystem API with Base64 encoding

**Cross-Platform Considerations**:
- **WebView**: Uses react-native-webview (works on both platforms)
- **FileSystem**: expo-file-system legacy API (compatible with both)
- **Base64 Conversion**: Platform-agnostic

---

#### `components/TimePicker.js` (353 lines)
**Purpose**: Custom scrollable time picker (better than native pickers, iOS and Android).
- **Features**:
  1. **Hour Selector**: 00-23 scrollable column
  2. **Minute Selector**: 00-59 scrollable column
  3. **Smooth Scrolling**: FlatList with snap-to-interval
  4. **Selection Indicator**: Visual highlight of selected time
  5. **HH:MM Format**: Returns formatted time string
- **Props**:
  - `visible`: Modal visibility
  - `onClose`: Cancel callback
  - `onConfirm`: Callback with time string, hour, minute
  - `initialHour`, `initialMinute`: Default values
  - `title`: Modal title
- **Implementation**:
  - Uses FlatList with `snapToInterval` for smooth selection
  - Auto-scrolls to initial value
  - Handles scroll events to update selection

**Cross-Platform Note**: FlatList provides native scrolling performance on both iOS and Android.

---

#### `components/ViewJobDetails.js` (368 lines)
**Purpose**: Modal component to display full job details (iOS and Android).
- **Features**:
  1. **Job Information**: Title, description, location, customer name
  2. **Time Information**: Time worked, due date, created date
  3. **Status Badge**: Color-coded status indicator
  4. **Parts Used**: List of parts with quantities
  5. **Photo Gallery**: Horizontal scrollable photos with tap-to-enlarge
  6. **Signature Display**: Client signature image
- **Props**:
  - `visible`: Modal visibility
  - `job`: Job object with all data
  - `onClose`: Close callback
  - `translations`: Localized strings
  - `getStatusColor`: Function to get status color
  - `onImagePress`: Photo enlarge callback
  - `isDarkMode`: Theme flag
- **UI**: Full-screen modal with ScrollView for long content

**Cross-Platform Note**: Modal renders natively on both iOS (presentation style) and Android (dialog).

---

#### `components/GlobalHeader.js` (235 lines)
**Purpose**: Global navigation header with back button, theme, and language controls (iOS and Android).
- **Features**:
  1. **Back Button**: Automatically appears on all pages except homepages (ManagerHomepage, WorkerHomepage, UserHomepage)
     - Positioned top-left
     - Uses `router.back()` from expo-router
     - Detects current page with `usePathname()`
  2. **Settings Button**: Opens modal with theme and language options
     - Positioned top-right
     - Modal overlay with settings panel
  3. **Theme Selection**: Light/Dark mode toggle with visual indicators
  4. **Language Selection**: EN/HE/AR options with visual indicators
  5. **Settings Modal**: Beautiful centered modal with:
     - Theme section (Light/Dark buttons)
     - Language section (EN/HE/AR buttons)
     - Close button
- **Implementation**:
  - Uses Context API for global theme and language state
  - Absolute positioning for floating header
  - Platform-specific top padding (iOS notch handling)
  - Conditional rendering based on pathname
- **Icons**: Ionicons and MaterialCommunityIcons (cross-platform)
- **State Management**:
  - `useRouter()`: Navigation
  - `usePathname()`: Current route detection
  - `useLanguageContext()`: Global language state
  - `useThemeContext()`: Global theme state

**Cross-Platform Considerations**:
- **Platform.OS**: Adjusts top padding for iOS status bar (60px) vs Android (48px)
- **Modal**: Native modal with transparent overlay
- **TouchableOpacity**: Native touch feedback
- **AsyncStorage**: Persists theme and language preferences on both platforms
- **Navigation**: expo-router works identically on iOS and Android

**IMPORTANT**: GlobalHeader should be included on every screen. It automatically handles:
- Showing/hiding back button based on current route
- Providing consistent settings access
- Maintaining theme and language state globally

---

#### `components/ErrorBoundary.js` (140 lines)
**Purpose**: Catches JavaScript errors and displays fallback UI (iOS and Android).
- **Features**:
  1. **Error Catching**: React class component with componentDidCatch
  2. **Fallback UI**: Friendly error message with retry button
  3. **Dev Mode Details**: Shows error stack trace in development
  4. **Reset Handler**: Try again button to reset error state
- **Implementation**:
  - React Error Boundary pattern
  - Logs errors to console
  - Shows error details only in __DEV__ mode
- **UI**: Centered card with error message and retry button

**Cross-Platform Note**: Error boundaries work identically on iOS and Android.

---

#### `components/index.js`
**Purpose**: Barrel export file for easy component imports.
- **Exports**: All components from single import
- **Usage**: `import { Button, Card, Input } from '../components';`

---

### 🔷 Contexts Directory

Global state management using React Context API (works identically on iOS and Android).

---

#### `contexts/LanguageContext.js` (67 lines)
**Purpose**: Global language state management (EN, HE, AR).
- **Features**:
  1. **Language State**: Current selected language
  2. **Toggle Language**: Cycles through EN → HE → AR
  3. **AsyncStorage Persistence**: Remembers preference
  4. **Provider Component**: Wraps entire app
- **Exports**:
  - `LanguageProvider`: Context provider component
  - `useLanguageContext`: Hook to access language state
- **Methods**:
  - `language`: Current language code
  - `setLanguage(code)`: Set specific language
  - `toggleLanguage()`: Cycle to next language
- **Persistence**: Saves to AsyncStorage with key `app_language`

**Cross-Platform Note**: AsyncStorage works identically on iOS and Android with native storage backends.

---

#### `contexts/ThemeContext.js` (66 lines)
**Purpose**: Global theme state management (light/dark mode).
- **Features**:
  1. **Theme State**: Current theme (light or dark)
  2. **Toggle Theme**: Switch between light and dark
  3. **AsyncStorage Persistence**: Remembers preference
  4. **Provider Component**: Wraps entire app
- **Exports**:
  - `ThemeProvider`: Context provider component
  - `useThemeContext`: Hook to access theme state
- **Methods**:
  - `isDarkMode`: Boolean indicating current theme
  - `setTheme(isDark)`: Set specific theme
  - `toggleTheme()`: Toggle between light and dark
- **Persistence**: Saves to AsyncStorage with key `app_theme`

**Cross-Platform Note**: Theme colors adapt automatically for platform-specific UI elements.

---

#### `contexts/AlertContext.js` (110 lines) **NEW**
**Purpose**: Global alert state management for custom alert dialogs.
- **Features**:
  1. **Alert State**: Manages visibility, type, content of current alert
  2. **Helper Methods**: Convenience functions for common alert patterns
  3. **Provider Component**: Wraps entire app with AlertProvider
- **Exports**:
  - `AlertProvider`: Context provider component with CustomAlert integration
  - `useAlert`: Hook to access alert functionality
- **Methods**:
  - `showAlert(type, title, message, buttons, icon)`: Show custom alert
  - `hideAlert()`: Dismiss current alert
  - `success(title, message, buttons)`: Show success alert (green)
  - `error(title, message, buttons)`: Show error alert (red)
  - `warning(title, message, buttons)`: Show warning alert (yellow)
  - `info(title, message, buttons)`: Show info alert (blue)
  - `confirm(title, message, buttons)`: Show confirmation dialog (purple)
- **Integration**: AlertProvider wraps entire app in _layout.js
- **Usage Example**:
  ```javascript
  const alert = useAlert();
  alert.success('Success', 'Job created successfully!');
  alert.confirm('Delete Job', 'Are you sure?', [
    { text: 'Cancel', style: 'cancel', onPress: () => {} },
    { text: 'Delete', style: 'destructive', onPress: handleDelete }
  ]);
  ```

**Cross-Platform Note**: Modal and state management work identically on iOS and Android.

---

#### `contexts/CacheContext.js` (~600 lines) **NEW - CRITICAL**
**Purpose**: High-performance MMKV-based caching system to minimize Firebase reads and enable offline-first functionality.

⚠️ **CRITICAL: This is the primary data caching system. NEVER use AsyncStorage for user profile data. Always use the `useCache()` hook.**

- **Features**:
  1. **MMKV Storage**: Uses `react-native-mmkv` for ultra-fast synchronous key-value storage (10x faster than AsyncStorage)
  2. **Role-Based Cache Structure**: Separate cache structures for Manager, Worker, and User roles
  3. **Version-Based Invalidation**: Real-time Firebase listeners track version changes (e.g., `inventory: 3`) to trigger cache refresh
  4. **90-Day Expiry**: Automatically cleans up `finishedJobs` and `certifications` older than 90 days
  5. **Offline-First**: Immediate UI updates from cache while Firebase syncs in background
  6. **Cross-Device Sync**: Version increments in Firestore trigger all devices to refresh their caches

- **Exports**:
  - `CacheProvider`: Context provider component wrapping entire app
  - `useCache`: Hook to access all cache functionality

- **Cache Structure by Role**:

  **Manager Cache** (Firestore: `{username}/cache` + `companies/{companyName}/business_data/cache`):
  ```javascript
  {
    profile: { role, email, companyName, name, phoneNumber },
    inventory: { partName: { quantity, lowThreshold } },
    workersList: [{ email, name, phoneNumber }],
    pendingJobs: [{ id, title, status, assignedTo, ... }],
    finishedJobs: [{ id, title, finishedAt, ... }],
    certifications: [{ id, type, createdAt, ... }],
    businessInfo: { businessName, businessNumber, ... },
    clients: [{ id, name, phone, email, address, city, vatNumber }]
  }
  ```

  **Worker Cache** (Firestore: `{username}/cache`):
  ```javascript
  {
    profile: { role, email, companyName, name, phoneNumber },
    inventory: { partName: { quantity, lowThreshold } },
    pendingJobs: [{ id, title, status, ... }],
    finishedJobs: [{ id, title, finishedAt, ... }],
    clients: [{ id, name, phone, email, address, city, vatNumber }]
  }
  ```

  **User Cache** (Firestore: `{username}/cache`):
  ```javascript
  {
    profile: { role, email, companyName, name, phoneNumber },
    inventory: { partName: { quantity, lowThreshold } },
    finishedJobs: [{ id, title, finishedAt, ... }],
    certifications: [{ id, type, createdAt, ... }],
    businessInfo: { businessName, businessNumber, ... },
    clients: [{ id, name, phone, email, address, city, vatNumber }]
  }
  ```

- **Methods**:
  - `initializeCache(username, role, companyName)`: Initialize cache for logged-in user
  - `clearCache()`: Clear all cached data (call on logout)
  - `getUsername()`: Get cached username
  - `getCompanyName()`: Get cached company name
  - `profile`: Current user profile object (alias: `cachedProfile`)
  - `cachedProfile`: Current user profile object (for passing to Cloud Functions)
  - `cachedInventory`: Cached inventory parts
  - `cachedWorkersList`: Cached workers list (manager only)
  - `cachedPendingJobs`: Cached pending jobs
  - `cachedFinishedJobs`: Cached finished jobs
  - `cachedCertifications`: Cached certifications/documents
  - `cachedBusinessInfo`: Cached business registration info
  - `cachedClients`: Cached clients list (shared company data)
  - `updateInventory(inventoryData)`: Update cached inventory
  - `updateWorkersList(workersList)`: Update cached workers list
  - `addJob(jobData)`: Add job to pending jobs cache
  - `updateJob(jobId, updates)`: Update existing job in cache
  - `moveJobToFinished(jobData)`: Move job from pending to finished
  - `incrementCacheVersion(field)`: Increment version to trigger refresh on other devices
  - `fetchClients(companyName)`: Fetch all clients from Firebase
  - `addClient(clientData)`: Add new client (auto-generates ID via transaction)
  - `updateClient(clientId, updates)`: Update existing client
  - `deleteClient(clientId)`: Delete client from company
  - `fetchOlderJobs(beforeTimestamp)`: Paginate to load older jobs
  - `cleanupExpiredCache()`: Remove data older than 90 days (based on finishedAt for jobs, createdAt for certifications)

- **Version-Based Invalidation**:
  Each cache field has a version stored as `fieldname: version_number` in Firestore (e.g., `inventory: 3`):
  - `profile`, `inventory`, `pendingJobs`
  - `finishedJobs`, `workersList`, `certifications`, `clients`
  
  **Client cache versioning is role-based:**
  - Manager → increments `clients` in company cache (`isCompanyCache = true`)
  - Worker/User/Basic → increments `clients` in user cache (`isCompanyCache = false`)
  
  When data changes, increment the version:
  ```javascript
  // When a worker's inventory changes (e.g., job accepted)
  await incrementCacheVersion('inventory');
  
  // When jobs list changes
  await incrementCacheVersion('pendingJobs');
  ```

- **Usage Example**:
  ```javascript
  import { useCache } from '../contexts/CacheContext';

  function MyComponent() {
    const {
      getCompanyName,
      getUsername,
      profile,
      cachedProfile,  // Same as profile, use when passing to Cloud Functions
      cachedBusinessInfo,
      cachedInventory,
      cachedPendingJobs,
      cachedClients,   // Cached clients list (shared company data)
      updateInventory,
      addClient,
      incrementCacheVersion,
      moveJobToFinished
    } = useCache();

    // Get company name (synchronous from MMKV)
    const companyName = getCompanyName();

    // Access cached data directly
    const inventory = cachedInventory;
    const jobs = cachedPendingJobs;
    const clients = cachedClients;

    // Update cache and increment version for other devices
    const handleAcceptJob = async (job) => {
      await moveJobToFinished(job);
      await incrementCacheVersion('pendingJobs');
    };
  }
  ```

- **Integration with Firestore**:
  The CacheContext sets up `onSnapshot` listeners on version documents:
  - User cache versions: `{username}/cache`
  - Company cache versions: `companies/{companyName}/business_data/cache`
  
  When a version changes in Firestore, the local cache is automatically refreshed.

- **90-Day Cleanup**:
  ```javascript
  const CACHE_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
  const ARCHIVE_BOUNDARY_MS = 180 * 24 * 60 * 60 * 1000; // ~6 months
  
  // Called automatically on app initialization
  cleanupExpiredCache();
  ```

- **3-Tier Data Access**:
  | Age | Storage Tier | Access Method |
  |-----|-------------|---------------|
  | 0-90 days | MMKV cache | `cachedFinishedJobs`, `cachedCertifications` |
  | 90-180 days | Firestore | `getDataForMonth()` queries Firestore |
  | 180+ days | Cloud Storage | `getDataForMonth()` falls back to `fetchFromArchive()` |

  The `getDataForMonth()` and `getDataForDateRange()` methods automatically handle all 3 tiers:
  1. Check MMKV cache for data within 90 days
  2. Query Firestore for data between 90-180 days
  3. If Firestore returns 0 docs for a month older than ~6 months, download the JSON archive from Cloud Storage

- **Archive Fallback**:
  ```javascript
  // Automatically handled by getDataForMonth:
  const data = await getDataForMonth(new Date(2025, 6, 1), 'finishedJobs');
  // If July 2025 data was archived to Storage, it's downloaded and returned
  
  // Direct archive access (for advanced use):
  const archived = await fetchFromArchive(companyName, 2025, 7, 'finishedJobs');
  ```

**Cross-Platform Note**: MMKV uses native iOS Keychain and Android SharedPreferences for secure, fast storage.

### ⚠️ CACHE SYSTEM RULES

1. **NEVER use AsyncStorage for user profile data** - Always use `useCache()` hook
2. **ALWAYS call `incrementCacheVersion(field)` after modifying data** - This triggers other devices to refresh
3. **ALWAYS use `getCompanyName()` instead of reading from AsyncStorage profile**
4. **Draft data can still use AsyncStorage** - Only profile/inventory/jobs data must use cache

### Example: Converting from AsyncStorage to Cache

**❌ OLD WAY (DO NOT USE)**:
```javascript
import AsyncStorage from '@react-native-async-storage/async-storage';

const cachedProfile = await AsyncStorage.getItem('userProfile');
const profile = JSON.parse(cachedProfile);
const companyName = profile.companyName;
```

**✅ NEW WAY (REQUIRED)**:
```javascript
import { useCache } from '../contexts/CacheContext';

const { getCompanyName } = useCache();
const companyName = getCompanyName(); // Synchronous!
```

---

### 🔷 Hooks Directory

Custom React hooks for reusable logic (iOS and Android).

---

#### `hooks/index.js` (228 lines)
**Purpose**: Collection of custom hooks to reduce boilerplate.
- **Exports**:
  1. **useAuth()**: Authentication state and user info
     - Returns: `{ user, loading, error, username, userRole }`
     - Listens to Firebase auth state
     - Fetches user profile from Firestore
  2. **useLanguage(translations)**: Language state with translations
     - Returns: `{ language, setLanguage, t }`
     - Manages language preference
     - Provides translation function
  3. **useFirestoreDoc(...pathSegments)**: Real-time Firestore document
     - Returns: `{ data, loading, error, refresh }`
     - Sets up onSnapshot listener
     - Auto-cleanup on unmount
  4. **useFirestoreCollection(...)**: Real-time Firestore collection
     - Returns: `{ data, loading, error, refresh }`
     - Query support
     - Real-time updates
  5. **useDebouncedValue(value, delay)**: Debounced value for search
     - Returns: Debounced value
     - Useful for search inputs

**Cross-Platform Note**: All hooks work identically on iOS and Android.

---

#### `hooks/useDocumentTask.js` **NEW - CRITICAL FOR DOCUMENT GENERATION**
**Purpose**: Custom hook for publishing document generation tasks to Cloud Functions via Pub/Sub.

⚠️ **CRITICAL: This hook sends both `cachedBusinessInfo` AND `cachedProfile` to Cloud Functions for document generation.**

- **Exports**:
  - `useDocumentTask`: Hook for document preview and generation

- **Usage**:
  ```javascript
  import { useDocumentTask } from '../hooks/useDocumentTask';

  function DocumentScreen() {
    const { publishPreview, publishGenerate, isPublishing, error } = useDocumentTask();
    
    // Generate preview PDF
    const handlePreview = async () => {
      const result = await publishPreview({
        type: 305,  // NUMERIC! DOC_TYPE.TAX_INVOICE
        client: { name, email, phone, address, clientVatNumber },
        items: [{ description, quantity, price }],
        language: 'he'
      });
      // result contains { success, previewUrl, taskId }
    };
    
    // Generate final document
    const handleGenerate = async () => {
      const result = await publishGenerate({
        type: 305,
        client: { name, email, phone, address, clientVatNumber },
        items: [{ description, quantity, price }],
        documentName: 'Invoice #123',
        language: 'he'
      });
      // result contains { success, downloadUrl, documentId, taskId }
    };
  }
  ```

- **What it sends to Cloud Functions**:
  ```javascript
  {
    ...documentParams,           // type, client, items, language, etc.
    businessInfo: cachedBusinessInfo,  // From CacheContext
    userProfile: cachedProfile,        // From CacheContext (CRITICAL!)
    username: getUsername(),           // From CacheContext
    companyName: getCompanyName()      // From CacheContext
  }
  ```

- **Cloud Function Integration**:
  - Calls `publishPreviewTask` for preview generation
  - Calls `publishGenerateTask` for final document generation
  - Both functions receive `userProfile` and use it for company info fallback

**Cross-Platform Note**: Works identically on iOS and Android.

---

### 🔷 Utils Directory

Utility helper functions (platform-agnostic).

---

#### `utils/helpers.js` (138 lines)
**Purpose**: Common utility functions to reduce code duplication.
- **Exports**:
  1. **getUsernameFromEmail(email)**: Extract username from email
  2. **formatDate(date, locale)**: Format date to locale string
  3. **formatDateTime(date, locale)**: Format date and time
  4. **isValidEmail(email)**: Validate email format with regex
  5. **truncateText(text, maxLength)**: Truncate long text with ellipsis
  6. **calculateTimeDifference(timeFrom, timeTo)**: Calculate minutes between times
  7. **formatDuration(minutes)**: Format minutes to "Xh Ym" string
  8. **getInitials(name)**: Get initials from full name
  9. **sortByDate(array, key, order)**: Sort array by date field
  10. **generateId()**: Generate unique ID
  11. **debounce(func, wait)**: Debounce function calls

**Cross-Platform Note**: All functions are pure JavaScript with no platform-specific code.

---

## 🗂️ Firestore Database Structure

The app uses Firebase Firestore with the following structure (works identically on iOS and Android):

```
Firestore Root
│
├── {username} (document per user)
│   ├── profile (document)
│   │   └── { role, email, companyName, phoneNumber, name }
│   │
│   ├── inventory (document)
│   │   └── { parts: { partName: { quantity, lowThreshold } } }
│   │
│   ├── cache (document - version tracking)
│   │   └── { profile: 1, inventory: 5, clients: 2, ... }
│   │
│   ├── jobs (collection)
│   │   └── all (collection)
│   │       └── {jobId} (document)
│   │           └── { title, description, location, photos[], signature, ... }
│
└── companies (collection)
    └── {companyName} (document)
        │   └── { nextClientId: number }
        │
        ├── workers (collection)
        │   └── {workerId} (document)
        │       └── { email, phoneNumber, name, role }
        │
        ├── clients (collection)
        │   └── {clientId} (document - numeric string ID)
        │       └── { name, phone, email, address, city, vatNumber, createdAt }
        │
        ├── PendingJobs (collection)
        │   └── {jobId} (document)
        │       └── { title, status, assignedTo, completedBy, ... }
        │
        ├── finishedJobs (collection)
        │   └── {jobId} (document)
        │       └── { ...completed job data, finishedAt }
        │
        ├── certifications (collection)
        │   └── {certId} (document)
        │       └── { type, documentNumber, clientName, items[], downloadURL, ... }
        │
        └── business_data (collection)
            ├── business_info (document)
            │   └── { businessName, businessNumber, address, phone, email, ... }
            ├── inventory (document - company-wide parts list)
            │   └── { parts: { partName: { quantity, lowThreshold } } }
            └── cache (document - version tracking for company data)
                └── { workers: 2, business_info: 1, clients: 3, p_ABC12: 1, f_XYZ99: 2, c_QWE45: 1 }
```

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

The Cloud Run service handles PDF generation and email delivery:

#### Files Structure
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
- **Manager**: `companies/{companyName}/business_data/cache`
- **User/Basic**: `{username}/cache`

The `userProfile` is passed from the mobile app through Cloud Functions to Cloud Run, which uses `userProfile.role` to determine the correct cache path for incrementing certification and business_info cache versions.

#### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/preview` | POST | Generate preview PDF (Pub/Sub push) |
| `/generate` | POST | Generate final PDF + send email (Pub/Sub push) |
| `/health` | GET | Health check |

### Email Delivery System

When a document is generated, if the client has an email address, the system automatically sends an email with the download link.

#### Supported Providers

| Provider | Environment Variable | Best For |
|----------|---------------------|----------|
| **SendGrid** (default) | `EMAIL_PROVIDER=sendgrid` | Most use cases |
| **Amazon SES** | `EMAIL_PROVIDER=ses` | AWS infrastructure |

#### Email Format

**Subject:** `{Document Title} - Smart-Job`
- Example: `חשבונית מס מספר 18 - Smart-Job`

**Body includes:**
- Greeting in client's language (HE/EN/AR)
- Document title
- Download button with PDF link
- Company footer

#### Configuration

```bash
# Required for SendGrid
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=SG.xxxxxxxxxxxx
SENDER_EMAIL=noreply@yourdomain.com
SENDER_NAME=Smart-Job

# Required for Amazon SES
EMAIL_PROVIDER=ses
AWS_REGION=eu-west-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
SENDER_EMAIL=noreply@yourdomain.com
```

See `cloudrun-pdf/EMAIL_SETUP.md` for complete setup instructions.

### Tax Invoice Special Features

Tax invoices (חשבונית מס) have special handling for Israeli Tax Authority compliance:

#### Confirmation Number (מספר הקצאה)

- Each tax invoice requires approval from Israeli Tax Authority
- The confirmation number is obtained via `getInvoiceApproval` Cloud Function
- Displayed on the PDF under the document title
- For previews, this field shows empty (approval not yet obtained)

#### Client VAT Number (ע.מ לקוח)

- Business customers require VAT number (עוסק מורשה)
- Stored as `clientVatNumber` in Firestore
- Displayed in the client information section of the PDF

### Cloud Functions (functions/index.js)

#### Document Type Constants (DOC_TYPE)

**⚠️ CRITICAL: Document types are ALWAYS numeric. Never use string identifiers like 'taxInvoice' or 'priceProposal'.**

```javascript
// Document Type Constants - USE THESE EVERYWHERE
const DOC_TYPE = {
  PRICE_PROPOSAL: 10,      // הצעת מחיר
  DELIVERY_NOTE: 200,      // תעודת משלוח
  RETURN_CERTIFICATE: 210, // תעודת החזרה
  TAX_INVOICE: 305,        // חשבונית מס
  REFUND: 330,             // זיכוי
  RECEIPT: 400             // קבלה
};

// Document ID Suffix Constants
const DOC_SUFFIX = {
  [DOC_TYPE.TAX_INVOICE]: 'TI',        // Tax Invoice
  [DOC_TYPE.PRICE_PROPOSAL]: 'PP',     // Price Proposal
  [DOC_TYPE.REFUND]: 'RD',             // Refund
  [DOC_TYPE.RETURN_CERTIFICATE]: 'RC', // Return Certificate
  [DOC_TYPE.DELIVERY_NOTE]: 'DN',      // Delivery Note
  [DOC_TYPE.RECEIPT]: 'RT'             // Receipt
};
```

#### Document ID Format

Document IDs follow the format: `${YYYYMMDD}${paddedDocNumber}${suffix}`

**Example**: `20260130000001TI` (Tax Invoice #1 created on January 30, 2026)

- **YYYYMMDD**: Date in year-month-day format
- **paddedDocNumber**: 6-digit zero-padded document number (e.g., 000001)
- **suffix**: 2-letter type suffix (TI, PP, RD, RC, DN, RT)

#### 1. `publishPreviewTask` - Request Preview
Publishes a preview task to Pub/Sub for processing by Cloud Run.

**Input Parameters**:
```javascript
{
  type: 305,  // NUMERIC! Use DOC_TYPE constants (10, 200, 210, 305, 330, 400)
  client: {
    name: string (required),
    email?: string,
    phone?: string,
    address?: string,
    clientVatNumber?: string  // For business customers
  },
  items: [{
    description: string (required),
    quantity: number (required),
    price: number (required)
  }],
  company: {
    name: string (required),
    email?: string,
    phone?: string,
    address?: string,
    vatNumber?: string
  },
  language: 'he' | 'en' | 'ar' (default: 'he'),
  documentNumber?: string,
  date?: string (ISO format),
  notes?: string
}
```

#### 2. `publishGenerateTask` - Generate Document
Generates final PDF, saves to storage, and sends email to client.

**Additional fields for generate**:
```javascript
{
  ...previewParams,
  companyName: string (required),
  documentName?: string,
  jobData?: object,
  confirmationNumber?: string  // For tax invoices (from Tax Authority)
}
```

#### 3. `getInvoiceApproval` - Tax Authority Approval
Submits tax invoice to Israeli Tax Authority and obtains confirmation number.

**Input**:
```javascript
{
  type: 305,  // MUST be DOC_TYPE.TAX_INVOICE (305)
  client: { name, clientVatNumber, ... },
  items: [...],
  company: { name, vatNumber, ... },
  companyName: string
}
```

**Output**:
```javascript
{
  success: true,
  documentId: "20260130000001TI",  // New format: YYYYMMDD + padded number + suffix
  confirmationNumber: "1234567890",  // מספר הקצאה
  invoiceNumber: "000001",
  taskId: "generate_305_..."  // Uses numeric type
}
```

### Document Types (Numeric)

| Type Code | Suffix | Hebrew | English | VAT Required |
|-----------|--------|--------|---------|--------------|
| `10` | PP | הצעת מחיר | Price Proposal | No |
| `200` | DN | תעודת משלוח | Delivery Note | No |
| `210` | RC | תעודת החזרה | Return Certificate | No |
| `305` | TI | חשבונית מס | Tax Invoice | Yes (client) |
| `330` | RD | זיכוי | Refund | No |
| `400` | RT | קבלה | Receipt | No |

### ⚠️ Document Type Usage Rules

**❌ NEVER DO THIS:**
```javascript
// WRONG - String types are deprecated
const type = 'taxInvoice';
const type = 'priceProposal';
if (type === 'receipt') { ... }
```

**✅ ALWAYS DO THIS:**
```javascript
// CORRECT - Always use numeric types
const type = DOC_TYPE.TAX_INVOICE;  // 305
const type = DOC_TYPE.PRICE_PROPOSAL;  // 10
if (type === DOC_TYPE.RECEIPT) { ... }  // type === 400

// Direct numeric comparison is also acceptable
const isTaxInvoice = type === 305;
const isReceipt = type === 400;
```

### Storage & Firestore Structure

```
Firebase Storage:
├── companies/{companyName}/{YYYY-MM}/{documentId}/
│   └── {documentId}.pdf          # e.g., 20260130000001TI.pdf
└── previews/{username}/
    └── preview_{type}_{timestamp}.pdf  # type is numeric (e.g., preview_305_1706...)

Firestore:
├── companies/{companyName}/certifications/c_{documentId}
│   ├── type: 305,                 # NUMERIC type (10, 200, 210, 305, 330, 400)
│   ├── documentType: 'taxInvoice' # Legacy string for display purposes only
│   ├── documentNumber: '000001'
│   ├── clientName, clientEmail, clientPhone, clientAddress
│   ├── clientVatNumber            # For business customers
│   ├── items[], totals
│   ├── downloadURL, storagePath
│   ├── taxAuthorityConfirmationNumber  # For tax invoices
│   └── createdBy, createdAt
└── documentTasks/{taskId}
    ├── status: 'pending' | 'queued' | 'completed' | 'failed'
    ├── documentType: 305          # NUMERIC type
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

A **Cloud Run Job** runs monthly to migrate old data from Firestore to Cloud Storage, reducing storage costs. Data older than ~6 months is archived as monthly JSON files.

### Architecture

```
┌─────────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ Cloud Scheduler     │───▶│ Cloud Run Job    │───▶│ Cloud Storage    │
│ (1st of each month) │     │ (archiver-job)   │     │ (JSON archives)  │
└─────────────────────┘     └──────┬───────────┘     └──────────────────┘
                                    │
                              ┌────┴───────────┐
                              │  Firestore     │
                              │  (delete old)  │
                              └────────────────┘
```

### Data Tiering

| Age | Storage | Access Method | Cost |
|-----|---------|---------------|------|
| 0-90 days | MMKV local cache | Instant, offline | Free |
| 90-180 days | Firestore | Live queries | $0.18/GB |
| 180+ days | Cloud Storage | JSON archives | $0.020/GB (Standard) |
| 365+ days | Cloud Storage | JSON archives | $0.010/GB (Nearline) |
| 1095+ days | Cloud Storage | JSON archives | $0.0012/GB (Archive) |

### What Gets Archived

- **finishedJobs**: `companies/{companyName}/finishedJobs` → archived by `finishedAt`
- **certifications**: `companies/{companyName}/certifications` → archived by `createdAt`

### Storage Structure

```
gs://{bucket}/companies/{companyName}/archives/
├── manifest.json          # Idempotency tracking
├── {YYYY}-{M}-j.json      # finishedJobs for that month
└── {YYYY}-{M}-c.json      # certifications for that month
```

### Cloud Run Job (`cloudrun-archiver/`)

```
cloudrun-archiver/
├── index.js        # Main archiver logic
├── package.json    # Dependencies
└── Dockerfile      # Container config
```

**Month Calculation**: If today is month M, archive month M-6. Handles year boundaries.
- July 2026 → archives January 2026
- March 2026 → archives September 2025

**Safety Guarantees**:
- Upload-before-delete: data verified in Storage before Firestore deletion
- Idempotent: manifest tracks completed archives, safe to re-run
- Per-company isolation: failure in one company doesn’t affect others
- Batch deletes: Firestore batched writes (max 500 per batch)

### Mobile App Integration

The `CacheContext.js` handles 3-tier data access automatically:

```javascript
// getDataForMonth automatically checks: Cache → Firestore → Storage
const data = await getDataForMonth(new Date(2025, 6, 1), 'finishedJobs');

// getDataForDateRange handles ranges spanning multiple tiers
const rangeData = await getDataForDateRange(startDate, endDate, 'certifications');

// Direct archive access
const archived = await fetchFromArchive(companyName, 2025, 7, 'finishedJobs');
```

### Setup

See `ARCHIVER_SETUP.md` for complete deployment instructions.

---

**Cross-Platform Note**: Firestore SDK handles data synchronization identically on iOS and Android.

---

## 🎨 UI/UX Patterns

### Cross-Platform Design Principles
1. **Platform-Adaptive Components**: Use Platform.select for iOS/Android differences
2. **Native Feedback**: TouchableOpacity for buttons, native alerts
3. **Safe Areas**: SafeAreaView for notches and system bars
4. **Keyboard Handling**: KeyboardAvoidingView with platform-specific behavior
5. **Consistent Styling**: Use theme.js for all colors and spacing
6. **Responsive Design**: Use Dimensions API for screen size adaptation

### Common Patterns
- **Modal Dialogs**: Full-screen modals with close button (native on both platforms)
- **Loading States**: LoadingSpinner or ActivityIndicator during async operations
- **Error Handling**: Platform-native Alert.alert() for user messages
- **Form Validation**: Red borders and error messages below inputs
- **Confirmation Dialogs**: Alert.alert with buttons for destructive actions
- **Image Display**: Optimized Image component with loading states
- **List Rendering**: FlatList for performance (virtualized scrolling)

---

## 🔐 Authentication & Authorization

### Role-Based Access Control
- **Manager**: Full access to all features, create workers, monitor all jobs
- **Worker**: View assigned jobs, complete jobs, manage own inventory
- **User**: Create own jobs, manage own inventory

### Firebase Authentication
- Email/Password authentication
- AsyncStorage persistence (stays logged in)
- Auto-logout on Firebase auth state change

### Firestore Security Rules
- Users can only read/write their own documents
- Managers can access company data
- Workers can access assigned jobs

**Cross-Platform Note**: Firebase Auth SDK handles platform-specific secure storage automatically.

---

## 📷 Media Handling (iOS and Android)

### Camera Permissions
- **iOS**: Add to Info.plist (handled by app.json)
  - NSCameraUsageDescription
  - NSPhotoLibraryUsageDescription
- **Android**: Add to AndroidManifest.xml (handled by app.json)
  - CAMERA
  - READ_EXTERNAL_STORAGE

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

**Cross-Platform Note**: expo-image-picker and expo-file-system handle platform differences automatically.

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
  // ... English strings
} : language === 'he' ? {
  title: 'לוח בקרה',
  // ... Hebrew strings
} : {
  title: 'لوحة التحكم',
  // ... Arabic strings
};
```

### RTL Layout
- **Note**: Full RTL support requires additional configuration
- Current implementation: Text translations only
- Future improvement: Add I18nManager for full RTL layout

**Cross-Platform Note**: Both iOS and Android support RTL layouts natively with I18nManager.

---

## 🔧 Development Guidelines

### When Writing New Code

1. **Always Check Platform Compatibility**
   - Use `Platform.OS === 'ios'` or `Platform.OS === 'android'` when needed
   - Prefer cross-platform APIs (most React Native and Expo APIs are cross-platform)

2. **Use Theme System**
   - Import colors from `theme.js` using `getColors(isDarkMode)`
   - Use theme spacing, typography, and shadows
   - Never hardcode colors or spacing values

3. **Handle Loading States**
   - Show LoadingSpinner during async operations
   - Disable buttons during loading (`loading={true}`)
   - Use ActivityIndicator for small loading indicators

4. **Error Handling & User Feedback**
   - **ALWAYS use custom alert system** - Never use Alert.alert()
   - Import: `import { useAlert } from '../contexts/AlertContext';`
   - Get instance: `const alert = useAlert();`
   - Use try-catch for all Firebase operations
   - Show user-friendly error messages with `alert.error('Error', message)`
   - Show success confirmations with `alert.success('Success', message)`
   - Show confirmations with `alert.confirm(title, message, buttons)`
   - Log errors to console for debugging
   - Never expose sensitive error details to users

5. **Form Validation**
   - Validate input before submission
   - Show error messages below input fields
   - Disable submit button when form is invalid
   - Use `isValidEmail()` helper for email validation

6. **Firestore Operations**
   - Always check if user is authenticated
   - Use `getUsernameFromEmail()` to get username
   - Handle errors gracefully (user might be offline)
   - Use real-time listeners (`onSnapshot`) for live data

7. **Image Handling**
   - Request permissions before accessing camera/gallery
   - Compress images (quality: 0.8) before upload
   - Show loading indicator during upload
   - Handle upload errors gracefully

8. **Navigation**
   - Use `useRouter()` from expo-router
   - Use `router.push()` for forward navigation
   - Use `router.back()` for backward navigation (handled by GlobalHeader)
   - Use `router.replace()` for auth transitions
   - **NEVER create individual back buttons** - GlobalHeader handles all navigation
   - Always include `<GlobalHeader />` at the end of your screen JSX

9. **Async Storage**
   - Use for user preferences (theme, language)
   - Use for draft data (offline support)
   - Always handle errors (storage might be full)
   - Clear old data periodically

10. **Accessibility**
    - Add `accessibilityLabel` to touchable elements
    - Use semantic HTML-like components
    - Ensure sufficient color contrast
    - Test with screen readers (TalkBack on Android, VoiceOver on iOS)

### Platform-Specific Considerations

#### iOS-Specific
- Use `Platform.OS === 'ios'` for iOS-only code
- Handle safe area insets for notched devices
- Use higher top padding for status bar (60-70px)
- Test on multiple iPhone models (SE, 13, 14 Pro, etc.)
- Shadow properties: shadowColor, shadowOffset, shadowOpacity, shadowRadius

#### Android-Specific
- Use `Platform.OS === 'android'` for Android-only code
- Use elevation for shadows instead of shadow properties
- Handle back button with `BackHandler` API
- Test on multiple Android versions (8+)
- Consider different screen densities (mdpi, hdpi, xhdpi, xxhdpi)

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
- ✅ Test with VoiceOver/TalkBack (accessibility)

---


### Building for Production
```bash
# Build iOS app (requires Apple Developer account)
eas build --platform ios

# Build Android APK/AAB
eas build --platform android

# Build for both platforms
eas build --platform all
```

**Note**: Use Expo Application Services (EAS) for production builds.

---

## 📦 Key Dependencies (Cross-Platform)

### Core
- `expo`: ~54.0.25 (iOS & Android SDK)
- `react-native`: 0.81.5 (iOS & Android)
- `expo-router`: ~6.0.15 (File-based navigation)

### Firebase (React Native Firebase v23)
- `@react-native-firebase/app`: ^23.8.5 (Firebase core - iOS & Android)
- `@react-native-firebase/auth`: ^23.8.5 (Authentication - iOS & Android)
- `@react-native-firebase/firestore`: ^23.8.5 (Database - iOS & Android)
- `@react-native-firebase/storage`: ^23.8.5 (File storage - iOS & Android)
- `@react-native-firebase/functions`: ^23.8.5 (Cloud Functions - iOS & Android)
- `@react-native-firebase/messaging`: ^23.8.5 (Push notifications - iOS & Android)

### UI Components
- `expo-linear-gradient`: ~15.0.7 (Gradients - iOS & Android)
- `@expo/vector-icons`: ^15.0.3 (Icons - iOS & Android)
- `react-native-safe-area-context`: ~5.6.0 (Safe areas - iOS & Android)

### Media & Sensors
- `expo-camera`: ~17.0.9 (Camera - iOS & Android)
- `expo-image-picker`: ~17.0.8 (Gallery - iOS & Android)
- `expo-location`: ~19.0.7 (GPS - iOS & Android)
- `expo-file-system`: ^19.0.21 (File operations - iOS & Android)

### Signature
- `react-native-signature-canvas`: ^4.7.2 (Signature pad - iOS & Android WebView)
- `react-native-webview`: 13.15.0 (WebView - iOS & Android)

### Storage
- `@react-native-async-storage/async-storage`: 2.2.0 (Local storage for drafts/preferences - iOS & Android)
- `react-native-mmkv`: ^4.1.1 (High-performance cache storage - iOS & Android)

### Gestures & Animation
- `react-native-gesture-handler`: ~2.28.0 (Touch gestures - iOS & Android)
- `react-native-reanimated`: ~4.1.1 (Animations - iOS & Android)

---

## 🎯 Future Improvements

### Recommended Enhancements
1. **Push Notifications**: Notify workers of new jobs (expo-notifications)
2. **Offline Mode**: Queue actions when offline, sync when online
3. **Advanced Search**: Full-text search in jobs and inventory
4. **Job Templates**: Save common job types as templates
5. **Barcode Scanner**: Scan parts for inventory (expo-barcode-scanner)
6. **Chat Feature**: Real-time chat between managers and workers
7. **Analytics Dashboard**: Visual charts for job statistics
8. **Advanced Permissions**: Fine-grained role permissions
9. **Voice Input**: Voice-to-text for descriptions (expo-speech)

### Security Improvements
1. Move worker passwords to Firebase Authentication
2. Implement Firestore Security Rules
3. Add rate limiting for API calls
4. Encrypt sensitive data in AsyncStorage

---

## ⚠️ Important Notes

1. **Cross-Platform First**: Always write code that works on both iOS and Android
2. **Firebase Config**: Never commit Firebase config to public repositories
3. **Permissions**: Always request permissions before accessing camera/location
4. **Error Handling**: Always wrap Firebase calls in try-catch
5. **Loading States**: Always show loading indicators during async operations
6. **Offline Support**: Handle offline scenarios gracefully
7. **Image Optimization**: Compress images before upload (max 800kb)
8. **AsyncStorage Limits**: Keep stored data under 6MB
9. **Firestore Limits**: Max 1MB per document, 500 writes/sec per database
10. **Testing**: Test on real devices, not just simulators/emulators

---

## 🏁 Summary

Smart-Job is a **production-ready, cross-platform mobile application** built with React Native and Expo that runs seamlessly on **both iOS and Android devices**. The app provides comprehensive job management, inventory tracking, and professional document generation for cooling/HVAC professionals.

**Key Strengths**:
- ✅ Full iOS and Android compatibility
- ✅ Role-based access control (Manager, Worker, User)
- ✅ Real-time data synchronization with Firebase
- ✅ Offline-first architecture with AsyncStorage
- ✅ Multi-language support (EN, HE, AR)
- ✅ Dark/Light theme with persistence
- ✅ Professional UI with consistent design system
- ✅ Camera, gallery, and signature capture
- ✅ GPS location tracking
- ✅ Professional document generation (Tax Invoices, Price Proposals, Refunds, Return Certificates)
- ✅ Server-side PDF generation with Firebase Cloud Functions
- ✅ Centralized navigation with GlobalHeader (back button + settings on every screen)
- ✅ Comprehensive error handling
- ✅ Reusable component library
- ✅ Custom hooks for common patterns
- ✅ Type-safe with JSDoc comments

**Architecture Highlights**:
- **GlobalHeader Component**: Provides consistent navigation (back button) and settings access (theme/language) on every screen except homepages
- **Document Generation System**: Four document types with server-side PDF generation via Firebase Cloud Functions
- **Tabbed Manager Dashboard**: Four tabs (Management, Work, Job Monitor, Documents) with URL-based state management
- **Real-time Job Monitoring**: Live Firestore listeners for instant job status updates
- **Smart Inventory Tracking**: Low-stock alerts and automatic deduction when jobs are approved

**When working with this codebase**:
1. Always prioritize cross-platform compatibility
2. Follow the established patterns for consistency and maintainability
3. NEVER create individual back buttons - use GlobalHeader
4. Always include `<GlobalHeader />` on every screen
5. Use Firebase Cloud Functions for server-side operations like PDF generation

---

*Last Updated: January 30, 2025*
*App Version: 1.0.0*
*Platforms: iOS & Android*
