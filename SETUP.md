# Smart-Job ERP Full Setup Guide

This is the single setup guide for a new Smart-Job ERP environment. It replaces the old split guides for Cloud Run archiving, Pub/Sub PDF generation, push notifications, and PDF email delivery.

The starting point is an empty Firebase/GCP project. The target end state is:

- Firebase Auth, Firestore, Storage, rules, indexes, TTL policies, and Cloud Functions are deployed.
- Optional PostgreSQL persistence can be enabled for the SQL-first migration work under `packages/db`.
- The Next.js website can register and onboard users.
- The Expo mobile app can sign in existing users and receive push notifications.
- Cloud Run PDF generation receives Pub/Sub tasks from Functions.
- Optional Amazon SES email delivery works for generated documents.
- Cloud Run archiving runs monthly and archives old finished jobs/documents.
- First manager, solo, worker, and basic users can use the app.

## 1. Repository Roles

```text
ERP-System/
|-- phone_app/           Expo + React Native mobile app. Login and app usage only.
|-- website/             Next.js website. Registration, onboarding, dashboard, admin flows.
|-- functions/           Firebase Cloud Functions. Protected mutations and backend trust boundary.
|-- cloudrun-pdf/        Cloud Run service for PDF preview/generation and optional email delivery.
|-- cloudrun-archiver/   Cloud Run Job for monthly Firestore-to-Storage archives.
|-- packages/contracts/  Shared enums, path helpers, account/tier semantics.
|-- packages/db/         Shared PostgreSQL schema, Drizzle config, migrations, and SQL access helpers.
|-- firebase.json        Firebase deploy and emulator config.
|-- firestore.rules      Firestore access policy.
|-- storage.rules        Storage access policy.
`-- firestore.indexes.json Firestore composite indexes and TTL field policies.
```

Core architecture rules to preserve:

- Mobile business registration must not be reintroduced.
- Canonical stored account types are only `solo` and `business`.
- `uid` is identity. `companyId` is tenant scope.
- Protected collections (`clients`, `jobs`, `documents`, `invites`, `workers`) are mutated through Cloud Functions, not direct client writes.
- Company document/job/archive Storage reads are backend-controlled.
- Job/document file records store canonical `storagePath`, not durable download URLs.

## 2. Prerequisites

Install these locally:

- Node.js 22 LTS.
- npm.
- Firebase CLI: `npm install -g firebase-tools`.
- Google Cloud CLI: https://cloud.google.com/sdk/docs/install.
- Java 17+ for Firebase emulators.
- Docker or Cloud Build access for Cloud Run images.
- Expo/EAS CLI for mobile builds: `npm install -g eas-cli`.
- Apple Developer account and Google Play access for production mobile builds.
- AWS account only if you want SES email delivery from the PDF service.

Authenticate:

```bash
firebase login
gcloud auth login
gcloud auth application-default login
```

Set local variables for commands in this guide:

```bash
export PROJECT_ID="your-firebase-project-id"
export REGION="us-central1"
export ARTIFACT_REPO="smart-job"
export PDF_SERVICE="pdf-service"
export ARCHIVER_JOB="smart-job-archiver"
export STORAGE_BUCKET="your-firebase-storage-bucket"
```

On PowerShell:

```powershell
$env:PROJECT_ID = "your-firebase-project-id"
$env:REGION = "us-central1"
$env:ARTIFACT_REPO = "smart-job"
$env:PDF_SERVICE = "pdf-service"
$env:ARCHIVER_JOB = "smart-job-archiver"
$env:STORAGE_BUCKET = "your-firebase-storage-bucket"
```

Use the Firebase Storage bucket name shown in Firebase Console. Newer projects often use `<project-id>.firebasestorage.app`; older projects may use `<project-id>.appspot.com`.

## 3. Create The Firebase/GCP Project

1. Create a Firebase project in Firebase Console.
2. Upgrade to the Blaze plan. Cloud Functions, Cloud Run, Cloud Scheduler, Pub/Sub, Artifact Registry, and some Storage usage require billing.
3. Add a Cloud Firestore database in production mode.
4. Add Firebase Storage.
5. Enable Authentication and add the Email/Password sign-in provider.
6. Enable Cloud Messaging.
7. In Google Cloud Console, enable these APIs:

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
  iamcredentials.googleapis.com \
  --project "$PROJECT_ID"
```

