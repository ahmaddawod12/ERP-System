# Smart-Job ERP setup

## Prerequisites

- Node.js 22
- npm
- Docker Desktop
- Java/Android and Xcode tooling when building the Expo native clients
- Terraform 1.14 for infrastructure validation

Each package owns its own `package.json` and lockfile; there is no root npm
workspace.

## Build shared packages

```bash
npm --prefix packages/contracts install
npm --prefix packages/contracts run build
npm --prefix packages/api-contracts install
npm --prefix packages/api-contracts run build
npm --prefix packages/db install
npm --prefix packages/db run build
npm --prefix packages/observability install
npm --prefix packages/observability run build
```

## Local platform

```powershell
.\scripts\local-platform.ps1 doctor
.\scripts\local-platform.ps1 start
.\scripts\local-platform.ps1 status
.\scripts\local-platform.ps1 stop
.\scripts\local-platform.ps1 reset -Yes
```

The lifecycle script creates the labeled `smart-job-local` network and writes
stable local-only secrets to ignored `local-platform/.env.generated`. Compose
starts:

| Service | Loopback endpoint |
|---|---|
| Website | `http://127.0.0.1:3000` |
| API | `http://127.0.0.1:58081` |
| PostgreSQL | `127.0.0.1:55432` |
| Firebase Auth emulator | `http://127.0.0.1:59099` |
| GCS emulator | `http://127.0.0.1:58080` |
| Mailpit | `http://127.0.0.1:58025` |

The script applies `packages/db/migrations/0000_baseline.sql`, assigns local
passwords to least-privilege roles, then starts the application services.

## Website environment

Copy `website/.env.example` to `website/.env.local`:

```dotenv
FIREBASE_PROJECT_ID=
FIREBASE_WEB_API_KEY=
BACKEND_API_BASE_URL=
BACKEND_API_TIMEOUT_MS=12000
WEBSITE_ORIGIN=
WEBSITE_SESSION_SECRET=
CONTACT_CHALLENGE_SECRET=
RECAPTCHA_ENTERPRISE_PROJECT_ID=
NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY=
```

Firebase credentials are used only by server routes. No ID or refresh token may
enter browser JavaScript, HTML, readable cookies, or browser storage.

## API environment

Start from `cloudrun-api/.env.example`. Production requires:

```dotenv
DATABASE_URL=
DATABASE_SSL_MODE=require
FIREBASE_PROJECT_ID=
FIREBASE_WEB_API_KEY=
GCS_PROJECT_ID=
COMPANY_FILES_BUCKET=
WEB_SESSION_ENCRYPTION_KEY_BASE64=
WEB_SESSION_ENCRYPTION_KEY_VERSION=
```

Application Default Credentials authorize Firebase Admin and GCS in production.
The database URL must authenticate as `smart_job_api`.

## Mobile environment

The Expo client requires:

```dotenv
EXPO_PUBLIC_BACKEND_API_BASE_URL=
EXPO_PUBLIC_COMPANY_FILE_UPLOAD_ORIGIN=https://storage.googleapis.com
EXPO_PUBLIC_COMPANY_FILES_BUCKET=
```

Firebase Authentication, Messaging, and Crashlytics are configured through
ignored native files:

- `phone_app/google-services.json`
- `phone_app/GoogleService-Info.plist`

## Database commands

```bash
npm --prefix packages/db run typecheck
npm --prefix packages/db run build
npm --prefix packages/db run test
npm --prefix packages/db run test:migrations
npm --prefix packages/db run db:migrate
```

`test:migrations` creates and drops one isolated loopback PostgreSQL database.
The consolidated baseline is the only migration and is intended for clean
pre-production databases.

## Validation

```bash
node scripts/check-no-ts-nocheck.mjs
node scripts/check-js-syntax.mjs .
node scripts/check-local-platform.mjs
node scripts/check-deployment-security.mjs
node scripts/check-supply-chain-pins.mjs
```

Then run the relevant package tests, typechecks, lints, and builds listed in
`AGENTS.md`.
