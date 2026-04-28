# Smart-Job ERP Setup Guide

This is the canonical setup and deployment guide for the current Smart-Job ERP stack.

It reflects the active April 2026 architecture:

- Supabase Auth for website and mobile sign-in
- Supabase Edge gateways under `supabase/functions/` as the in-repo backend trust boundary
- PostgreSQL as the primary company-scoped ERP persistence layer
- Firestore and Cloud Storage for compatibility, rules, operations, and files
- Cloud Run services for PDF generation and archiving
- Supabase Edge Functions migration work in parallel

## 1. Repository Components

```text
ERP-System/
|-- website/             Next.js website
|-- phone_app/           Expo mobile app
|-- supabase/functions/  Edge gateway and endpoint runtime in this repository
|-- cloudrun-pdf/        PDF preview/generation service
|-- cloudrun-archiver/   Archive batch job
|-- packages/contracts/  Shared enums/constants/path helpers
|-- packages/db/         PostgreSQL schema, migrations, access layer
`-- supabase/            Backend gateway runtime and migration work area
```

## 2. Prerequisites

Install locally:

- Node.js 22
- npm
- Firebase CLI
- Google Cloud CLI
- Java 17 or newer for emulators
- Docker or Cloud Build access for Cloud Run
- EAS CLI for mobile builds
- PostgreSQL access for SQL-backed development and deploys
- Supabase project access for auth and migration testing
- AWS access only if SES email delivery is used

Suggested installs:

```bash
npm install -g firebase-tools eas-cli
```

Authenticate:

```bash
firebase login
gcloud auth login
gcloud auth application-default login
```

## 3. Cloud Project Setup

Create or configure the Firebase and Google Cloud project:

1. Create a Firebase project.
2. Upgrade to Blaze.
3. Enable Firestore.
4. Enable Firebase Storage.
5. Enable Cloud Messaging.
6. Enable Authentication if you still need Firebase-native mobile or runtime services, but do not treat Firebase Auth as the primary client auth provider.
7. Enable these Google Cloud APIs:

```bash
gcloud services enable \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com \
  pubsub.googleapis.com \
  firestore.googleapis.com \
  firebase.googleapis.com \
  firebasehosting.googleapis.com \
  firebasestorage.googleapis.com \
  cloudfunctions.googleapis.com \
  eventarc.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com
```

Set local shell variables as needed:

```bash
export PROJECT_ID="your-project-id"
export REGION="us-central1"
export STORAGE_BUCKET="your-storage-bucket"
export ARTIFACT_REPO="smart-job"
export PDF_SERVICE="pdf-service"
export ARCHIVER_JOB="smart-job-archiver"
```

PowerShell:

```powershell
$env:PROJECT_ID = "your-project-id"
$env:REGION = "us-central1"
$env:STORAGE_BUCKET = "your-storage-bucket"
$env:ARTIFACT_REPO = "smart-job"
$env:PDF_SERVICE = "pdf-service"
$env:ARCHIVER_JOB = "smart-job-archiver"
```

## 4. Install Dependencies

There is no root package-manager workspace. Install packages individually:

```bash
npm --prefix packages/contracts install
npm --prefix packages/db install
npm --prefix packages/contracts run build
npm --prefix packages/db run build
npm --prefix website install
npm --prefix phone_app install
npm --prefix cloudrun-pdf install
npm --prefix cloudrun-archiver install
```

Apply SQL migrations for the target database:

```bash
npm --prefix packages/db run db:migrate
```

## 5. Website Environment

Create `website/.env.local` and configure:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ALLOW_FIREBASE_AUTH_FALLBACK=false

SESSION_COOKIE_SECRET=
WEBSITE_SESSION_SECRET=

BACKEND_PROJECT_ID=
BACKEND_EDGE_FUNCTIONS_BASE_URL=

NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON=
FIREBASE_ADMIN_PROJECT_ID=
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY=

NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY=
CLOUDRUN_PDF_URL=
```

Notes:

- Supabase variables are required for active web auth.
- `SESSION_COOKIE_SECRET` must be a strong shared secret per environment.
- `BACKEND_EDGE_FUNCTIONS_BASE_URL` is the explicit website proxy override.
- If `BACKEND_EDGE_FUNCTIONS_BASE_URL` is not set, the website falls back to `${SUPABASE_URL || NEXT_PUBLIC_SUPABASE_URL}/functions/v1`.
- Website auth transport avoids storing refresh tokens durably in `localStorage`; session continuity should rely on active bearer/session flows.
- Firebase web/admin vars are still required where Firebase services remain in use.

## 6. Mobile Environment And Native Files

The mobile app still requires Firebase native app registration for the installed services it uses.

Place these files in `phone_app/`:

- `google-services.json`
- `GoogleService-Info.plist`

Configure mobile envs as needed:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=

EXPO_PUBLIC_EDGE_FUNCTIONS_BASE_URL=
```

Notes:

- Registration and onboarding remain website-only.
- If `EXPO_PUBLIC_EDGE_FUNCTIONS_BASE_URL` is empty, the app uses `${EXPO_PUBLIC_SUPABASE_URL}/functions/v1`.

## 7. Supabase Edge Environment

Create `supabase/.env` (or configure Supabase secrets) for local development and deployment configuration:

```dotenv
CORS_ALLOWED_ORIGINS=http://localhost:3000,https://your-website.example

SMART_JOB_PERSISTENCE_BACKEND=sql
DATABASE_URL=
DATABASE_SSL_MODE=disable
DATABASE_SSL_REJECT_UNAUTHORIZED=true
DATABASE_SSL_CA=
DATABASE_MAX_CONNECTIONS=10
DATABASE_CONNECT_TIMEOUT_MS=10000
DATABASE_IDLE_TIMEOUT_MS=30000

SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ALLOW_FIREBASE_AUTH_FALLBACK=false
GCP_SERVICE_ACCOUNT_EMAIL=
GCP_SERVICE_ACCOUNT_PRIVATE_KEY=
PUBSUB_VERIFICATION_TOKEN=
CLOUD_RUN_PDF_SERVICE_URL=

TAX_AUTH_URL=
TAX_TOKEN_URL=
TAX_APPROVAL_URL=
TAX_CLIENT_ID=
TAX_CLIENT_SECRET=
TAX_SCOPE=
TAX_CALLBACK_URL=
APP_SCHEME=erpsystem
```

Rules:

- Set `SMART_JOB_PERSISTENCE_BACKEND=sql` explicitly in real environments.
- Do not rely on implicit SQL enablement when database settings are present.
- Keep CORS origins aligned with website domains and local dev origins.
- Do not use `*` for CORS when sending credentials; use explicit origins in `CORS_ALLOWED_ORIGINS`.
- Keep `CORS_ALLOWED_ORIGINS` non-empty in real environments. Empty origin lists are treated as fail-closed.
- Supabase variables are required because backend HTTP auth verification and gateway routing are Supabase-based.
- Keep `ALLOW_FIREBASE_AUTH_FALLBACK=false` unless a controlled compatibility incident requires temporary fallback.
- `GCP_SERVICE_ACCOUNT_EMAIL` / `GCP_SERVICE_ACCOUNT_PRIVATE_KEY` allow edge handlers to mint OIDC tokens for trusted `cloudrun-pdf` dispatch.
- `PUBSUB_VERIFICATION_TOKEN` should match the shared verification token expected by `cloudrun-pdf` when that hardening layer is enabled.
- `CLOUD_RUN_PDF_SERVICE_URL` is required for preview/generate task dispatch from the edge runtime.

## 8. SQL Setup

`packages/db` is the canonical SQL schema and migration surface.

Current migration tip:
- Ensure migration `0010_fixes.sql` is applied. This migration adds:
  - `document_number` immutability trigger
  - `document_tasks` and `support_conversations` RLS fixes
  - `contact_requests.subject` column
  - `upgrade_requests.company_id` → UUID
  - `document_tasks` unique index on `(company_id, task_type, document_id)`
  - `part_no` counter key
  - `allocate_company_counter`, `allocate_system_counter`, and `increment_rate_limit_bucket` RPCs

Minimum steps:

1. Provision PostgreSQL.
2. Set `DATABASE_URL` for backend services.
3. Run migrations from `packages/db`.
4. Verify backend services can connect before deploying Supabase Edge Functions or Cloud Run.

Do not add direct client SQL access for protected ERP operations.

## 9. Local Development

Common commands:

```bash
npm --prefix website run dev
npm --prefix website run typecheck
npm --prefix website run test

npm --prefix phone_app run start
npm --prefix phone_app run typecheck
npm --prefix phone_app run test
```

If you use emulators, keep local website origins in `CORS_ALLOWED_ORIGINS` and point client envs to emulator origins explicitly.

## 10. Cloud Run PDF Service

`cloudrun-pdf/` is responsible for preview and generate flows.

Required deployment concerns:

- OIDC verification for Pub/Sub push requests
- optional shared `x-pubsub-token` hardening if configured
- SQL access for task and document finalization in SQL mode
- Cloud Storage write permissions
- environment for tax and document generation as required by the service
- trusted invocations from `supabase/functions/` for preview/generate task dispatch

Preserve these invariants:

- create-only semantics for new generated PDFs and documents
- orphan file cleanup when finalize fails
- canonical `storagePath` persistence instead of durable URLs

## 11. Cloud Run Archiver

`cloudrun-archiver/` is the monthly archive job.

Required deployment concerns:

- access to source data
- Cloud Storage archive bucket access
- scheduler or manual job trigger
- checksum verification before delete

Preserve these invariants:

- archive manifests are idempotent
- date filtering respects ISO-string date storage
- deletion uses only the exact IDs captured in the verified archive

## 12. Supabase Migration Workspace

The `supabase/` directory contains the in-repo backend runtime and migration hardening work.

Use these docs when working there:

- `SUPABASE-MIGRATION-GUIDE.md`
- `supabase/README.md`

If you still operate legacy Firebase backend paths outside this repository, keep rollback paths available until your production rollout is fully complete.

## 13. Deployment Order

Recommended high-level order:

1. Provision Firebase, GCP APIs, PostgreSQL, and Supabase.
2. Apply SQL migrations.
3. Configure website and Supabase edge secrets and envs.
4. Deploy `supabase/functions`.
5. Deploy `cloudrun-pdf`.
6. Deploy `cloudrun-archiver`.
7. Configure website hosting.
8. Build and release mobile apps.
9. Validate website auth, mobile auth, backend operations, document generation, and archives.

CI/CD evidence:

- Use `.github/workflows/supabase-edge-deploy.yml` for manual Supabase Edge deployments.
- Required repository secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`.

## 14. Post-Setup Checks

Verify:

- website login, registration, and onboarding
- mobile sign-in and protected operation routing
- backend SQL connectivity
- document preview and generate flows
- tax invoice approval creates a draft SQL document and schedules the async generate task
- signed URL flows for documents and job files
- push-token updates and notification paths
- archive creation and retrieval

## 15. Canonical Documentation Rule

If setup or deployment guidance changes, update this file instead of creating another setup-only markdown file.
