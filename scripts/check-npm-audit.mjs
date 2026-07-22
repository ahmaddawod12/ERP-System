#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTER_PATH = resolve(ROOT, 'security', 'npm-audit-exceptions.json');
const WORKSPACES = [
  'packages/contracts',
  'packages/api-contracts',
  'packages/db',
  'website',
  'phone_app',
  'cloudrun-api',
  'cloudrun-tax',
  'cloudrun-pdf',
  'cloudrun-email',
  'cloudrun-archiver',
  'local-platform/adapter',
];
const NON_BLOCKING_SEVERITIES = new Set(['info', 'low']);
const EXCEPTION_SEVERITIES = new Set(['moderate']);

function fail(message) {
  process.stderr.write(`[NPM AUDIT] ${message}\n`);
  process.exitCode = 1;
}

function parseUtcDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} is invalid`);
  return parsed;
}

const register = JSON.parse(readFileSync(REGISTER_PATH, 'utf8'));
if (register.schemaVersion !== 1 || !Array.isArray(register.exceptions)) {
  throw new Error('Unsupported npm audit exception register');
}

const recordedAt = parseUtcDate(register.recordedAt, 'recordedAt');
const today = new Date();
today.setUTCHours(0, 0, 0, 0);
const exceptions = new Map();

for (const exception of register.exceptions) {
  const key = `${exception.workspace}:${exception.source}`;
  if (exceptions.has(key)) throw new Error(`Duplicate npm audit exception: ${key}`);
  if (!WORKSPACES.includes(exception.workspace)) throw new Error(`Unknown exception workspace: ${key}`);
  if (!Number.isSafeInteger(exception.source) || exception.source <= 0) throw new Error(`Invalid advisory source: ${key}`);
  if (!/^GHSA-[a-z0-9]{4}(?:-[a-z0-9]{4}){2}$/.test(exception.advisory)) throw new Error(`Invalid GHSA ID: ${key}`);
  if (!EXCEPTION_SEVERITIES.has(exception.severity)) {
    throw new Error(`Only moderate advisories may be excepted: ${key}`);
  }
  if (!exception.package || !exception.owner || !exception.reachability || !exception.resolution) {
    throw new Error(`Incomplete npm audit exception: ${key}`);
  }
  if (!Array.isArray(exception.compensatingControls) || exception.compensatingControls.length < 2) {
    throw new Error(`At least two compensating controls are required: ${key}`);
  }
  const reviewBy = parseUtcDate(exception.reviewBy, `${key} reviewBy`);
  const lifetimeDays = Math.round((reviewBy.getTime() - recordedAt.getTime()) / 86_400_000);
  if (lifetimeDays < 1 || lifetimeDays > 30) throw new Error(`Exception exceeds the 30-day limit: ${key}`);
  if (reviewBy < today) throw new Error(`Expired npm audit exception: ${key}`);
  exceptions.set(key, exception);
}

const usedExceptions = new Set();
const unresolved = [];
function npmAuditCommand(workspace) {
  if (process.platform !== 'win32') {
    return {
      command: 'npm',
      args: ['--prefix', workspace, 'audit', '--json'],
      shell: false,
    };
  }

  // Windows cannot execute npm.cmd directly through spawnSync. The workspace
  // comes from the fixed allowlist above, so no caller-controlled shell text is
  // interpolated into this command.
  return {
    command: `npm.cmd --prefix ${workspace} audit --json`,
    args: [],
    shell: true,
  };
}

function auditWorkspace(workspace) {
  const invocation = npmAuditCommand(workspace);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    shell: invocation.shell,
    windowsHide: true,
  });
  if (result.error) throw result.error;

  const jsonStart = result.stdout.indexOf('{');
  if (jsonStart < 0) {
    throw new Error(`${workspace}: npm audit did not return JSON: ${result.stderr.trim()}`);
  }
  const report = JSON.parse(result.stdout.slice(jsonStart));
  if (report.auditReportVersion !== 2 || !report.vulnerabilities) {
    throw new Error(`${workspace}: npm audit failed: ${report.message || 'invalid report'}`);
  }

  const vulnerabilities = report.vulnerabilities;
  const memo = new Map();
  const visiting = new Set();

  function advisoryAllowed(advisory) {
    if (NON_BLOCKING_SEVERITIES.has(advisory.severity)) return true;
    const key = `${workspace}:${advisory.source}`;
    const exception = exceptions.get(key);
    if (
      !exception
      || vulnerabilities[advisory.name]?.isDirect
      || exception.package !== advisory.name
      || exception.severity !== advisory.severity
      || !advisory.url.endsWith(exception.advisory)
    ) return false;
    usedExceptions.add(key);
    return true;
  }

  function vulnerabilityAllowed(name) {
    if (memo.has(name)) return memo.get(name);
    if (visiting.has(name)) return false;
    const vulnerability = vulnerabilities[name];
    if (!vulnerability || !Array.isArray(vulnerability.via) || vulnerability.via.length === 0) return false;
    visiting.add(name);
    const allowed = vulnerability.via.every((via) => (
      typeof via === 'string' ? vulnerabilityAllowed(via) : advisoryAllowed(via)
    ));
    visiting.delete(name);
    memo.set(name, allowed);
    return allowed;
  }

  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    if (!NON_BLOCKING_SEVERITIES.has(vulnerability.severity) && !vulnerabilityAllowed(name)) {
      unresolved.push(`${workspace}: ${name} (${vulnerability.severity}, ${vulnerability.range})`);
    }
  }

  const total = report.metadata?.vulnerabilities?.total ?? Object.keys(vulnerabilities).length;
  process.stdout.write(`[NPM AUDIT] ${workspace}: ${total} finding(s), all resolved or explicitly bounded.\n`);
}

for (const workspace of WORKSPACES) {
  try {
    auditWorkspace(workspace);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

for (const key of exceptions.keys()) {
  if (!usedExceptions.has(key)) fail(`Stale or unused exception: ${key}`);
}
for (const finding of unresolved) fail(`Unapproved finding: ${finding}`);

if (!process.exitCode) {
  process.stdout.write(`[NPM AUDIT] Passed ${WORKSPACES.length} lockfile audits with ${usedExceptions.size} active leaf exception(s).\n`);
}