Point the repo at the new project:

```bash
firebase use --add
firebase use "$PROJECT_ID"
gcloud config set project "$PROJECT_ID"
gcloud config set run/region "$REGION"
```

Do not commit project-specific credentials or downloaded Firebase app config files.

## 4. Install Dependencies

There is no root package manager workspace file today. Install each app/service separately:

```bash
cd packages/contracts
npm install

cd ../db
npm install

cd ../../functions
npm install

cd ../website
npm install

cd ../phone_app
npm install

cd ../cloudrun-pdf
npm install

cd ../cloudrun-archiver
npm install
```

If you are enabling SQL persistence locally, apply the shared schema after installing the DB package:

```bash
cd packages/db
npm run db:migrate
```

## 5. Firebase Web App Configuration

In Firebase Console:

1. Add a Web app.
2. Copy the Firebase Web SDK config.
3. Create `website/.env.local` from `website/.env.local.example`.
4. Fill:

```dotenv
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY=

NEXT_PUBLIC_USE_FIREBASE_EMULATOR=false
NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST=127.0.0.1:8080

FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON=
FIREBASE_ADMIN_PROJECT_ID=
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY=

FIREBASE_FUNCTIONS_REGION=us-central1
FIREBASE_FUNCTIONS_BASE_URL=
FIREBASE_FUNCTIONS_EMULATOR_ORIGIN=http://127.0.0.1:5001
FIRESTORE_EMULATOR_HOST=
CLOUDRUN_PDF_URL=
```

Use either `FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON` or the split Admin SDK values. For production hosting, set these variables in the hosting provider, not in git.

`FIREBASE_FUNCTIONS_BASE_URL` is optional in production because the website can derive the standard Cloud Functions URL from project and region. Use it only for nonstandard routing or emulator/proxy setups.

## 6. Firebase Native App Configuration

In Firebase Console:

1. Add an Android app.
   - Package name: check `phone_app/app.json`; current package is `erpsystem.app`.
   - Download `google-services.json`.
   - Place it at `phone_app/google-services.json`.
2. Add an iOS app.
   - Bundle identifier: check `phone_app/app.json`; current bundle identifier is `erpsystem.app`.
   - Download `GoogleService-Info.plist`.
   - Place it at `phone_app/GoogleService-Info.plist`.
3. Keep the Expo scheme as `erpsystem` unless you intentionally change deep-link handling.

Optional mobile environment variables:

```dotenv
EXPO_PUBLIC_FUNCTIONS_REGION=us-central1
EXPO_PUBLIC_FUNCTIONS_BASE_URL=
EXPO_PUBLIC_FUNCTIONS_EMULATOR_ORIGIN=
```

For normal production Firebase callable functions, leave `EXPO_PUBLIC_FUNCTIONS_BASE_URL` empty.

## 7. Functions Environment

Create `functions/.env` for local and Firebase deploy-time environment variables. Do not commit it.

```dotenv
CORS_ALLOWED_ORIGINS=http://localhost:3000,https://your-website.example

SMART_JOB_PERSISTENCE_BACKEND=firestore
DATABASE_URL=
DATABASE_SSL_MODE=disable
DATABASE_MAX_CONNECTIONS=10
DATABASE_CONNECT_TIMEOUT_MS=10000
DATABASE_IDLE_TIMEOUT_MS=30000

TAX_AUTH_URL=
TAX_TOKEN_URL=
TAX_APPROVAL_URL=
TAX_CLIENT_ID=
TAX_CLIENT_SECRET=
TAX_SCOPE=scope
TAX_CALLBACK_URL=
APP_SCHEME=erpsystem
```

Notes:

