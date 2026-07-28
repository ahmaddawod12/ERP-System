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
GCS_PROJECT_ID=smart-job-production
COMPANY_FILES_BUCKET=<globally-unique-private-bucket>
AWS_REGION=eu-central-1
AWS_SES_CREDENTIAL_MODE=static
AWS_ACCESS_KEY_ID=<Secret Manager reference>
AWS_SECRET_ACCESS_KEY=<Secret Manager reference>
SES_FROM_EMAIL=documents@example.com
SES_FROM_NAME=Smart-Job
```

The immediate production deployment injects the complete AWS credential pair
from Secret Manager. Both variables must be present together. After the
dedicated [`../infra/aws/ses-federation`](../infra/aws/ses-federation) stack
and staging tests pass, set `AWS_SES_CREDENTIAL_MODE=federated`,
`AWS_SES_ROLE_ARN`, `AWS_SES_OIDC_AUDIENCE`, and
`AWS_GOOGLE_SERVICE_ACCOUNT_UNIQUE_ID`. Federated mode rejects static keys,
fetches a Google-signed identity token from the Cloud Run metadata server,
exchanges it through AWS STS, and caches temporary credentials only in memory.
`AWS_SES_ENDPOINT`, `GCS_API_ENDPOINT`, and
`COMPANY_FILES_PUBLIC_BASE_URL` remain local-emulator settings and
are rejected outside the marker-verified local platform.

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

Federation follows the official
[Google service-account ID token claims](https://cloud.google.com/docs/authentication/token-types#service_account_id_tokens),
[Cloud Run metadata identity endpoint](https://docs.cloud.google.com/run/docs/securing/service-identity#fetch_tokens),
and [AWS web-identity credential](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-credential-providers.html#web-identity-federation-credentials)
models.

For local full-stack development, `compose.local.yml` injects a marker-gated
SES endpoint and non-production AWS credentials. The repository adapter
translates the signed SES Query request to Mailpit at
`http://127.0.0.1:58025`; no AWS request leaves the machine. The internal
The internal GCS emulator is used for local object access, while returned links
use the public loopback origin. Emulator endpoints are rejected without the
mounted local-platform marker.
