# Smart-Job ERP Monorepo

Smart-Job ERP is a field-service platform for solo operators and business teams. This repository contains the mobile app, the website, the Firebase backend, Cloud Run services, and the shared SQL/contracts packages that power the product.

## What The Project Is Today

The current project is not a Firestore-only app.

- Business-domain persistence is SQL-capable through `packages/db` and the backend switches to SQL when `DATABASE_URL`, `SMART_JOB_DATABASE_URL`, or `SMART_JOB_PERSISTENCE_BACKEND=sql` is set.
- Firebase still remains part of the platform layer for Auth, Cloud Functions, Storage, security rules, push messaging, and compatibility/read-model surfaces.
- Firestore is still used in specific places such as support/chat flows, selected legacy mirrors, company/user cache version docs, and archival jobs.
- Website registration/onboarding is the only supported onboarding path. The mobile app is for sign-in and product usage, not account creation.

## Repository Layout

```text
ERP-System/
|-- phone_app/           Expo + React Native mobile app
|-- website/             Next.js 16 web app
|-- functions/           Firebase Cloud Functions backend
|-- cloudrun-pdf/        Cloud Run PDF preview/generation service
|-- cloudrun-archiver/   Cloud Run archival job
|-- packages/
|   |-- contracts/       Shared enums, constants, paths, account semantics
|   `-- db/              PostgreSQL schema, migrations, Drizzle access layer
|-- firebase.json
|-- firestore.rules
|-- firestore.indexes.json
|-- storage.rules
`-- SETUP.md             Canonical setup and deployment guide
```

## Product Split

### `phone_app/`

- Expo Router mobile app for iOS and Android.
- Used by managers, workers, solo users, and basic users after sign-in.
- Handles jobs, clients, inventory, documents, support, settings, and push-driven workflows.
- Registration was removed from mobile and must not be reintroduced.

### `website/`

- Next.js App Router website.
- Owns public marketing pages, login, password reset, registration, onboarding, upgrade/admin flows, and the web dashboard.
- Proxies protected backend operations through server routes and Cloud Functions.

### `functions/`

- Backend trust boundary for protected business actions.
- All protected writes for jobs, clients, documents, invites, workers, and company-scoped business data go through Cloud Functions.
- Contains the SQL/Firestore backend switch, read-model endpoints, notification orchestration, tax flows, and compatibility mirrors.

### `cloudrun-pdf/`

- Express + Puppeteer service for previewing and generating PDFs.
- Receives Pub/Sub push requests from Functions.
- Writes task/document completion state back to Firebase and mirrors task/document sync state to SQL when `DATABASE_URL` is configured.

### `cloudrun-archiver/`

- Monthly archival job.
- Moves older Firestore jobs/documents into Cloud Storage archives.
- Keeps archival operations idempotent through manifest files and verification before delete.

### `packages/contracts/`

- Shared domain constants and helpers.
- Canonical account types are `solo` and `business`.
- Canonical runtime roles still include `manager`, `worker`, `user`, `basic`, and `dev`.

### `packages/db/`

- Shared PostgreSQL package used by the backend when SQL mode is enabled.
- Contains Drizzle schema, migrations, provisioning, membership, jobs, documents, inventory, tax bookkeeping, read models, and sync helpers.

## Persistence Model

The project currently runs in a hybrid Firebase + SQL architecture.

### SQL-backed domain layer

- `functions/src/sql-access.ts` decides the active backend.
- If `SMART_JOB_PERSISTENCE_BACKEND=sql` or `DATABASE_URL` / `SMART_JOB_DATABASE_URL` is present, the backend uses SQL helpers from `@smart-job/db`.
- SQL-backed areas include provisioning, memberships, company counters, jobs, clients, documents, inventory, tax reservations/idempotency, push tokens, and read models.
- `cloudrun-pdf/` also mirrors task/document state into SQL when `DATABASE_URL` is configured.

### Firebase platform layer