- `CORS_ALLOWED_ORIGINS` must include local development and every deployed website origin that calls HTTP Functions.
- Leave `SMART_JOB_PERSISTENCE_BACKEND=firestore` unless you are actively validating the SQL migration path. Setting it to `sql` requires a working PostgreSQL database and applied migrations.
- `DATABASE_URL` may also be provided as `SMART_JOB_DATABASE_URL`. The backend auto-selects SQL mode when a database URL is present unless the persistence backend is explicitly forced to `firestore`.
- Tax variables are required only for the Tax Authority OAuth/invoice approval flow.
- Cloud Functions use Node 22.
- HTTP Functions intentionally do not rely on direct browser App Check for trusted website server-proxy flows. Preserve the bearer-token checks in code.

Deploy rules, indexes, and Functions:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage

cd functions
npm test
firebase deploy --only functions
```

Firestore TTL policies are declared in `firestore.indexes.json` for:

- `notificationLog.expireAt`
- `documentTasks.expireAt`
- `rate_limits.expireAt`
- `contact_requests.expireAt`
- `taxAuthPending.expireAt`
- `taxAuthCallbacks.expireAt`
- `tax_invoice_idempotency.expireAt`

After the first deploy, confirm the TTL policies are active in Google Cloud Console under Firestore TTL. TTL activation can take time.

## 8. Artifact Registry

Create one Docker repository for Cloud Run images:

```bash
gcloud artifacts repositories create "$ARTIFACT_REPO" \
  --repository-format=docker \
  --location="$REGION" \
  --project="$PROJECT_ID"
```

If the repository already exists, keep using it.

## 9. Pub/Sub PDF Generation

The document flow is:

1. Website/mobile calls `publishPreviewTask` or `publishGenerateTask`.
2. Cloud Functions creates `documentTasks/{taskId}`.
3. Cloud Functions publishes to Pub/Sub topic `document-preview` or `document-generate`.
4. Pub/Sub pushes to Cloud Run PDF service endpoints `/preview` and `/generate`.
5. Cloud Run verifies OIDC identity, resolves requester authority from Firestore, generates PDF, stores the PDF, and updates `documentTasks`.
6. Functions trigger `onTaskCompleted` clears busy flags and completes client-visible task state.

Create topics:

```bash
gcloud pubsub topics create document-preview --project "$PROJECT_ID"
gcloud pubsub topics create document-generate --project "$PROJECT_ID"
```

Create service accounts:

```bash
gcloud iam service-accounts create pdf-service-run \
  --display-name="Smart Job PDF Cloud Run runtime" \
  --project "$PROJECT_ID"

gcloud iam service-accounts create pubsub-pdf-push \
  --display-name="Pub/Sub push identity for PDF service" \
  --project "$PROJECT_ID"
```

Grant runtime access:

```bash
export PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
export PDF_RUN_SA="pdf-service-run@$PROJECT_ID.iam.gserviceaccount.com"
export PUBSUB_PUSH_SA="pubsub-pdf-push@$PROJECT_ID.iam.gserviceaccount.com"
export FUNCTIONS_RUNTIME_SA="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$PDF_RUN_SA" \
  --role="roles/datastore.user"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$PDF_RUN_SA" \
  --role="roles/storage.objectAdmin"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$FUNCTIONS_RUNTIME_SA" \
  --role="roles/pubsub.publisher"
```

Build and deploy the PDF service the first time:

```bash
cd cloudrun-pdf
gcloud builds submit \
  --tag "$REGION-docker.pkg.dev/$PROJECT_ID/$ARTIFACT_REPO/$PDF_SERVICE:latest" \
  --project "$PROJECT_ID"

gcloud run deploy "$PDF_SERVICE" \
  --image "$REGION-docker.pkg.dev/$PROJECT_ID/$ARTIFACT_REPO/$PDF_SERVICE:latest" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --service-account "$PDF_RUN_SA" \
  --memory 1Gi \
  --cpu 1 \
  --timeout 300 \
  --concurrency 4 \
  --no-allow-unauthenticated \
  --set-env-vars "STORAGE_BUCKET=$STORAGE_BUCKET,PUBSUB_ALLOWED_SERVICE_ACCOUNTS=$PUBSUB_PUSH_SA"
