# GitHub Copilot Instructions - Smart-Job ERP Website

These instructions apply only to `website/` and extend the root `.github/copilot-instructions.md`.

Use the root `SETUP.md` for environment setup, deployment guidance, and onboarding prerequisites.

## Current Website Reality

- Supabase Auth is the active website auth provider.
- The website uses server-side session cookies for protected routing.
- Protected operations proxy to Supabase Edge endpoints through website API routes.
- SQL is the primary ERP persistence layer behind backend services.

## Tech Stack

- Next.js App Router with TypeScript
- Tailwind CSS
- Firebase Web SDK for remaining Firebase-integrated client surfaces
- Firebase Admin SDK for server-side features still using Firebase services
- React Hook Form + Zod
- EN, HE, and AR support with RTL handling

## Hard Data Rules

- `uid` is user identity and `companyId` is company scope.
- Never derive `companyId` from `uid`.
- Never use `companyId || uid` or `companyId ?? uid` fallback patterns.
- Use backend-provided or profile-provided `companyId` only.
- Do not introduce a website-only inventory migration or alternate schema.

## Registration And Onboarding

- `/register` creates the user through the active auth flow.
- `/onboarding` performs provisioning.
- manager and solo flow -> `registerBusinessV1`
- worker flow -> `/api/callable` -> `joinCompanyV1`
- basic workspace flow -> `registerBusinessV1` with canonical `accountType: solo` and `role: basic`
- `companyId` is allocated server-side from SQL counters.

## API Route Rules

- Keep API routes thin: parse, validate, optional auth check, then proxy.
- Preserve current operation names and backend mappings unless backend changes first.
- Keep `read-model` `kind` request schemas aligned with backend-supported kinds.
- Keep privileged admin flows behind API routes and backend functions.
- Do not write protected business data directly from browser code.

## Document Flow Rules

- Use backend task publishing for preview and generate flows.
- Tax invoice approval must include a fresh `idempotencyKey`.
- Saved documents persist canonical `storagePath` refs.
- Fetch short-lived PDF URLs through backend functions.
- Do not wire direct browser reads to archive or protected company Storage objects.
- New generated non-tax documents remain create-only backend records.

`useDocumentTask` remains the canonical website-side task workflow.

## Auth Session Rules

- `/api/auth/session` verifies the bearer token server-side and sets the HttpOnly `__session` cookie.
- `middleware.ts` uses `__session` to protect `/app/*` routes.
- Do not put bearer tokens into JavaScript-readable cookies.
- Do not replace server verification with JWT-shape-only checks.

## Route Pattern

- Keep the server-wrapper plus client-shell pattern.
- `page.tsx` stays a server component with metadata and `<Suspense>` wrapping.
- `page-client.tsx` owns hooks and interactivity.
- Do not add `"use client"` directly to `page.tsx` files.

## Do Not Introduce

- `companyId` fallbacks to `uid`
- direct protected writes that bypass backend validation
- durable bearer PDF URLs stored on document records
- direct browser reads from protected company Storage paths
- non-canonical status values or alternate onboarding tuples
- direct Firestore writes to locked collections