- Firebase Auth remains the identity layer.
- Cloud Functions remain the protected mutation boundary.
- Storage remains the file layer for generated documents, job files, and archives.
- Firestore rules still protect direct client access.

### Firestore compatibility and non-SQL surfaces

- Firestore is still used for support/chat flows, cache-version mirrors, selected legacy profile/business-info mirrors, and the archival pipeline.
- When SQL mode is not enabled, Firestore remains the persistence fallback for the backend.

## Current Architecture Flow

### Website flow

1. User registers on the website.
2. Website onboarding calls backend provisioning flows.
3. Protected dashboard operations go through website API routes to Cloud Functions.
4. Backend writes to SQL when SQL mode is enabled, with Firebase services still handling auth, storage, and compatibility surfaces.

### Mobile flow

1. User signs in with Firebase Auth.
2. App loads profile/data through backend read-model and product APIs.
3. All protected writes go through Cloud Functions.
4. Local state uses MMKV plus cache/version refresh flows.

### Document generation flow

1. Website/mobile requests preview or generate through Functions.
2. Functions publish a Pub/Sub task.
3. `cloudrun-pdf/` renders the document and stores the PDF.
4. Completion state is written back to the task/document records and mirrored to SQL when enabled.

## Core Backend Rules

- Identity is always `uid`.
- Company scope is always `companyId`.
- Job IDs are backend-generated sequential IDs.
- Protected collections are not written directly by clients.
- Document and job file references persist canonical `storagePath` values, not durable Storage bearer URLs.
- Business registration is website-only.
- Basic workspace is a website UI choice that resolves to canonical runtime values: `accountType: solo`, `role: basic`.

## Version Snapshot (2026-04-22)

### Mobile

- Expo `~55.0.15`
- Expo Router `~55.0.12`
- React Native `0.83.4`
- React `19.2.0`
- `@react-native-firebase/*` `^24.0.0`

### Website

- Next.js `^16.2.3`
- React / React DOM `19.2.3`
- Firebase `^12.9.0`
- Firebase Admin `^13.6.1`

### Backend

- Node `22`
- Firebase Functions `^7.0.0`
- Firebase Admin `^13.6.0`
- `@smart-job/db` local package
- `@smart-job/contracts` local package

## Local Development

There is no root package workspace. Install each package/app separately.

### Install dependencies

```bash
cd packages/contracts && npm install
cd ../db && npm install
cd ../../functions && npm install
cd ../website && npm install
cd ../phone_app && npm install
cd ../cloudrun-pdf && npm install
cd ../cloudrun-archiver && npm install
```

### If you are running SQL mode locally

```bash
cd packages/db
npm run db:migrate
```

### Start the website

```bash
cd website
npm run dev
```

### Start the mobile app

```bash
cd phone_app
npm start
```

### Run the backend locally

```bash
cd functions
npm run serve
```

### Start the PDF service

```bash
cd cloudrun-pdf
npm run dev
```

## Common Commands

### `functions/`

```bash
npm run build
npm run typecheck
npm run test
```

### `website/`

```bash
npm run dev
npm run test
npm run typecheck
npm run lint
npm run build
```

### `phone_app/`

```bash
npm start
npm run android
npm run ios
npm run web
npm run test
npm run typecheck
```

### `packages/db/`

```bash
npm run typecheck
npm run db:generate
npm run db:migrate
```

### `cloudrun-pdf/`

```bash
npm run build
npm run test
```

### `cloudrun-archiver/`

```bash
npm run build
npm run test
```

## Setup And Deployment

Use `SETUP.md` as the canonical setup and deployment guide.

That guide covers:

- Firebase/GCP project bootstrapping
- website and mobile Firebase config
- Functions environment variables
- enabling SQL persistence with PostgreSQL
- Pub/Sub + Cloud Run PDF setup
- optional SES email delivery
- archival job deployment

## Readme Guide

- Root README: system overview and architecture
- `website/README.md`: website responsibilities, routes, env, commands
- `phone_app/README.md`: mobile responsibilities, modules, app data flow, commands