```

Fetch the service URL and set it as the OIDC audience expected by the service:

```bash
export PDF_URL="$(gcloud run services describe "$PDF_SERVICE" --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)')"

gcloud run services update "$PDF_SERVICE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --set-env-vars "CLOUD_RUN_SERVICE_URL=$PDF_URL,STORAGE_BUCKET=$STORAGE_BUCKET,PUBSUB_ALLOWED_SERVICE_ACCOUNTS=$PUBSUB_PUSH_SA"
```

Grant Pub/Sub push identity permission to invoke the private Cloud Run service:

```bash
gcloud run services add-iam-policy-binding "$PDF_SERVICE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --member="serviceAccount:$PUBSUB_PUSH_SA" \
  --role="roles/run.invoker"
```

Create push subscriptions:

```bash
gcloud pubsub subscriptions create document-preview-push \
  --topic document-preview \
  --push-endpoint "$PDF_URL/preview" \
  --push-auth-service-account "$PUBSUB_PUSH_SA" \
  --push-auth-token-audience "$PDF_URL" \
  --ack-deadline 300 \
  --message-retention-duration 10m \
  --min-retry-delay 10s \
  --max-retry-delay 600s \
  --project "$PROJECT_ID"

gcloud pubsub subscriptions create document-generate-push \
  --topic document-generate \
  --push-endpoint "$PDF_URL/generate" \
  --push-auth-service-account "$PUBSUB_PUSH_SA" \
  --push-auth-token-audience "$PDF_URL" \
  --ack-deadline 300 \
  --message-retention-duration 10m \
  --min-retry-delay 10s \
  --max-retry-delay 600s \
  --project "$PROJECT_ID"
```

Important Pub/Sub auth note:

- The service supports OIDC verification using `CLOUD_RUN_SERVICE_URL` and `PUBSUB_ALLOWED_SERVICE_ACCOUNTS`.
- `PUBSUB_VERIFICATION_TOKEN` is optional and, if configured, requires an `x-pubsub-token` header in addition to OIDC.
- Standard Pub/Sub push subscriptions do not add custom `x-pubsub-token` headers. For normal Pub/Sub push, leave `PUBSUB_VERIFICATION_TOKEN` unset and rely on private Cloud Run plus OIDC push auth.

Useful PDF service variables:

```dotenv
STORAGE_BUCKET=your-firebase-storage-bucket
CLOUD_RUN_SERVICE_URL=https://pdf-service-...a.run.app
PUBSUB_ALLOWED_SERVICE_ACCOUNTS=pubsub-pdf-push@your-project.iam.gserviceaccount.com
JSON_BODY_LIMIT=10mb
DOCUMENT_TASK_PROCESSING_STALE_AFTER_MS=900000
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
```

## 10. Optional PDF Email Delivery With Amazon SES

The PDF service sends email through Amazon SES when a generated document has a client email.

In AWS SES:

1. Verify a sender email or domain.
2. Add DKIM records if verifying a domain.
3. Start in SES sandbox for testing.
4. Request production access before emailing real customers.
5. Create an IAM user or role with the minimum SES send permissions you need.

Set Cloud Run environment variables:

```bash
gcloud run services update "$PDF_SERVICE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --set-env-vars "AWS_REGION=eu-west-1,AWS_ACCESS_KEY_ID=your-access-key,AWS_SECRET_ACCESS_KEY=your-secret"
```

Prefer Secret Manager for real production secrets:

```bash
printf "your-access-key" | gcloud secrets create aws-ses-access-key --data-file=- --project "$PROJECT_ID"
printf "your-secret" | gcloud secrets create aws-ses-secret-key --data-file=- --project "$PROJECT_ID"

gcloud secrets add-iam-policy-binding aws-ses-access-key \
  --member="serviceAccount:$PDF_RUN_SA" \
  --role="roles/secretmanager.secretAccessor" \
  --project "$PROJECT_ID"

