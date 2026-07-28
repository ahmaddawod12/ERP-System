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
const localNetwork = "smart-job-local";
const expectedMarker = "smart-job-erp-local-platform-v1";

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
  if (!existsSync(composeFile) || !existsSync(markerFile)) {
    fail("run this command from the Smart-Job ERP repository checkout");
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

function randomBase64Url(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function existingRuntimeValues() {
  return existsSync(runtimeEnvFile)
    ? parseEnvironmentFile(readFileSync(runtimeEnvFile, "utf8"))
    : new Map();
}

function ensureRuntimeEnvironment() {
  const existing = existingRuntimeValues();
  const stable = (name, factory = randomBase64Url) => existing.get(name) || factory();
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
    ["LOCAL_POSTGRES_PORT", existing.get("LOCAL_POSTGRES_PORT") || "55432"],
    ["LOCAL_FIREBASE_AUTH_PORT", existing.get("LOCAL_FIREBASE_AUTH_PORT") || "59099"],
    ["LOCAL_POSTGRES_PASSWORD", stable("LOCAL_POSTGRES_PASSWORD")],
    ["LOCAL_FIREBASE_WEB_API_KEY", stable("LOCAL_FIREBASE_WEB_API_KEY", () => randomBase64Url(24))],
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

function composeArguments(...args) {
  return ["compose", "-f", composeFile, "--env-file", runtimeEnvFile, ...args];
}

function validateCompose() {
  run("docker", composeArguments("config", "--quiet"), { capture: true });
}

function startDependencies() {
  process.stdout.write("Starting PostgreSQL and local service emulators...\n");
  run("docker", composeArguments(
    "up",
    "--build",
    "--detach",
    "--wait",
    "postgres",
    "firebase-auth-emulator",
    "gcs-emulator",
    "mailpit",
    "local-platform-adapter",
  ));
}

function migrateDatabase(values) {
  ensureDatabaseTooling();
  process.stdout.write("Applying Drizzle migrations to local PostgreSQL...\n");
  const password = values.get("LOCAL_POSTGRES_PASSWORD");
  const port = values.get("LOCAL_POSTGRES_PORT");
  run("npm", ["--prefix", "packages/db", "run", "db:migrate"], {
    env: {
      ...process.env,
      DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`,
      DATABASE_SSL_MODE: "disable",
    },
  });
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
    `  Firebase Auth: http://127.0.0.1:${values.get("LOCAL_FIREBASE_AUTH_PORT")}`,
    `  PostgreSQL:    postgresql://127.0.0.1:${values.get("LOCAL_POSTGRES_PORT")}/postgres`,
    `  Mailpit:       http://127.0.0.1:${values.get("LOCAL_MAILPIT_PORT")}`,
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
  const values = ensureRuntimeEnvironment();
  validateCompose();
  startDependencies();
  migrateDatabase(values);
  bootstrapRoles();
  startApplications();
  printEndpoints(values);
}

function stop() {
  doctor();
  if (existsSync(runtimeEnvFile)) {
    run("docker", composeArguments("down", "--remove-orphans"));
  }
  process.stdout.write("Stopped the repository local platform; named volumes were preserved.\n");
}

function reset(confirmed) {
  if (!confirmed) {
    fail("reset deletes only this project's local database, auth users, queues, archives, and test email; pass --yes to confirm");
  }
  doctor();
  ensureNetwork();
  const values = ensureRuntimeEnvironment();
  validateCompose();
  run("docker", composeArguments("down", "--volumes", "--remove-orphans"));
  startDependencies();
  migrateDatabase(values);
  bootstrapRoles();
  startApplications();
  printEndpoints(values);
}

function status() {
  doctor();
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
      "  doctor       verify Docker Desktop, Node, and repository identity",
      "  start        start PostgreSQL, Firebase Auth, migrate roles, and launch Compose",
      "  status       show local service status and non-secret endpoints",
      "  stop         stop this repository's services while preserving local data",
      "  reset --yes  destroy and recreate only this repository's local data",
      "  archive      run the opt-in local archiver job",
      "",
    ].join("\n"));
}
