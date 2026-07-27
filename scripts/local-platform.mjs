import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { assertSupportedNodeVersion } from "./node-version.mjs";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const composeFile = join(repositoryRoot, "compose.local.yml");
const runtimeEnvFile = join(repositoryRoot, "local-platform", ".env.generated");
const markerFile = join(repositoryRoot, "local-platform", "marker");
const supabaseConfig = join(repositoryRoot, "supabase", "config.toml");
const localNetwork = "smart-job-local";
const projectId = "smart-job-erp-local";
const expectedMarker = "smart-job-erp-local-platform-v1";
const supabaseNetworkAliases = Object.freeze({
  database: "smart-job-supabase-db",
  gateway: "smart-job-supabase-gateway",
});

function fail(message) {
  process.stderr.write(`Local platform: ${message}\n`);
  process.exit(1);
}

function run(command, args, options = {}) {
  let executable = command;
  let executableArgs = args;
  if (process.platform === "win32" && command === "npm") {
    if (args.some((value) => !/^[A-Za-z0-9_./:=@-]+$/.test(value))) {
      fail("refusing to pass an unsafe argument to npm.cmd");
    }
    executable = process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
    executableArgs = ["/d", "/s", "/c", ["npm.cmd", ...args].join(" ")];
  }
  const result = spawnSync(executable, executableArgs, {
    cwd: repositoryRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    if (result.error.code === "ENOENT") fail(`${command} is not installed or is not on PATH`);
    throw result.error;
  }
  if (result.status !== 0 && !options.allowFailure) {
    if (options.capture) {
      const detail = String(result.stderr || result.stdout || "").trim().split(/\r?\n/).at(-1);
      fail(`${command} failed${detail ? `: ${detail.slice(0, 300)}` : ""}`);
    }
    fail(`${command} exited with code ${result.status}`);
  }
  return result;
}

function assertRepository() {
  if (!existsSync(composeFile) || !existsSync(supabaseConfig) || !existsSync(markerFile)) {
    fail("run this command from the Smart-Job ERP repository checkout");
  }
  const config = readFileSync(supabaseConfig, "utf8");
  if (!/^project_id\s*=\s*"smart-job-erp-local"\s*$/m.test(config)) {
    fail("supabase/config.toml does not identify the repository-owned local project");
  }
  if (readFileSync(markerFile, "utf8").trim() !== expectedMarker) {
    fail("the repository local-platform marker is invalid");
  }
}

function requireDockerDaemon() {
  run("docker", ["--version"], { capture: true });
  run("docker", ["compose", "version"], { capture: true });
  const info = run("docker", ["info", "--format", "{{.ServerVersion}}"], {
    capture: true,
    allowFailure: true,
  });
  if (info.status !== 0 || !String(info.stdout || "").trim()) {
    fail("Docker Desktop is installed but its daemon is not running. Start Docker Desktop and retry.");
  }
}

function requireTooling() {
  try {
    assertSupportedNodeVersion();
  } catch (error) {
    fail(error instanceof Error ? error.message : "Node 22.x is required");
  }
  run("node", ["--version"], { capture: true });
  run("npm", ["--version"], { capture: true });
  run("supabase", ["--version"], { capture: true });
}

function ensureNetwork() {
  const inspect = run("docker", [
    "network",
    "inspect",
    localNetwork,
    "--format",
    "{{ index .Labels \"com.smart-job.local-platform\" }}",
  ], { capture: true, allowFailure: true });
  if (inspect.status === 0) {
    if (String(inspect.stdout || "").trim() !== "true") {
      fail(`Docker network ${localNetwork} already exists but is not owned by this repository`);
    }
    return;
  }
  process.stdout.write(`Creating Docker network ${localNetwork}...\n`);
  run("docker", [
    "network",
    "create",
    "--label",
    "com.smart-job.local-platform=true",
    localNetwork,
  ], { capture: true });
}

function startSupabase() {
  process.stdout.write("Starting the repository-owned Supabase CLI stack...\n");
  run("supabase", ["start", "--network-id", localNetwork], { capture: true });
  ensureSupabaseNetworkAlias("5432/tcp", supabaseNetworkAliases.database);
  ensureSupabaseNetworkAlias("8000/tcp", supabaseNetworkAliases.gateway);
}

function resolveSupabaseContainer(exposedPort) {
  const candidates = run("docker", [
    "ps",
    "--filter",
    `network=${localNetwork}`,
    "--format",
    "{{.ID}}",
  ], { capture: true });
  const matches = String(candidates.stdout || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((containerId) => {
      const inspected = run("docker", [
        "inspect",
        containerId,
        "--format",
        "{{json .}}",
      ], { capture: true });
      try {
        const metadata = JSON.parse(String(inspected.stdout || "").trim());
        const config = metadata.Config || {};
        const labels = config.Labels || {};
        const belongsToProject =
          Object.values(labels).some((value) => String(value) === projectId)
          || String(metadata.Name || "").includes(projectId);
        return belongsToProject && Object.hasOwn(config.ExposedPorts || {}, exposedPort);
      } catch {
        fail(`Docker returned invalid metadata for local container ${containerId}`);
      }
    });
  if (matches.length !== 1) {
    fail(`expected one ${projectId} container exposing ${exposedPort}, found ${matches.length}`);
  }
  return matches[0];
}

function ensureSupabaseNetworkAlias(exposedPort, alias) {
  const containerId = resolveSupabaseContainer(exposedPort);
  const inspected = run("docker", [
    "inspect",
    containerId,
    "--format",
    `{{json (index .NetworkSettings.Networks "${localNetwork}").Aliases}}`,
  ], { capture: true });
  let aliases;
  try {
    aliases = JSON.parse(String(inspected.stdout || "").trim());
  } catch {
    fail(`Docker returned invalid ${localNetwork} aliases for ${containerId}`);
  }
  if (Array.isArray(aliases) && aliases.includes(alias)) return;

  // Supabase may attach the container before this script can assign a stable
  // repository-owned alias. Reattach only this validated project container.
  run("docker", ["network", "disconnect", localNetwork, containerId], { capture: true });
  run("docker", ["network", "connect", "--alias", alias, localNetwork, containerId], { capture: true });
  const verified = run("docker", [
    "inspect",
    containerId,
    "--format",
    `{{json (index .NetworkSettings.Networks "${localNetwork}").Aliases}}`,
  ], { capture: true });
  const verifiedAliases = JSON.parse(String(verified.stdout || "").trim());
  if (!Array.isArray(verifiedAliases) || !verifiedAliases.includes(alias)) {
    fail(`${containerId} does not expose the required ${localNetwork} alias ${alias}`);
  }
}

function parseEnvironmentFile(text) {
  const parsed = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(?:"((?:[^"\\]|\\.)*)"|(.*))$/.exec(line.trim());
    if (!match) continue;
    const raw = match[2] === undefined ? (match[3] ?? "") : match[2];
    parsed.set(match[1], raw.replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
  }
  return parsed;
}