gcloud secrets add-iam-policy-binding aws-ses-secret-key \
  --member="serviceAccount:$PDF_RUN_SA" \
  --role="roles/secretmanager.secretAccessor" \
  --project "$PROJECT_ID"

gcloud run services update "$PDF_SERVICE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --set-env-vars "AWS_REGION=eu-west-1" \
  --set-secrets "AWS_ACCESS_KEY_ID=aws-ses-access-key:latest,AWS_SECRET_ACCESS_KEY=aws-ses-secret-key:latest"
```

Email is best-effort. A PDF can still be generated successfully when email delivery fails; the generated document records email status fields.

## 11. Cloud Run Archiver

The archiver is a Cloud Run Job. It archives finished jobs and documents older than six months into monthly JSON files:

```text
gs://<bucket>/companies/{companyId}/archives/{YYYY}-{M}-j.json
gs://<bucket>/companies/{companyId}/archives/{YYYY}-{M}-d.json
gs://<bucket>/companies/{companyId}/archives/manifest.json
```

It is idempotent through the manifest, uploads before deleting, verifies archive metadata/checksums, and deletes only the exact Firestore document IDs captured in the verified archive.

Create the runtime service account:

```bash
gcloud iam service-accounts create archiver-run \
  --display-name="Smart Job archiver runtime" \
  --project "$PROJECT_ID"

export ARCHIVER_RUN_SA="archiver-run@$PROJECT_ID.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$ARCHIVER_RUN_SA" \
  --role="roles/datastore.user"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$ARCHIVER_RUN_SA" \
  --role="roles/storage.objectAdmin"
```

Build and deploy:

```bash
cd cloudrun-archiver
gcloud builds submit \
  --tag "$REGION-docker.pkg.dev/$PROJECT_ID/$ARTIFACT_REPO/$ARCHIVER_JOB:latest" \
  --project "$PROJECT_ID"

gcloud run jobs create "$ARCHIVER_JOB" \
  --image "$REGION-docker.pkg.dev/$PROJECT_ID/$ARTIFACT_REPO/$ARCHIVER_JOB:latest" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --service-account "$ARCHIVER_RUN_SA" \
  --memory 512Mi \
  --cpu 1 \
  --task-timeout 3600 \
  --set-env-vars "ARCHIVE_BUCKET=$STORAGE_BUCKET"
```

If the job already exists:

```bash
gcloud run jobs update "$ARCHIVER_JOB" \
  --image "$REGION-docker.pkg.dev/$PROJECT_ID/$ARTIFACT_REPO/$ARCHIVER_JOB:latest" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --service-account "$ARCHIVER_RUN_SA" \
  --set-env-vars "ARCHIVE_BUCKET=$STORAGE_BUCKET"
```

Run manually:

```bash
gcloud run jobs execute "$ARCHIVER_JOB" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --wait
```

Create a Scheduler identity:

```bash
gcloud iam service-accounts create scheduler-archiver \
  --display-name="Scheduler identity for Smart Job archiver" \
  --project "$PROJECT_ID"

export SCHEDULER_SA="scheduler-archiver@$PROJECT_ID.iam.gserviceaccount.com"
```

Grant Scheduler permission to run the job. Cloud Run Jobs execution uses the Run Admin API, so this service account needs permission to invoke the job endpoint. Use the narrowest custom role your organization supports; `roles/run.developer` is the practical managed-role baseline:

```bash
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SCHEDULER_SA" \
  --role="roles/run.developer"
```

Create the monthly Scheduler job:

```bash
export RUN_JOB_URI="https://$REGION-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$PROJECT_ID/jobs/$ARCHIVER_JOB:run"

gcloud scheduler jobs create http smart-job-archiver-monthly \
  --location "$REGION" \
  --schedule "0 3 1 * *" \
  --time-zone "UTC" \
  --uri "$RUN_JOB_URI" \
  --http-method POST \
  --oauth-service-account-email "$SCHEDULER_SA" \
  --project "$PROJECT_ID"
