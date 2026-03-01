# GitHub Copilot Instructions - Smart-Job ERP Website

## Overview

Next.js App Router dashboard for Smart-Job ERP. Shares the same Firebase project and Firestore schema as backend and mobile.

Use root `.github/copilot-instructions.md` as global policy. This file adds website-specific rules.

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
5. Inventory remains single-doc (`parts` array + `nextId`), never subcollections.

## Registration / Onboarding Rules

1. `/register` only creates Firebase Auth credentials.
2. `/onboarding` handles provisioning:
- manager/solo -> callable `registerBusinessV1`
- worker -> `/api/onboarding/join-company` -> `joinCompanyV1`
3. `companyId` is allocated server-side from `system/data/comid`.

## API Route -> Function Mapping (Current)

- `/api/clients/create` -> `addClientV1`
- `/api/invites/create` -> `createInviteV1`
- `/api/onboarding/join-company` -> `joinCompanyV1`
- `/api/upgrades/request` -> `requestUpgradeV1`
- `/api/contact/request` -> `contactRequestV1`
- `/api/documents/generate` -> `generateDocumentV1` (legacy only)

Keep these names exact unless backend changes first.

## Document Flow Rules

Use Pub/Sub task flow for documents:

1. Preview: `publishPreviewTask`
2. Generate: `publishGenerateTask`
3. Tax invoice approval: `getInvoiceApproval` (me-west1)

The `useDocumentTask` hook is the canonical website workflow.

## Code Patterns to Preserve

1. Keep API routes thin:
- parse + validate request body
- optional auth check/proxy auth
- proxy to function
2. Keep form validation with Zod + React Hook Form.
3. Keep role/tier access checks consistent with existing auth context and route guards.
4. Use canonical path conventions:
- `users/{uid}/data/*`
- `companies/{companyId}/*`
- `companies/{companyId}/documents/{docId}`

## Do Not Introduce

- `companyId` fallback to `uid`
- Legacy mobile registration screens/routes in website
- Direct protected writes that bypass backend function validation
- Legacy job/document status formats outside current schema
- `node-fetch` or similar polyfills (Node 22 has native `fetch()`)
- Direct Firestore writes to locked collections (`clients`, `jobs`, `documents`, `invites`, `workers`)

## Auth Cookie for Middleware

- `auth-provider.tsx` sets a `firebase-auth-token` cookie on sign-in and clears it on sign-out.
- The `Secure` flag is conditional on HTTPS protocol (omitted on localhost for local development).
- `middleware.ts` checks this cookie to gate `/app/*` routes server-side.
- Do not remove the cookie-setting logic from auth-provider or the cookie check from middleware.

## Page Route Pattern

- All page routes (dashboard AND public auth pages) use the server wrapper + client shell pattern:
  - `page.tsx` — server component with `export const metadata`, wraps `<Suspense>` around the client component.
  - `page-client.tsx` — `"use client"` shell with hooks and interactivity.
  - Do not add `"use client"` directly to `page.tsx` files.
- Auth pages that follow this pattern: `/login`, `/register`, `/forgot-password`, `/onboarding`.
