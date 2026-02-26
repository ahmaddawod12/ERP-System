# Smart-Job ERP - Cross-Platform Business Management System

Smart-Job ERP is a React Native + Expo Router mobile ERP app for field-service businesses (HVAC, cooling, maintenance, and similar industries). It supports solo owners and companies with worker teams on iOS and Android.

## Who Is This For?

| Business Type | Roles | Description |
|---|---|---|
| Solo business owner | user / basic | One person manages jobs, inventory, clients, and documents |
| Business with workers | manager + workers | Owner assigns jobs, monitors worker progress, and manages shared company resources |

## Design Refresh (2026)

The app UI was modernized at the design-system level so visual improvements propagate across most screens:

- Updated color system for light/dark themes with cleaner contrast and better hierarchy
- Refreshed spacing, border radius, elevation/shadow, and gradient tokens in `theme.js`
- Upgraded shared primitives (`AppText`, `AppButton`, `AppInput`, `SearchInput`, `AppCard`, `AppListItem`, `AppChip`, `AppEmptyState`)
- Redesigned global navigation shell (`GlobalHeader`) with modern floating controls and improved menu panel
- Refreshed auth entry surfaces (`app/Login.js`, splash/auth transitions in `app/index.js`)
- Updated major dashboard surfaces and settings styling for better visual consistency

## Key Features

- Role-based access: manager, worker, user, basic, dev
- Job lifecycle: create, assign, fill, submit, approve/deny, finish
- Inventory tracking: personal inventory (solo) + company inventory (teams) + low-stock alerts
- Client book: shared company clients with auto-incrementing IDs
- Document generation: tax invoice, price proposal, refund, return certificate (server-side PDF via Cloud Run)
- Real-time sync: Firestore `onSnapshot` listeners + MMKV version-based caching
- Subscription gating: module access controlled by `withGate` HOC
- Multi-language: English, Hebrew, Arabic
- Dark/light theme persisted via MMKV

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native + Expo SDK ~54 |
| Navigation | Expo Router v6 |
| Backend | Firebase (Firestore, Auth, Storage, Cloud Functions v2) |
| Cache | MMKV (`react-native-mmkv` v4) with version-based invalidation |
| PDF | Cloud Run + Puppeteer |
| State | React Context API |
| Archiving | Cloud Run Job (Firestore -> Cloud Storage monthly) |

## Project Structure

```text
app/                 # Route files (thin wrappers + withGate HOC)
modules/             # Feature module implementations
  team/              # Team management
  solojob/           # Solo job screens
  documents/         # Document generation/history
  inventory/         # Personal, worker, company inventory
  shared/            # Shared module utilities (gating, shared screens)
components/          # Reusable UI primitives and shared controls
contexts/            # Cache, Alert, Theme, Language, Header providers
hooks/               # Custom hooks
utils/               # Helpers and notification utilities
functions/           # Firebase Cloud Functions
cloudrun-pdf/        # PDF generation service
cloudrun-archiver/   # Monthly archive job
```

## UI Design System

Main style tokens are centralized in `theme.js`:

- `getColors(isDarkMode)` for role-safe theme access
- `spacing`, `borderRadius`, `typography`, `shadows`, `gradients`
- Status palette via `getStatusColors(isDarkMode)`

Use shared components first before adding custom one-off UI:

- Text: `AppText`
- Buttons: `AppButton`, `PrimaryButton`, `SecondaryButton`, `DangerButton`
- Inputs: `AppInput`, `Input`, `SearchInput`
- Surfaces: `AppCard`, `AppListItem`, `AppChip`, `AppEmptyState`
- Layout helpers: `ScrollableContainer`, `GlobalHeader`

## Identity Model

The app uses Firebase Auth UID as the primary user identifier:

| Concept | Firestore Key | Description |
|---|---|---|
| User identity | `uid` | Main user ID used everywhere |
| Company identity | `companyId` | Links users to their company |
| Worker reference | `workerId` | Worker UID in assignments |

No email-derived usernames. Use Auth UID references only.

## Firestore Structure

```text
users/{uid}/
  data/profile            -> { uid, role, email, companyId, accountType, name, phoneNumber, ... }
  data/cache              -> user cache version tracking
  data/inventory          -> { parts: [...], nextId, lastUpdated }  # solo

companies/{companyId}/
  workers/{uid}                         -> membership + role
  clients/{clientId}                    -> shared clients
  counters/clients                      -> auto-increment counter
  PendingJobs/{p_XXXXX}                 -> active jobs
  finishedJobs/{f_XXXXX}                -> completed/denied jobs
  certifications/{c_XXXXX}              -> generated docs/certs
  invites/{inviteId}                    -> onboarding invites
  business_data/business_info           -> company profile
  business_data/subscription            -> { tier, status, enabledModules }
  business_data/cache                   -> company cache version tracking
  business_data/inventory               -> company stock doc

upgrade_requests/{id}
contact_requests/{id}
```

Solo users store business data under `companies/{uid}/*` (their UID is the company ID).

## Cache System (MMKV)

- manager: user cache listener + company cache listener
- worker: user cache listener (profile, inventory, jobs)
- user: user cache listener (profile, inventory, clients, jobs, docs)
- basic: user cache listener (profile, clients, business info, docs)

Client cache versioning is role-based:

- manager -> company cache
- others -> user cache

Use `useCache()` for profile/inventory/job data. Do not use AsyncStorage for those domains.

## Getting Started

```bash
npm install
npx expo start
```

## Building

```bash
eas build --platform ios
eas build --platform android
```

## Important Rules

1. Never use `Alert.alert()` - use the custom alert system (`useAlert()`).
2. Never use AsyncStorage for profile data - use `useCache()`.
3. Always include `<GlobalHeader />` on every screen.
4. Always use numeric document types (`DOC_TYPE.TAX_INVOICE`, etc.).
5. Import Firebase from `../firebase` (React Native Firebase chainable API).
6. Use `uid` instead of `username`.
7. Use `companyId` instead of `companyName`.
8. Screens live in `modules/`; `app/` files are thin wrappers with `withGate`.
9. Do not write profile/cache/inventory/job documents directly to Firestore; use Cloud Functions (`updateJobV1`, `updateInventoryV1`, `updateCacheV1`, `updateProfileV1`, etc.).
10. Valid job statuses: `pending`, `waiting`, `finished`, `denied`.
11. Push token lifecycle: refresh via `updatePushTokenV1`; clear on logout via `clearPushTokenV1`.
12. MMKV keys are user-scoped (`uid:companyId:` prefix) to prevent cross-user leaks.
13. Prefer shared UI primitives from `components/` before writing custom styling per screen.
