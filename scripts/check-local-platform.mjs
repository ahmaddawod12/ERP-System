import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const compose = read("compose.local.yml");
const marker = read("local-platform/marker").trim();
const gitignore = read(".gitignore");
const websiteDockerfile = read("website/Dockerfile");
const nextConfig = read("website/next.config.ts");
const launcher = read("scripts/local-platform.mjs");

function requireMatch(value, expression, message) {
  if (!expression.test(value)) throw new Error(message);
}

if (marker !== "smart-job-erp-local-platform-v1") {
  throw new Error("The local-platform marker is not canonical");
}
requireMatch(compose, /name:\s*\$\{SMART_JOB_LOCAL_NETWORK:-smart-job-local\}[\s\S]*external:\s*true/, "Compose must use the external repository network");
requireMatch(compose, /smart-job-supabase-gateway:8000/, "Compose must use the stable repository-owned Supabase gateway alias");
requireMatch(compose, /smart-job-supabase-db:5432/, "Compose must use the stable repository-owned Supabase database alias");
if (/supabase_(?:kong|db)_/.test(compose)) throw new Error("Compose must not couple services to Supabase CLI container names");
requireMatch(launcher, /ensureSupabaseNetworkAlias\("8000\/tcp",\s*supabaseNetworkAliases\.gateway\)/, "The launcher must resolve and bind the active Supabase gateway");
requireMatch(launcher, /ensureSupabaseNetworkAlias\("5432\/tcp",\s*supabaseNetworkAliases\.database\)/, "The launcher must resolve and bind the active Supabase database");
requireMatch(compose, /smart_job_local_platform:[\s\S]*file:\s*\.\/local-platform\/marker/, "Compose must mount the repository marker as a secret");
requireMatch(compose, /cloudrun-tax:[\s\S]*?TAX_SUBMISSION_MODE:\s*disabled[\s\S]*?cloudrun-pdf:/, "Local tax submission must remain disabled");
requireMatch(compose, /cloudrun-archiver:[\s\S]*?profiles:\s*\["jobs"\][\s\S]*?DATABASE_URL:\s*postgresql:\/\/smart_job_archiver:/, "The archiver must use its least-privileged database role");
requireMatch(compose, /cloudrun-archiver:[\s\S]*?ARCHIVER_CANDIDATE_LIMIT:\s*"2000"[\s\S]*?depends_on:/, "Local archive candidate discovery must remain explicitly bounded");
if (/ALLOW_LOCAL_ARCHIVER_ADMIN/.test(compose)) throw new Error("The removed archiver admin compatibility flag is forbidden");
requireMatch(compose, /fsouza\/fake-gcs-server:1\.55\.0/, "The GCS emulator image must be version-pinned");
requireMatch(compose, /axllent\/mailpit:v1\.29\.7/, "The Mailpit image must be version-pinned");
requireMatch(compose, /gcs-emulator:[\s\S]*?healthcheck:[\s\S]*?storage\/v1\/b\?project=smart-job-local[\s\S]*?mailpit:/, "The GCS emulator must have an HTTP health check");
requireMatch(compose, /local-platform-adapter:[\s\S]*?gcs-emulator:\s*\n\s*condition:\s*service_healthy/, "The local adapter must wait for healthy GCS");
if (/network_mode:\s*host/.test(compose)) throw new Error("Host networking is forbidden");
for (const line of compose.split(/\r?\n/)) {
  if (/^\s+-\s+[^#]*:\d+\s*$/.test(line) && !/^\s+-\s+127\.0\.0\.1:/.test(line)) {
    throw new Error(`Published local ports must bind to loopback: ${line.trim()}`);
  }
}
requireMatch(gitignore, /local-platform\/\.env\.generated/, "Generated local credentials must be ignored");
requireMatch(nextConfig, /output:\s*"standalone"/, "The website must use standalone output");
requireMatch(websiteDockerfile, /USER\s+node/, "The website runtime must be non-root");
requireMatch(websiteDockerfile, /ENTRYPOINT\s+\["node",\s*"docker-entrypoint\.mjs"\]/, "The website must use its marker-validating entrypoint");
if (/run\("supabase",\s*\["status"\]\)/.test(launcher)) {
  throw new Error("The local status command must never print the Supabase credential table");
}

process.stdout.write("Local platform static safeguards passed.\n");
