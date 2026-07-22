#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FLOW_ROOT = resolve(ROOT, 'phone_app', '.maestro');
const required = new Map([
  ['login.yaml', ['subflows/authenticate.yaml', 'dashboard-screen']],
  ['tenant-switch.yaml', ['Select a company', 'MAESTRO_TEST_WORKSPACE', 'dashboard-screen']],
  ['job.yaml', ['dashboard-tab-jobMonitor', 'dashboard-action-job-monitor', 'MAESTRO_TEST_JOB_TITLE', 'Job Details']],
  ['offline.yaml', ['setAirplaneMode: enabled', 'pending-work-screen', 'setAirplaneMode: disabled']],
  ['subflows/authenticate.yaml', ['login-email', 'login-password', 'login-submit', 'MAESTRO_TEST_EMAIL', 'MAESTRO_TEST_PASSWORD']],
]);

const failures = [];
for (const [relativePath, markers] of required) {
  let source = '';
  try {
    source = readFileSync(resolve(FLOW_ROOT, relativePath), 'utf8');
  } catch {
    failures.push(`${relativePath}: required Maestro flow is missing`);
    continue;
  }
  if (!source.startsWith('appId: ${MAESTRO_APP_ID}\n')) {
    failures.push(`${relativePath}: appId must come from MAESTRO_APP_ID`);
  }
  for (const marker of markers) {
    if (!source.includes(marker)) failures.push(`${relativePath}: missing ${marker}`);
  }
  if (/(?:password|api[-_]?key)\s*:\s*(?!\$\{)/i.test(source)) {
    failures.push(`${relativePath}: credentials must never be embedded in a flow`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`[MAESTRO] ${failure}\n`);
  process.exit(1);
}

process.stdout.write(`[MAESTRO] Validated ${required.size} required login, tenant, job, and offline flow files.\n`);
