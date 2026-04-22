# Smart-Job ERP Website

The website is the Next.js application for Smart-Job ERP. It owns public pages, authentication entry points, website-only onboarding, and the web dashboard/admin flows.

## What Lives Here

- Public marketing pages and product information
- Login and password reset
- User registration
- Website-only onboarding and company join flows
- Dashboard pages under `/app/*`
- Server-side API proxies to Cloud Functions
- Session handling for protected web routes

## Current Stack

- Next.js `^16.2.3`
- React / React DOM `19.2.3`
- TypeScript `^5`
- Firebase Web SDK `^12.9.0`
- Firebase Admin `^13.6.1`
- React Hook Form + Zod
- Tailwind CSS v4
- `tailwind-merge` + `clsx`
- `jose` for server/session token work

## Current Product Role

The website is the only supported onboarding surface.

- `/register` creates Firebase Auth credentials.
- `/onboarding` completes provisioning through backend flows.
- Worker join flow is website-driven through `/api/onboarding/join-company`.
- Basic workspace is exposed as a website choice, but the backend stores canonical values: `accountType: solo`, `role: basic`.

The website is not a direct SQL client.

- Protected writes go to Cloud Functions.
- Read-model and protected backend routes are proxied through server API handlers.
- The backend decides whether the active persistence layer is SQL or Firestore.

## Architecture Notes

### Auth model

- Browser auth uses Firebase Auth.
- Server-side protected routes rely on the `__session` cookie.
- `/api/auth/session` verifies the Firebase ID token and sets the HttpOnly session cookie.
- `middleware.ts` protects `/app/*` routes.

### Backend data flow

- The website calls Next.js API routes.
- API routes validate input and proxy to Cloud Functions.
- Cloud Functions handle authorization, business rules, and persistence.
- In SQL mode, the backend writes/reads through `@smart-job/db`.

### Route implementation pattern

All page routes follow the current server/client split:

- `page.tsx` is the server wrapper and metadata entry.
- `page-client.tsx` contains client hooks and interactivity.

## Route Map

### Public routes

- `/`
- `/features`
- `/solutions/hvac`
- `/solutions/field-services`
- `/pricing`
- `/security`
- `/docs`
- `/contact`
- `/privacy`
- `/terms`

### Auth routes

- `/register`
- `/login`
- `/forgot-password`
- `/onboarding`

### Protected app routes

- `/app`
- `/app/jobs`
- `/app/workers`
- `/app/inventory`
- `/app/inventory-picks`
- `/app/clients`
- `/app/documents`
- `/app/settings`
- `/app/upgrade`
- `/app/admin`

### API routes in this app

- `/api/auth/session`
- `/api/invites/create`
- `/api/onboarding/join-company`
- `/api/contact/request`
- `/api/documents/*`
- `/api/read-model`
- `/api/upgrades/request`
- `/api/upgrades/list`
- `/api/upgrades/moderate`

## Persistence And Data Model Context

The website operates against a backend that is SQL-capable and Firebase-integrated.

- SQL becomes the backend persistence layer when the Functions environment is configured for SQL mode.
- Firebase still remains part of the product for Auth, Storage, Functions, and some compatibility flows.
- Direct client writes to protected business collections are intentionally blocked by Firestore rules.
- Stored document/job file references use canonical `storagePath` values; the website requests short-lived URLs from the backend when needed.

## Important Backend Assumptions

- `uid` is the user identity.
- `companyId` is the company scope.
- Account types are canonical: `solo` and `business` only.
- Job/document/client/invite/worker writes must go through the backend.
- Company documents, company job files, and company archives are backend-controlled resources.

## Environment Variables

Copy `.env.local.example` to `.env.local`.

### Required public Firebase config

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

### Optional browser/emulator config

- `NEXT_PUBLIC_USE_FIREBASE_EMULATOR`
- `NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST`

### Optional PDF proxy target

- `CLOUDRUN_PDF_URL`

### Firebase Admin config

Use either the full JSON variable or the split values.

- `FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON`
- `FIREBASE_ADMIN_PROJECT_ID`
- `FIREBASE_ADMIN_CLIENT_EMAIL`
- `FIREBASE_ADMIN_PRIVATE_KEY`

### Server emulator config

- `FIRESTORE_EMULATOR_HOST`

### Optional local App Check support

- `NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY`

## Local Development

```bash
npm install
npm run dev
```

App available at `http://localhost:3000`.

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run test
npm run typecheck
npm run seed:demo
```

## Security And Access Model

- API handlers should stay thin: validate input, verify auth, proxy to backend.
- Protected backend actions require bearer-authenticated requests.
- Session cookie handling must remain server-side only.
- Do not write Firebase ID tokens into browser-readable cookies.
- Direct browser writes to locked company collections are not part of the architecture.

## Deployment

- Deploy this app with `website/` as the project root.
- Configure the Firebase public variables and Admin credentials.
- Point production traffic at the deployed Cloud Functions and Cloud Run services expected by the backend.

For full setup and infrastructure steps, use the root `SETUP.md`.