```

Monitor:

```bash
gcloud run jobs executions list --job "$ARCHIVER_JOB" --region "$REGION" --project "$PROJECT_ID"
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="smart-job-archiver"' --limit 50 --project "$PROJECT_ID"
```

## 12. Push Notifications

The app uses Firebase Cloud Messaging and Notifee.

Firebase Console:

1. Enable Cloud Messaging.
2. Confirm Android and iOS apps are registered.
3. For iOS, upload an APNs authentication key:
   - Apple Developer portal -> Certificates, Identifiers & Profiles -> Keys.
   - Create a key with Apple Push Notifications service enabled.
   - Download the `.p8` key once.
   - Upload it in Firebase Console -> Project settings -> Cloud Messaging.
   - Enter Team ID and Key ID.

Mobile app:

1. Keep `phone_app/google-services.json` and `phone_app/GoogleService-Info.plist` in place locally/CI secrets.
2. Build a development client or production build; Expo Go is not enough for native FCM/Notifee.
3. Sign in on a physical device.
4. Accept notification permission.
5. Confirm the profile stores push-token data under `users/{uid}/data/profile`.

Useful commands:

```bash
cd phone_app
npx expo start --dev-client
eas build --platform android --profile development
eas build --platform ios --profile development
```

Expected behavior:

- Token registration goes through backend profile functions.
- Job notification triggers claim `notificationLog/{jobId}_{type}` idempotency docs before sending.
- Token cleanup should call the backend clear-token flow during sign-out or token invalidation.

## 13. Website Deployment

Local development:

```bash
cd website
npm run dev
```

Production:

1. Deploy `website/` to your hosting platform, such as Vercel.
2. Set every environment variable from `website/.env.local.example`.
3. Set Admin SDK credentials as environment variables, not files.
4. Add the production domain to `CORS_ALLOWED_ORIGINS` in `functions/.env`, then redeploy Functions.
5. Ensure the Firebase Auth authorized domains include your website domain.

Required website flows:

- `/register` creates Firebase Auth credentials only.
- `/onboarding` calls backend provisioning:
  - manager/business -> `registerBusinessV1`
  - solo/user -> `registerBusinessV1`
  - basic workspace -> `registerBusinessV1` with `accountType: solo`, `role: basic`
  - worker invite -> `/api/onboarding/join-company` -> `joinCompanyV1`

Do not add registration/onboarding to the mobile app.

## 14. Mobile Deployment

Local development:

```bash
cd phone_app
npx expo start --dev-client
```

Production builds:

```bash
cd phone_app
eas build --platform android --profile production
eas build --platform ios --profile production
```

Before release:

- Confirm native Firebase files match the Firebase project.
- Confirm bundle/package IDs in `phone_app/app.json`.
- Confirm FCM works on physical Android and iOS devices.
- Confirm function region/base URL envs are empty or correct.
- Confirm signed document/job-file access works through backend functions.

## 15. First Production Users

Use the website for initial account creation.

1. Visit the deployed website.
2. Create a manager account at `/register`.
3. Complete `/onboarding` as a business manager.
4. Confirm Firestore has:

```text
users/{uid}/data/profile
users/{uid}/data/cache
users/{uid}/data/inventory
companies/{companyId}/data/business_info
companies/{companyId}/data/subscription
companies/{companyId}/managers/{mid}
companies/{companyId}/counters/{wnext|mnext|cnext|jnext}
```

5. Sign in to the mobile app with the same account.
6. Create a client through the app or website.
7. Create a job through the app or website.
8. Generate a document preview.
9. Generate and save a document.
10. Confirm the document record stores `storagePath`.
11. Confirm the PDF object exists under the company Storage path.
12. Confirm direct client reads from company document/job/archive Storage paths are rejected by Storage rules.
13. Create a worker invite from the manager account.
14. Register a second user on the website and join by invite.
15. Sign in as the worker on mobile and verify assigned jobs load.

For solo/basic workspaces:

1. Register a new user on the website.
2. Choose Solo or Basic during onboarding.
3. Confirm stored `accountType` is `solo`.
4. Confirm role is `user` for Solo or `basic` for Basic.
5. Confirm mobile login works after onboarding.

## 16. Local Emulator Workflow

Start emulators:

```bash
firebase emulators:start --only functions,firestore,storage
```

Website emulator env:

```dotenv
NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true
NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
FIREBASE_FUNCTIONS_EMULATOR_ORIGIN=http://127.0.0.1:5001
```

Functions and rules tests already use the demo project where appropriate:

```bash
cd functions
npm test
```

## 17. Verification Checklist

Run these before shipping a new environment or major change:

```bash
node scripts/check-no-ts-nocheck.mjs

