# Smart-Job email worker

Private Cloud Run Pub/Sub push worker for durable generated-document delivery.
Pub/Sub messages contain only `deliveryId`; the worker claims canonical tenant,
document, recipient, and storage state through lease-token SQL RPCs owned by the
least-privilege `smart_job_email` login role.

Required environment:

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
retry can send again.
