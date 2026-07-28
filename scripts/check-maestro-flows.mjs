#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FLOW_ROOT = resolve(ROOT, 'phone_app', '.maestro');
const RELEASE_FLOW_ROOT = resolve(ROOT, 'phone_app', '.maestro-release');
const CI_WORKFLOW = resolve(ROOT, '.github', 'workflows', 'ci.yml');
const RELEASE_WORKFLOW = resolve(ROOT, '.github', 'workflows', 'release-matrices.yml');
const LOCAL_ACTION = resolve(ROOT, '.github', 'actions', 'run-maestro-android', 'action.yml');
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
  if (!/^appId: \$\{MAESTRO_APP_ID\}\r?\n/.test(source)) {
    failures.push(`${relativePath}: appId must come from MAESTRO_APP_ID`);
  }
  for (const marker of markers) {
    if (!source.includes(marker)) failures.push(`${relativePath}: missing ${marker}`);
  }
  if (/(?:password|api[-_]?key)\s*:\s*(?!\$\{)/i.test(source)) {
    failures.push(`${relativePath}: credentials must never be embedded in a flow`);
  }
}

const releaseFlowPath = resolve(RELEASE_FLOW_ROOT, 'reconciliation.yaml');
let releaseFlow = '';
try {
  releaseFlow = readFileSync(releaseFlowPath, 'utf8');
} catch {
  failures.push('.maestro-release/reconciliation.yaml: required release flow is missing');
}
for (const marker of [
  'MAESTRO_RELEASE_JOB_ID',
  'MAESTRO_SECOND_USER_EMAIL',
  'setAirplaneMode: enabled',
  'stopApp',
  'setAirplaneMode: disabled',
  'Everything is synchronized',
  'MAESTRO_RELEASE_JOB_TITLE',
]) {
  if (!releaseFlow.includes(marker)) {
    failures.push(`.maestro-release/reconciliation.yaml: missing ${marker}`);
  }
}
if (/(?:password|api[-_]?key)\s*:\s*(?!\$\{)/i.test(releaseFlow)) {
  failures.push('.maestro-release/reconciliation.yaml: credentials must never be embedded in a flow');
}

const ciWorkflow = readFileSync(CI_WORKFLOW, 'utf8');
const releaseWorkflow = readFileSync(RELEASE_WORKFLOW, 'utf8');
const localAction = readFileSync(LOCAL_ACTION, 'utf8');
const workflowSource = `${ciWorkflow}\n${releaseWorkflow}`;
for (const forbidden of [
  'action-maestro-cloud',
  'MAESTRO_CLOUD_API_KEY',
  'MAESTRO_CLOUD_PROJECT_ID',
  'MAESTRO_CLOUD_APP_BINARY_ID',
]) {
  if (workflowSource.includes(forbidden)) {
    failures.push(`workflows must not depend on paid Maestro Cloud setting ${forbidden}`);
  }
}
for (const requiredMarker of [
  'uses: ./.github/actions/run-maestro-android',
  'FIREBASE_ANDROID_GOOGLE_SERVICES_JSON_BASE64',
  'MOBILE_E2E_API_BASE_URL',
]) {
  if (!workflowSource.includes(requiredMarker)) {
    failures.push(`free Maestro workflow is missing ${requiredMarker}`);
  }
}
for (const requiredMarker of [
  'maestro-cli-2.4.0-linux-aea22ce67ab6718997ec990c58652ede0c2be8f10ac4799039ca3dce3390d634',
  'aea22ce67ab6718997ec990c58652ede0c2be8f10ac4799039ca3dce3390d634',
  'reactivecircus/android-emulator-runner@324029e2f414c084d8b15ba075288885e74aef9c',
  'maestro "${maestro_args[@]}"',
]) {
  if (!localAction.includes(requiredMarker)) {
    failures.push(`free Maestro action is missing ${requiredMarker}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`[MAESTRO] ${failure}\n`);
  process.exit(1);
}

process.stdout.write(`[MAESTRO] Validated ${required.size} PR flows and the release reconciliation flow.\n`);
