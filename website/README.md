# Smart-Job ERP Website

Production-ready Next.js website for **Smart-Job ERP — Cross-Platform Business Management System**.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS
- Firebase Web SDK (Auth + Firestore) for frontend
- Firebase Admin SDK for API routes and server-side privileged operations
- React Hook Form + Zod validation
- i18n support (EN/HE/AR) with RTL switching
- Dark/Light theme persisted in local storage

## Features Included

- Public marketing pages:
  - `/`
  - `/features`
  - `/solutions/hvac`
  - `/solutions/field-services`
  - `/pricing` (no checkout)
  - `/security`
  - `/docs` and `/docs/*`
  - `/contact`
  - `/privacy`
  - `/terms`
- Auth:
  - `/register`
  - `/login`
  - `/forgot-password`
- Onboarding wizard:
  - account type, role, company setup/join, language, theme
- Protected app:
  - `/app`
  - `/app/jobs`
  - `/app/workers`
  - `/app/inventory`
  - `/app/inventory-picks`
  - `/app/clients`
  - `/app/documents`
  - `/app/settings`
  - `/app/upgrade`
  - `/app/admin` (Dev role)
- API routes:
  - `/api/documents/generate`
  - `/api/invites/create`
  - `/api/onboarding/join-company`
  - `/api/clients/create` (counter transaction)
  - `/api/upgrades/request`
- Firestore rules draft at `firestore.rules`

## Data Model (website)

- `users/{uid}/profile/data`
- `users/{uid}/subscription/data`
- `companies/{companyId}/business_data/business_info`
- `companies/{companyId}/workers/{workerId}`
- `companies/{companyId}/clients/{clientId}`
- `companies/{companyId}/counters/clients`
- `companies/{companyId}/business_data/inventory/parts/{partId}`
- `companies/{companyId}/PendingJobs/{jobId}`
- `companies/{companyId}/finishedJobs/{jobId}`
- `companies/{companyId}/certifications/{id}`
- `companies/{companyId}/invites/{inviteId}`
- `upgrade_requests/{id}`

## Setup

1. Copy env template:

```bash
cp .env.local.example .env.local
```

2. Fill Firebase client + admin values in `.env.local`.
3. Install dependencies:

```bash
npm install
```

4. Run dev server:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Emulator Support

- Set `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true`
- Set `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`
- Start Firebase emulators from your Firebase project root.

## Seed Demo Data (optional)

```bash
npm run seed:demo
```

Optional env values:
- `SEED_COMPANY_ID`
- `SEED_MANAGER_UID`
- `SEED_WORKER_UID`

## Deployment (Vercel)

1. Import `website` folder as a Vercel project.
2. Set all environment variables from `.env.local.example`.
3. Ensure server routes can initialize Firebase Admin credentials.
4. Deploy.

## Security Notes

- API routes accept a fallback `uid` in body for local development convenience.
- For strict production hardening, pass Firebase ID tokens in `Authorization: Bearer <token>` and enforce verified UID-only behavior.
- Firestore counters and invite lifecycle are best finalized with Cloud Functions for strict transactional constraints and expiry.

