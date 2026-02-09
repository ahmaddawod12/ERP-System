# Smart-Job — Cross-Platform Job & Document Management

A React Native Expo Router mobile app for HVAC/cooling technicians and managers. Runs on **iOS and Android**.

## Key Features

- **Role-based access** — Manager, Worker, User, Basic, Dev
- **Job lifecycle** — Create, assign, fill, submit, approve/deny, finish
- **Inventory tracking** — Personal + company-wide parts with low-stock alerts
- **Client book** — Shared company clients with auto-incrementing IDs
- **Document generation** — Tax Invoice, Price Proposal, Refund, Return Certificate (server-side PDF via Cloud Run)
- **Real-time sync** — Firestore `onSnapshot` listeners + MMKV version-based caching
- **Multi-language** — English, Hebrew, Arabic
- **Dark/Light theme** — Persisted via MMKV

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native + Expo SDK ~54 |
| Navigation | Expo Router v6 (file-based) |
| Backend | Firebase (Firestore, Auth, Storage, Cloud Functions) |
| Cache | MMKV (`react-native-mmkv` v4) with version-based invalidation |
| PDF | Cloud Run + Puppeteer |
| State | React Context API |

## Project Structure

```
app/             # Screens (Expo Router file-based routes)
components/      # Reusable UI components
contexts/        # React Context providers (Cache, Alert, Theme, Language, Header)
hooks/           # Custom hooks (useDocumentTask, useAppStateListener, etc.)
utils/           # Helpers and notification utilities
functions/       # Firebase Cloud Functions
cloudrun-pdf/    # Cloud Run PDF generation service
```

## Firestore Structure

```
{username}/
  ├── profile        — { role, email, companyName, name, phoneNumber }
  ├── inventory      — { parts: { partName: { quantity, lowThreshold } } }
  └── cache          — version tracking (profile, inventory, clients, job IDs...)

companies/{companyName}/
  ├── clients/{id}           — { name, phone, email, address, city, vatNumber }
  ├── workers/{id}           — { email, name, phoneNumber, role }
  ├── PendingJobs/{id}       — { title, status, assignedTo, completedBy, ... }
  ├── finishedJobs/{id}      — { ...job data, finishedAt }
  ├── certifications/{id}    — { type, documentNumber, downloadURL, ... }
  └── business_data/
      ├── business_info      — { businessName, businessNumber, address, ... }
      ├── inventory          — { parts: { partName: { quantity, lowThreshold } } }
      └── cache              — version tracking (workers, business_info, clients, job/cert IDs)
```

## Cache System (MMKV)

- **Manager**: 2 listeners — user cache (profile, inventory) + company cache (workers, business_info, clients, jobs, certs)
- **Worker**: 1 listener — user cache (profile, inventory, pending/finished jobs)
- **User**: 1 listener — user cache (profile, inventory, clients, finished jobs, business_info, certs)
- **Basic**: 1 listener — user cache (profile, clients, business_info, certs — no inventory, no jobs)

Client cache versioning is **role-based**: manager → company cache, others → user cache.

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
5. **Import Firebase functions from `../firebase`** — never from `firebase/firestore` (Web SDK)