function readSupabaseStatus() {
  const result = run("supabase", ["status", "-o", "env"], { capture: true });
  const values = parseEnvironmentFile(String(result.stdout || ""));
  for (const key of ["DB_URL", "PUBLISHABLE_KEY", "SECRET_KEY"]) {
    if (!values.get(key)) fail(`Supabase status did not return ${key}`);
  }
  return values;
}

function randomBase64Url(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function existingRuntimeValues() {
  return existsSync(runtimeEnvFile)
    ? parseEnvironmentFile(readFileSync(runtimeEnvFile, "utf8"))
    : new Map();
}

function ensureRuntimeEnvironment(supabase) {
  const existing = existingRuntimeValues();
  const stable = (name, factory = randomBase64Url) => existing.get(name) || factory();
  let databasePassword = "postgres";
  try {
    databasePassword = new URL(supabase.get("DB_URL")).password || databasePassword;
  } catch {
    fail("Supabase returned an invalid local database URL");
  }
  const values = new Map([
    ["SMART_JOB_LOCAL_NETWORK", localNetwork],
    ["LOCAL_WEBSITE_PORT", existing.get("LOCAL_WEBSITE_PORT") || "3000"],
    ["LOCAL_API_PORT", existing.get("LOCAL_API_PORT") || "58081"],
    ["LOCAL_TAX_PORT", existing.get("LOCAL_TAX_PORT") || "58082"],
    ["LOCAL_PDF_PORT", existing.get("LOCAL_PDF_PORT") || "58083"],
    ["LOCAL_ADAPTER_PORT", existing.get("LOCAL_ADAPTER_PORT") || "58084"],
    ["LOCAL_EMAIL_PORT", existing.get("LOCAL_EMAIL_PORT") || "58085"],
    ["LOCAL_GCS_PORT", existing.get("LOCAL_GCS_PORT") || "58080"],
    ["LOCAL_MAILPIT_PORT", existing.get("LOCAL_MAILPIT_PORT") || "58025"],
    ["LOCAL_SUPABASE_PUBLISHABLE_KEY", supabase.get("PUBLISHABLE_KEY")],
    ["LOCAL_SUPABASE_SECRET_KEY", supabase.get("SECRET_KEY")],
    ["LOCAL_SUPABASE_DB_PASSWORD", databasePassword],
    ["LOCAL_API_DB_PASSWORD", stable("LOCAL_API_DB_PASSWORD")],
    ["LOCAL_PDF_DB_PASSWORD", stable("LOCAL_PDF_DB_PASSWORD")],
    ["LOCAL_EMAIL_DB_PASSWORD", stable("LOCAL_EMAIL_DB_PASSWORD")],
    ["LOCAL_ARCHIVER_DB_PASSWORD", stable("LOCAL_ARCHIVER_DB_PASSWORD")],
    ["LOCAL_WEB_SESSION_ENCRYPTION_KEY_BASE64", stable(
      "LOCAL_WEB_SESSION_ENCRYPTION_KEY_BASE64",
      () => randomBytes(32).toString("base64"),
    )],
    ["LOCAL_WEBSITE_SESSION_SECRET", stable("LOCAL_WEBSITE_SESSION_SECRET")],
    ["LOCAL_CONTACT_CHALLENGE_SECRET", stable("LOCAL_CONTACT_CHALLENGE_SECRET")],
    ["LOCAL_ADAPTER_ACCESS_TOKEN", stable("LOCAL_ADAPTER_ACCESS_TOKEN")],
    ["LOCAL_INTERNAL_IDENTITY_TOKEN", stable("LOCAL_INTERNAL_IDENTITY_TOKEN")],
    ["LOCAL_PUBSUB_VERIFICATION_TOKEN", stable("LOCAL_PUBSUB_VERIFICATION_TOKEN")],
  ]);
  const body = [
    "# Generated for smart-job-erp-local. Never deploy or commit this file.",
    ...[...values].map(([key, value]) => `${key}=${value}`),
    "",
  ].join("\n");
  writeFileSync(runtimeEnvFile, body, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(runtimeEnvFile, 0o600);
  } catch {
    // Windows ACLs remain authoritative; the file is still ignored by Git.
  }
  process.stdout.write("Generated stable, local-only runtime credentials.\n");
  return values;
}

function ensureDatabaseTooling() {
  const drizzleKit = join(repositoryRoot, "packages", "db", "node_modules", ".bin", "drizzle-kit.cmd");
  const drizzleKitPosix = join(repositoryRoot, "packages", "db", "node_modules", ".bin", "drizzle-kit");
  if (!existsSync(drizzleKit) && !existsSync(drizzleKitPosix)) {
    process.stdout.write("Installing database migration tooling...\n");
    run("npm", ["--prefix", "packages/contracts", "ci"]);
    run("npm", ["--prefix", "packages/contracts", "run", "build"]);
    run("npm", ["--prefix", "packages/db", "ci"]);
  }
}

function migrateDatabase(supabase) {
  ensureDatabaseTooling();
  process.stdout.write("Applying expand-only Drizzle migrations...\n");
  run("npm", ["--prefix", "packages/db", "run", "db:migrate"], {
    env: {
      ...process.env,
      DATABASE_URL: supabase.get("DB_URL"),
      DATABASE_SSL_MODE: "disable",
    },
  });
}

function composeArguments(...args) {
  return ["compose", "-f", composeFile, "--env-file", runtimeEnvFile, ...args];
}

function validateCompose() {
  run("docker", composeArguments("config", "--quiet"), { capture: true });
}

function bootstrapRoles() {
  process.stdout.write("Bootstrapping least-privilege local database role passwords...\n");
  run("docker", composeArguments(
    "--profile",
    "bootstrap",
    "run",
    "--rm",
    "db-role-bootstrap",
  ));
}

function startApplications() {
  process.stdout.write("Building and starting the local application platform...\n");
  run("docker", composeArguments("up", "--build", "--wait", "--remove-orphans"));
}

function printEndpoints(values) {
  process.stdout.write([
    "",
    "Local platform is ready:",
    `  Website:       http://127.0.0.1:${values.get("LOCAL_WEBSITE_PORT")}`,
    `  API:           http://127.0.0.1:${values.get("LOCAL_API_PORT")}`,
    `  Mailpit:       http://127.0.0.1:${values.get("LOCAL_MAILPIT_PORT")}`,
    "  Supabase:      http://127.0.0.1:55321",
    "  Supabase UI:   http://127.0.0.1:55323",
    "  Tax gateway:   disabled",
    "",
  ].join("\n"));
}

function doctor() {
  assertRepository();
  requireTooling();
  requireDockerDaemon();
  process.stdout.write("Local platform prerequisites are available.\n");
}

function start() {
  doctor();
  ensureNetwork();
  startSupabase();
  const supabase = readSupabaseStatus();
  const values = ensureRuntimeEnvironment(supabase);
  validateCompose();
  migrateDatabase(supabase);
  bootstrapRoles();
  startApplications();
  printEndpoints(values);
}

function stop() {
  doctor();
  if (existsSync(runtimeEnvFile)) {
    run("docker", composeArguments("down", "--remove-orphans"));
  }
  run("supabase", ["stop"], { capture: true });
  process.stdout.write("Stopped the repository local platform; named volumes were preserved.\n");
}

function reset(confirmed) {
  if (!confirmed) {
    fail("reset deletes only this project's local database, queues, archives, and test email; pass --yes to confirm");
  }
  doctor();
  ensureNetwork();
  if (existsSync(runtimeEnvFile)) {
    run("docker", composeArguments("down", "--volumes", "--remove-orphans"));
  }
  startSupabase();
  process.stdout.write("Resetting the repository-owned local Supabase database...\n");
  run("supabase", [
    "db",
    "reset",
    "--local",
    "--no-seed",
    "--network-id",
    localNetwork,
  ]);
  ensureSupabaseNetworkAlias("5432/tcp", supabaseNetworkAliases.database);
  ensureSupabaseNetworkAlias("8000/tcp", supabaseNetworkAliases.gateway);
  const supabase = readSupabaseStatus();
  const values = ensureRuntimeEnvironment(supabase);
  validateCompose();
  migrateDatabase(supabase);
  bootstrapRoles();
  startApplications();
  printEndpoints(values);
}

function status() {
  doctor();
  // The CLI's default status table includes publishable, secret, and S3 keys.
  // Capture the env form only to verify that the stack is available, and never
  // forward its stdout to the terminal.
  readSupabaseStatus();
  process.stdout.write("Supabase local development stack is running.\n");
  if (existsSync(runtimeEnvFile)) {
    run("docker", composeArguments("ps"));
    printEndpoints(existingRuntimeValues());
  } else {
    process.stdout.write("Application containers have not been configured yet.\n");
  }
}

function archive() {
  doctor();
  if (!existsSync(runtimeEnvFile)) fail("start the local platform before running the archiver");
  validateCompose();
  run("docker", composeArguments("--profile", "jobs", "run", "--rm", "cloudrun-archiver"));
}

const [command = "help", ...arguments_] = process.argv.slice(2);
const confirmed = arguments_.includes("--yes");

switch (command) {
  case "doctor": doctor(); break;
  case "start": start(); break;
  case "stop": stop(); break;
  case "reset": reset(confirmed); break;
  case "status": status(); break;
  case "archive": archive(); break;
  default:
    process.stdout.write([
      "Usage: node scripts/local-platform.mjs <command>",
      "",
      "Commands:",
      "  doctor       verify Docker Desktop, Supabase CLI, Node, and repository identity",
      "  start        start Supabase, migrate/bootstrap roles, and launch Compose",
      "  status       show local service status and non-secret endpoints",
      "  stop         stop this repository's services while preserving local data",
      "  reset --yes  destroy and recreate only this repository's local data",
      "  archive      run the opt-in local archiver compatibility job",
      "",
    ].join("\n"));
}
