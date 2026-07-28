# Smart-Job control database

This package owns the small provider-neutral PostgreSQL control plane used
before a request opens a tenant-shard connection.

It stores identity mappings, company-to-shard routes, active membership
projections, and resumable provisioning operations. It deliberately contains
no jobs, clients, documents, inventory, or connection credentials.

Apply the baseline with a migration/admin connection:

```powershell
$env:CONTROL_DATABASE_URL = "postgresql://.../smart_job_control"
$env:CONTROL_DATABASE_SSL_MODE = "require"
npm run db:migrate
```

Provision the `smart_job_control_api` login password out of band after the
migration. Runtime access is execute-only on the private routing/readiness
functions; it has no direct table grants.

Run the static security checks with:

```powershell
npm test
```

The API-side control runtime and tenant shard router currently provide the
cutover foundation. Existing traffic remains on the single tenant database
until directory backfill and route-by-route integration are complete.
