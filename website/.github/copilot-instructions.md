# GitHub Copilot Instructions - Smart-Job ERP Website

## Overview

Next.js App Router dashboard for Smart-Job ERP. Shares the same Firebase project and Firestore schema as backend and mobile.

Use root `.github/copilot-instructions.md` as global policy. This file adds website-specific rules.

Use the root `SETUP.md` guide for Firebase project setup, website environment variables, Functions CORS, deployment, and first-user onboarding instructions.

## Tech Stack

- Next.js App Router + TypeScript (strict)
- Tailwind CSS
- Firebase Web SDK (client auth + Firestore)
- Firebase Admin SDK (API route auth checks/proxy support)
- React Hook Form + Zod
- EN/HE/AR i18n + RTL

## Hard Data Rules

1. `uid` is user identity. `companyId` is company scope.
2. Never derive `companyId` from `uid` in website code.
3. Never use `companyId || uid` or `companyId ?? uid` fallback patterns.
4. Use profile/backend-provided `companyId` only.
5. Inventory currently remains single-doc (`parts` array + `nextId`) and backend writes enforce a document-size budget. Do not add a website-only subcollection migration.

## Registration / Onboarding Rules

1. `/register` only creates Firebase Auth credentials.
2. `/onboarding` handles provisioning:
- manager/solo -> callable `registerBusinessV1`
- worker -> `/api/onboarding/join-company` -> `joinCompanyV1`
- basic workspace -> callable `registerBusinessV1` with canonical `accountType: solo` and `role: basic`
3. `companyId` is allocated server-side from `system/data/comid`.
4. Stored account types are only `solo` and `business`; do not invent additional runtime account-type values in website code.
5. Canonical onboarding tuples are only `manager + business`, `user + solo`, and `basic + solo`.

## API Route -> Function Mapping (Current)

- `/api/invites/create` -> `createInviteV1`
- `/api/onboarding/join-company` -> `joinCompanyV1`
- `/api/upgrades/request` -> `requestUpgradeV1`
- `/api/upgrades/list` -> `listUpgradeRequestsV1`
- `/api/upgrades/moderate` -> `moderateUpgradeRequestV1`
- `/api/contact/request` -> `contactRequestV1`

Keep these names exact unless backend changes first.

## Document Flow Rules

Use Pub/Sub task flow for documents:

1. Preview: `publishPreviewTask`
2. Generate: `publishGenerateTask`
3. Tax invoice approval: `getInvoiceApproval` (me-west1)
   - Always include a fresh `idempotencyKey`.
4. Saved documents persist `storagePath`; fetch short-lived PDF URLs through `createDocumentDownloadUrlV1` instead of relying on durable Firestore-stored download URLs.
5. Archived job/document months must be fetched through backend functions such as `fetchArchiveMonthV1`; do not wire direct browser reads to archive Storage objects.
6. Middleware-auth cookies must be verified Firebase ID tokens; do not reintroduce JWT-shape-only checks.
7. New generated non-tax documents are create-only backend records. Do not write document records or durable download URLs from website code.

The `useDocumentTask` hook is the canonical website workflow.

## Code Patterns to Preserve

1. Keep API routes thin:
- parse + validate request body
- optional auth check/proxy auth
- proxy to function
2. Keep form validation with Zod + React Hook Form.
3. Keep role/tier access checks consistent with existing auth context and route guards.
4. Upgrade moderation and other privileged admin flows should go through API routes / Functions, never direct browser Firestore writes.
5. Use canonical path conventions:
- `users/{uid}/data/*`
- `companies/{companyId}/*`
- `companies/{companyId}/documents/{docId}`

## Do Not Introduce

- `companyId` fallback to `uid`
- Mobile registration screens/routes in website
- Direct protected writes that bypass backend function validation
- Direct Firestore writes for upgrade moderation or support/admin workflow state
- Durable bearer PDF URLs stored on `companies/{companyId}/documents/{docId}`
- Direct browser reads from `companies/{companyId}/documents/*`, `companies/{companyId}/jobs/*`, or `companies/{companyId}/archives/*`
- Non-canonical job/document status formats outside current schema
- `node-fetch` or similar polyfills (Node 22 has native `fetch()`)
- Direct Firestore writes to locked collections (`clients`, `jobs`, `documents`, `invites`, `workers`)
- Transaction read-after-write patterns in backend-adjacent helper code

## Auth Cookie for Middleware

- `auth-provider.tsx` posts the Firebase ID token to `/api/auth/session`.
- `/api/auth/session` verifies the token server-side and sets the HttpOnly `__session` cookie.
- `middleware.ts` checks `__session` to gate `/app/*` routes server-side and verifies the Firebase ID token signature against Firebase public keys.
- Do not write Firebase ID tokens into JavaScript-readable cookies.

## Page Route Pattern

- All page routes (dashboard AND public auth pages) use the server wrapper + client shell pattern:
  - `page.tsx` — server component with `export const metadata`, wraps `<Suspense>` around the client component.
  - `page-client.tsx` — `"use client"` shell with hooks and interactivity.
  - Do not add `"use client"` directly to `page.tsx` files.
- Auth pages that follow this pattern: `/login`, `/register`, `/forgot-password`, `/onboarding`.
