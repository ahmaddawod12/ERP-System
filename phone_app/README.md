# Smart-Job ERP — Cross-Platform Business Management System

A comprehensive **ERP (Enterprise Resource Planning)** mobile application built with React Native and Expo Router. Designed for **solo business owners** and **business owners with teams of workers** — primarily in HVAC/cooling, field services, and similar industries. Runs on **iOS and Android**.

## Who Is This For?

| Business Type | Roles | Description |
|---|---|---|
| **Solo business owner** | User / Basic | One person manages their own jobs, inventory, clients, and documents |
| **Business with workers** | Manager + Workers | Owner (manager) assigns jobs to workers, monitors progress, manages team inventory and company resources |

## Key Features

- **Role-based access** — Manager, Worker, User, Basic, Dev
- **Job lifecycle** — Create, assign, fill, submit, approve/deny, finish
- **Inventory tracking** — Personal inventory (solo users) + company-wide parts with low-stock alerts (teams)
- **Client book** — Shared company clients with auto-incrementing IDs
- **Document generation** — Tax Invoice, Price Proposal, Refund, Return Certificate (server-side PDF via Cloud Run)
- **Real-time sync** — Firestore `onSnapshot` listeners + MMKV version-based caching
- **Subscription gating** — Module access controlled by `withGate` HOC based on subscription tier
- **Multi-language** — English, Hebrew, Arabic
- **Dark/Light theme** — Persisted via MMKV

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native + Expo SDK ~54 |
| Navigation | Expo Router v6 (file-based) |
| Backend | Firebase (Firestore, Auth, Storage, Cloud Functions v2) |
| Cache | MMKV (`react-native-mmkv` v4) with version-based invalidation |
| PDF | Cloud Run + Puppeteer |
| State | React Context API |
| Archiving | Cloud Run Job (Firestore → Cloud Storage monthly) |

## Project Structure

```
app/                 # Route files (thin wrappers + withGate HOC)
modules/             # Feature modules with actual screen implementations
  ├── team/          # Team management (ManageJobs, CreateJob, WorkersMonitor, JobMonitor, WorkersUsers, Workerjob)
  ├── solojob/       # Solo job screens (Userjob, FillJob, EditJob)
  ├── documents/     # Document generation & history
  ├── inventory/
  │   ├── personal/  # UserInventory (solo owners — free-form parts)
  │   ├── teaminventory/ # WorkerInventory (workers — picks from company parts)
  │   └── company/   # CompanyInventory (manager — company-wide stock)
  └── shared/gating/ # withGate HOC for subscription access control
components/          # Reusable UI components
contexts/            # React Context providers (Cache, Alert, Theme, Language, Header)
hooks/               # Custom hooks (useDocumentTask, useAppStateListener, etc.)
utils/               # Helpers and notification utilities
functions/           # Firebase Cloud Functions
cloudrun-pdf/        # Cloud Run PDF generation service
cloudrun-archiver/   # Cloud Run archiver job (monthly Firestore → Storage)
```

## Identity Model

The app uses **Firebase Auth UID** as the primary user identifier throughout:

| Concept | Firestore Key | Description |
|---|---|---|
| User identity | `uid` (Auth UID) | Used as document IDs and references everywhere |
| Company identity | `companyId` | Company identifier linking users to their business |
| Worker reference | `workerId` | Worker's UID, used in job assignments |

> **No email-derived usernames.** All references use the raw Firebase Auth UID.

## Firestore Structure

```
users/{uid}/
  data/profile            � { uid, role, email, companyId, accountType, name, phoneNumber, ... }
  data/cache              � user cache version tracking
  data/inventory          � user inventory { parts: [...] }
  inventory/{id}          � solo personal parts

companies/{companyId}/
  workers/{uid}                         � company membership + role
  clients/{clientId}                    � shared company clients
  counters/clients                      � auto-increment counter for clients
  PendingJobs/{jobId}                   � active jobs
  finishedJobs/{jobId}                  � completed jobs
  certifications/{id}                   � generated docs/certificates
  invites/{inviteId}                    � onboarding invite codes
  business_data/business_info           � business profile
  business_data/subscription            � tier/status
  business_data/cache                   � company cache version tracking
  business_data/inventory/              � canonical company parts catalog

upgrade_requests/{id}                   � manual upgrade requests
contact_requests/{id}                   � public contact submissions
```

## Cache System (MMKV)

- **Manager**: 2 listeners — user cache (profile, inventory) + company cache (workers, business_info, clients, jobs, certs)
- **Worker**: 1 listener — user cache (profile, inventory, pending/finished jobs)
- **User**: 1 listener — user cache (profile, inventory, clients, finished jobs, business_info, certs)
- **Basic**: 1 listener — user cache (profile, clients, business_info, certs — no inventory, no jobs)

Client cache versioning is **role-based**: manager → company cache, others → user cache.

Access via `useCache()` hook — never use AsyncStorage for profile/inventory/job data.

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

1. **Never use `Alert.alert()`** — use the custom alert system (`useAlert()` hook)
2. **Never use AsyncStorage for profile data** — use `useCache()` hook
3. **Always include `<GlobalHeader />`** on every screen (handles back nav + settings)
4. **Always use numeric document types** — `DOC_TYPE.TAX_INVOICE` (305), not string `'taxInvoice'`
5. **Import Firebase from `../firebase`** — uses `@react-native-firebase/*` chainable API, NOT Web SDK
6. **Use `uid` not `username`** — all user references use Firebase Auth UID
7. **Use `companyId` not `companyName`** — all company references use the company identifier
8. **Screens live in `modules/`** — `app/` files are thin wrappers with `withGate` HOC








