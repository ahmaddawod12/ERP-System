import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/cloudrun-deploy.yml", "utf8");
const foundation = readFileSync("infra/modules/foundation/main.tf", "utf8");
const runtime = readFileSync("infra/modules/runtime/main.tf", "utf8");
const edge = readFileSync("infra/modules/edge/main.tf", "utf8");
const migrationImage = readFileSync("cloudrun-migrations/Dockerfile", "utf8");

function requireMatch(source, expression, message) {
  if (!expression.test(source)) throw new Error(message);
}

function requireOrder(source, first, second, message) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex >= secondIndex) {
    throw new Error(message);
  }
}

requireMatch(workflow, /test "\$\{IMAGE_TAG\}" = "\$\{GITHUB_SHA\}"/, "Release SHA must match the selected workflow ref");
requireMatch(workflow, /actions\/workflows\/ci\.yml\/runs\?head_sha=\$\{GITHUB_SHA\}/, "Release must require successful CI for the selected SHA");
requireMatch(workflow, /environment: \$\{\{ inputs\.environment \}\}/, "Production promotion must pass through the protected environment gate");
requireMatch(workflow, /Require a prebuilt release for production/, "Production must consume a prebuilt staging release");
requireMatch(workflow, /test "\$\{DESTINATION_DIGEST\}" = "\$\{EXPECTED_DIGEST\}"/, "Production promotion must preserve the exact manifest digest");
requireMatch(workflow, /cosign sign --yes/, "Release digests must be keyless-signed");
requireMatch(workflow, /cosign verify/, "Every release stage must verify keyless signatures");
requireMatch(workflow, /--certificate-identity-regexp "[^\r\n]*@refs\/heads\/main\$"/, "Release signatures must be bound to the main deployment workflow");
requireMatch(workflow, /--no-traffic/, "Candidate revisions must start with no traffic");
requireMatch(workflow, /options:[\s\S]*- candidate[\s\S]*- "10"[\s\S]*- "50"[\s\S]*- "100"/, "Traffic promotion must be explicit at 10, 50, and 100 percent");
requireMatch(workflow, /rollback\(\)[\s\S]*--to-revisions "\$\{STABLE\[\$key\]\}=100"/, "Failed traffic smoke tests must restore stable revisions");
requireMatch(workflow, /SMOKE_TARGETS=/, "No-traffic revisions must be probed by the internal smoke job");
requireMatch(workflow, /test "\$\{actual_image\}" = "\$\{expected_image\}"/, "Traffic promotion must revalidate the candidate image digest");
requireOrder(workflow, "jobs execute \"${CLOUD_RUN_NAME_PREFIX}-migration\"", "deploy_candidate website", "Migration must complete before service revisions deploy");

for (const [name, dockerfile] of Object.entries({
  website: "website/Dockerfile",
  api: "cloudrun-api/Dockerfile",
  tax: "cloudrun-tax/Dockerfile",
  pdf: "cloudrun-pdf/Dockerfile",
  email: "cloudrun-email/Dockerfile",
  archiver: "cloudrun-archiver/Dockerfile",
  migration: "cloudrun-migrations/Dockerfile",
})) {
  requireMatch(workflow, new RegExp(`name: ${name}\\s+repository:[\\s\\S]{0,80}dockerfile: ${dockerfile.replaceAll("/", "\\/")}`), `${name} must be part of the build-once release matrix`);
  requireMatch(workflow, new RegExp(`release\\/\\$\\{\\{ matrix\\.name \\}\\}\\.digest`), "Release manifest artifacts must be digest-only");
}

requireMatch(foundation, /resource "google_iam_workload_identity_pool_provider" "github"/, "GitHub deploys must use Workload Identity Federation");
requireMatch(foundation, /assertion\.repository_owner_id/, "WIF must bind the immutable repository owner ID");
requireMatch(foundation, /assertion\.workflow_ref/, "WIF must bind the exact deployment workflow");
requireMatch(foundation, /resource "google_secret_manager_secret" "runtime"/, "Terraform must create secret containers");
if (/google_secret_manager_secret_version/.test(foundation)) {
  throw new Error("Terraform must never manage secret payload versions");
}

requireMatch(runtime, /INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER/, "Public services must reject direct internet ingress");
requireMatch(runtime, /INGRESS_TRAFFIC_INTERNAL_ONLY/, "Worker services must remain internal");
requireMatch(runtime, /TAX_SUBMISSION_MODE\s+= "disabled"/, "Tax submission must remain fail-closed at launch");
requireMatch(runtime, /min_instances\s+= 1/, "Website, API, and tax services require warm instances");
requireMatch(runtime, /min_instances\s+= 0/, "Durable PDF and email workers must scale to zero");
requireMatch(runtime, /task_count\s+= 1[\s\S]*parallelism\s+= 1/, "Cloud Run jobs must be single-task and non-parallel");
requireMatch(runtime, /database_connection_budget <= floor\(var\.supabase_connection_limit \* 0\.70\)/, "Aggregate DB pools must stay at or below 70 percent");
const migrationJob = runtime.match(/\n    migration = \{([\s\S]*?)\n    smoke = \{/i)?.[1] || "";
requireMatch(migrationJob, /max_retries\s+= 0/, "Migration job must not blindly retry schema changes");
requireMatch(migrationJob, /DATABASE_URL\s+= var\.secret_ids\["migrator_database_url"\]/, "Migration job must use the dedicated migrator secret");
requireMatch(migrationJob, /DATABASE_SSL_MODE\s+= "require"/, "Migration connections must require TLS");
requireMatch(migrationJob, /DATABASE_SSL_REJECT_UNAUTHORIZED\s+= "true"/, "Migration connections must verify database certificates");
requireMatch(runtime, /tax-submissions\/drain[\s\S]{0,150}paused\s+= true/, "Tax submission scheduler must remain paused");

requireMatch(edge, /evaluatePreconfiguredWaf\('sqli-v33-stable'\)/, "Cloud Armor must enable the managed SQLi ruleset");
requireMatch(edge, /evaluatePreconfiguredWaf\('xss-v33-stable'\)/, "Cloud Armor must enable the managed XSS ruleset");
requireMatch(edge, /action\s+= "throttle"[\s\S]*exceed_action\s+= "deny\(429\)"[\s\S]*enforce_on_key\s+= "IP"/, "Cloud Armor must throttle abusive client IPs with HTTP 429");
requireMatch(edge, /min_tls_version\s+= "TLS_1_2"/, "The public edge must enforce TLS 1.2 or newer");
requireMatch(edge, /dnssec_config[\s\S]*state = "on"/, "Public DNS zones must enable DNSSEC");

requireMatch(migrationImage, /USER node/, "Migration image must run as a non-root user");
requireMatch(migrationImage, /CMD \["node", "migrate\.mjs"\]/, "Migration image must run the production migration entry point");

process.stdout.write("Deployment and infrastructure security safeguards passed.\n");
