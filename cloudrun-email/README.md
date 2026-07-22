# Smart-Job email worker

Private Cloud Run Pub/Sub push worker for durable generated-document delivery.
Pub/Sub messages contain only `deliveryId`; the worker claims canonical tenant,
document, recipient, and storage state through lease-token SQL RPCs owned by the
least-privilege `smart_job_email` login role.

Copy [`.env.example`](./.env.example) and inject real values out of band.
Required production environment:

```text
DATABASE_URL=postgresql://smart_job_email:...@.../postgres
DATABASE_SSL_MODE=require
CLOUD_RUN_SERVICE_URL=https://...
PUBSUB_ALLOWED_SERVICE_ACCOUNTS=...@....gserviceaccount.com
SUPABASE_URL=https://....supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_STORAGE_BUCKET=smart-job-company-files
AWS_REGION=eu-central-1
SES_FROM_EMAIL=documents@example.com
SES_FROM_NAME=Smart-Job
```

Credentials and secret values are populated out of band. The service never
logs recipient addresses or database/storage credentials. A timeout without a
definitive SES rejection becomes `delivery_unknown`; only an authorized manual
retry can send again. Follow
[`../docs/runbooks/EMAIL_DELIVERY_UNKNOWN.md`](../docs/runbooks/EMAIL_DELIVERY_UNKNOWN.md)
before any resend decision.

Build the shared contracts package first, then run:

```bash
npm --prefix cloudrun-email run typecheck
npm --prefix cloudrun-email run test
```

For local full-stack development, `compose.local.yml` injects a marker-gated
SES endpoint and non-production AWS credentials. The repository adapter
translates the signed SES Query request to Mailpit at
`http://127.0.0.1:58025`; no AWS request leaves the machine. The internal
Supabase origin is used for signing, while returned links are rewritten to the
public loopback origin. Emulator endpoints are rejected without the mounted
local-platform marker.
