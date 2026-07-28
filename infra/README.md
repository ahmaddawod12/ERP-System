# Smart-Job production infrastructure

Batch 8 infrastructure is split into reusable modules and explicit environment
roots. Projects, billing links, and the remote-state bucket are bootstrap
prerequisites; everything else in the GCP platform belongs to Terraform.

## Bootstrap boundary

Create these items outside Terraform before the first plan:

1. One GCP project per environment with billing attached.
2. A dedicated, versioned, uniformly-access-controlled GCS state bucket with
   public access prevention and customer-managed or Google-managed encryption.
3. The CI deploy principal's temporary bootstrap access to that state bucket
   and the target project.

Do not put secret payloads in Terraform variables. Terraform creates Secret
Manager containers and grants access; operators populate versions out of band.

## Environment initialization

Each root owns a distinct backend prefix. Copy the examples, replace every
placeholder, and initialize the selected root:

```powershell
Copy-Item infra/environments/dev/backend.hcl.example infra/environments/dev/backend.hcl
Copy-Item infra/environments/dev/terraform.tfvars.example infra/environments/dev/terraform.tfvars
terraform -chdir=infra/environments/dev init -backend-config=backend.hcl
terraform -chdir=infra/environments/dev plan
```

The initial apply keeps both `enable_release_jobs = false` and
`enable_runtime = false`. It creates APIs, Artifact Registry, network/egress,
service identities, secret containers, buckets, and GitHub Workload Identity
Federation. After the migration image and numbered migrator secret exist, set
only `enable_release_jobs = true`; apply and execute the migration job. Finally
provide all seven digests/secret versions and set `enable_runtime = true` while
public DNS is still undelegated. This prevents the first serving revisions from
starting against an old schema. Normal releases then use the candidate and
10/50/100 workflow stages.

The environment root then creates:

- warm website/API/tax Cloud Run services and scale-to-zero PDF/email workers;
- single-task migration, smoke, and archiver jobs;
- durable Pub/Sub push subscriptions, DLQs, bounded Scheduler drains, and the
  paused tax drain;
- authoritative DNS, DNSSEC, managed TLS, external HTTPS load balancing, and
  per-backend Cloud Armor policies;
- thirty-day request SLOs; service 5xx, scheduler, primary queue/DLQ, tax
  submission/callback, archive failure, database-pool saturation, and session-
  refresh alerts; and dedicated request, document, email, tax, archive, and
  database/session dashboards.

Every mounted secret must be entered in `secret_versions` using its container
ID and an explicit numeric version. `latest` is rejected. `image_digests` must
contain immutable references for `website`, `api`, `tax`, `pdf`, `email`,
`archiver`, and `migration`.

## Release configuration

The staging project is the release source. Repository-level GitHub variables
named `GCP_RELEASE_PROJECT_ID`, `GCP_RELEASE_REGION`,
`GCP_RELEASE_ARTIFACT_REPO`, `GCP_RELEASE_WIF_PROVIDER`, and
`GCP_RELEASE_DEPLOY_SERVICE_ACCOUNT` point to that source. Grant the production
deploy service account `roles/artifactregistry.reader` there through staging's
`artifact_registry_reader_members` input.

Both protected GitHub environments (`staging` and `production`) require:

- `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_TAX_REGION`, `GCP_ARTIFACT_REPO`;
- `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT`,
  `CLOUD_RUN_NAME_PREFIX`;
- exact `WEBSITE_ORIGIN`, `API_ORIGIN`, and `TAX_ORIGIN` values.

Configure required reviewers on the `production` GitHub environment. The
release workflow never stores a service-account key.

The environment examples contain provisional capacity and retention values.
Production database connection counts and retention periods must be reconciled
with the purchased PostgreSQL limit and the legal retention decision before an
apply. The sum of service/job pool maxima must remain at or below 70% of the
database connection limit.
