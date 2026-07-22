# Database migration job image

This image is used only by the Terraform-managed `migration` Cloud Run Job. It
runs the checked-in, expand-only SQL through Drizzle's production migrator with the dedicated
migrator database secret, then exits. Application services and worker jobs do
not receive that secret, the Drizzle CLI, TypeScript, or esbuild.

The same image also contains the dependency-free `smoke.mjs` entry point used
by the separate, credential-free release smoke job. Terraform gives that job a
dedicated identity and no database secret.

Build from the repository root:

```bash
docker build -f cloudrun-migrations/Dockerfile -t smart-job-migration:local .
```