cd website
npm test
npm run typecheck
npm run lint
npm run build

cd ../phone_app
npm test
npm run typecheck

cd ../functions
npm test

cd ../cloudrun-pdf
npm test

cd ../cloudrun-archiver
npm test
```

Production smoke tests:

- Website register/login/onboarding.
- Website dashboard route protection.
- Mobile login.
- Manager creates worker invite.
- Worker joins company.
- Client mutation through backend function.
- Job create/update/delete through backend functions.
- Job photo/signature upload stores `storagePath`.
- Document preview task reaches `documentTasks/{taskId}` and completes.
- Document generate task stores PDF and document metadata.
- Signed document URL works and expires.
- Signed job-file URL works and expires.
- Direct protected Firestore writes are denied from a client.
- Direct company Storage reads are denied from a client.
- Push notification arrives on physical device.
- Archiver manual run succeeds in an empty or low-data project.

## 18. Troubleshooting

PDF task stays `queued`:

- Confirm Pub/Sub topics exist.
- Confirm push subscriptions point to `$PDF_URL/preview` and `$PDF_URL/generate`.
- Confirm the PDF service has `CLOUD_RUN_SERVICE_URL=$PDF_URL`.
- Confirm `PUBSUB_ALLOWED_SERVICE_ACCOUNTS` exactly matches the push service account email.
- Confirm the push service account has `roles/run.invoker` on the service.
- Confirm `PUBSUB_VERIFICATION_TOKEN` is unset unless a proxy adds `x-pubsub-token`.

PDF task fails with authorization errors:

- Confirm the task payload has `uid` and `companyId`.
- Confirm `users/{uid}/data/profile` exists and belongs to the company.
- Confirm manager/worker role membership docs exist.

Functions CORS fails:

- Add the exact website origin to `CORS_ALLOWED_ORIGINS`.
- Redeploy Functions.
- Include protocol and no trailing slash, for example `https://app.example.com`.

Website middleware redirects unexpectedly:

- Confirm `/api/auth/session` can verify the Firebase ID token.
- Confirm Admin SDK env vars are available in production.
- Confirm `__session` is HttpOnly and Secure in production.

Push notifications do not arrive:

- Use a physical device and a dev/prod build, not Expo Go.
- Confirm Android/iOS Firebase config files match the Firebase project.
- Confirm APNs key is uploaded for iOS.
- Confirm notification permission was granted.
- Confirm push token exists under `users/{uid}/data/profile`.

Archiver fails immediately:

- Confirm `ARCHIVE_BUCKET` is set.
- Confirm the archiver service account can read Firestore and write Storage.
- Confirm `companies` collection exists. In an empty project, a no-company run exits successfully.

## 19. Operational Notes

- Keep `firestore.rules`, `storage.rules`, and `firestore.indexes.json` deployed together.
- Treat `packages/contracts` as the shared source for enums and path helpers.
- Keep Cloud Run runtime service accounts separate from Pub/Sub/Scheduler identities.
- Prefer Secret Manager for production secrets.
- Do not store durable Firebase Storage download URLs in Firestore records.
- Use backend-issued signed URLs for company documents, job files, and archives.
- Preserve idempotency docs and TTL fields when changing document, tax, notification, and rate-limit flows.
