# Smart-Job ERP Monorepo

Smart-Job ERP is a cross-platform ERP system for field-service businesses (HVAC and similar teams). This repository contains mobile, web, and backend services that share the same Firebase project and Firestore schema.

## 2026 Design and Flow Updates

- Mobile UI is standardized around the design system in `phone_app/theme.js` and shared primitives in `phone_app/components/`.
- Business registration is now website-only (`website/src/app/register` and `website/src/app/onboarding`).
- Mobile no longer contains `app/BusinessReg.js`. Do not reintroduce that route.

## Repository Structure

```text
ERP-System/
|-- phone_app/           # Expo + React Native mobile app
|-- website/             # Next.js web app
|-- functions/           # Firebase Cloud Functions
|-- cloudrun-pdf/        # Cloud Run PDF service
|-- cloudrun-archiver/   # Cloud Run archival job
|-- firebase.json
|-- firestore.rules
|-- firestore.indexes.json
`-- storage.rules
```

## Version Snapshot (2026-02-26)

### Phone app (`phone_app/package.json`)
- Expo `~54.0.25`
- Expo Router `~6.0.15`
- React Native `0.81.5`
- React `19.1.0`
- React Native Firebase `^23.8.6`

### Website (`website/package.json`)
- Next.js `16.1.6`
- React / React DOM `19.2.3`
- Firebase Web SDK `^12.9.0`
- Firebase Admin `^13.6.1`

### Functions (`functions/package.json`)
- Node engine `22`
- Firebase Functions `^7.0.0`
- Firebase Admin `^13.6.0`

## Shared Data Model Rules

- Identity:
  - Always use Firebase Auth `uid` for user identity.
  - Always use `companyId` for company-scoped paths.
  - For solo users, `companyId` is the same as `uid`.
- Inventory:
  - Inventory is a single document with a `parts` array and `nextId` counter.
  - Do not model inventory as a Firestore subcollection.
- Jobs:
  - Job IDs are server-generated from a sequential `jid` counter.
  - `PendingJobs`: `p_{jid}`
  - `finishedJobs`: `f_{jid}`
  - `documents`: `d_XXXXX`
  - `d_` is the canonical document prefix for new writes.
  - Valid statuses: `pending`, `waiting`, `finished`, `denied`.
- Mutations:
  - Protected writes must go through Cloud Functions.
  - Avoid direct client writes to protected profile, business, and job documents.

## Canonical Firestore Paths

```text
users/{uid}/
  data/profile
  data/cache
  data/inventory

companies/{companyId}/
  business_data/business_info
  business_data/subscription
  business_data/cache
  business_data/inventory
  workers/{workerId}
  clients/{clientId}
  PendingJobs/{p_XXXXX}
  finishedJobs/{f_XXXXX}
  documents/{d_XXXXX}
  invites/{inviteId}
```

## Getting Started

### Phone app
```bash
cd phone_app
npm install
npx expo start
```

### Website
```bash
cd website
npm install
npm run dev
```

### Cloud Functions
```bash
cd functions
npm install
firebase deploy --only functions
```

## Deployment

- Mobile: EAS Build (`eas build --platform ios` / `android`)
- Website: Vercel (root `website/`)
- Functions: Firebase CLI
- Cloud Run services: `cloudrun-pdf/`, `cloudrun-archiver/`

## Documentation Pointers

- Mobile design and architecture: `phone_app/README.md`
- Monorepo coding rules for Copilot: `.github/copilot-instructions.md`
- Mobile-specific Copilot rules: `phone_app/.github/copilot-instructions.md`
