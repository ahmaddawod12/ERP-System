#!/usr/bin/env node
/**
 * check-perf-budget.mjs
 *
 * Non-blocking performance budget checks run in CI.
 * Violations are printed as warnings; the script exits 0 to keep CI green
 * while the warnings remain visible in the run log.
 *
 * Checks:
 *  1. No unbounded list calls (limit === 10000 hard-coded in callers).
 *  2. No bare `kind: "jobs"` or `kind: "documents"` fetch without a `limit`
 *     field in website service layer.
 *  3. No bare `kind: 'jobs'` / `kind: 'documents'` callHttpFunction calls
 *     in mobile cache-fetchers without a `limit` field.
 *  4. Each paginated read function in packages/db exports a `nextCursor`
 *     in its return shape (text-level heuristic).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

let warnings = 0;

function warn(msg) {
  console.warn(`[PERF BUDGET] WARNING: ${msg}`);
  warnings++;
}

function readText(filePath) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function walkFiles(dir, ext, results = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.next') continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walkFiles(full, ext, results);
    } else if (full.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

// ─── Check 1: No hard-coded limit:10000 in caller code ───────────────────────
const callerDirs = [
  join(ROOT, 'website', 'src'),
  join(ROOT, 'phone_app'),
  join(ROOT, 'supabase', 'functions'),
];

for (const dir of callerDirs) {
  const files = [
    ...walkFiles(dir, '.ts'),
    ...walkFiles(dir, '.tsx'),
    ...walkFiles(dir, '.js'),
  ];
  for (const file of files) {
    const text = readText(file);
    // Flag any explicit limit: 10000 in read-model caller code
    if (/limit\s*:\s*10000/.test(text)) {
      warn(`Hard-coded limit:10000 found in caller: ${file.replace(ROOT, '.')}`);
    }
  }
}

// ─── Check 2: Website listJobs/listDocuments missing limit field ──────────────
const websiteService = join(ROOT, 'website', 'src', 'lib', 'services', 'backend-service.ts');
const wsText = readText(websiteService);

// Look for fetchReadModel calls with kind:"jobs" or kind:"documents" without a limit
const jobsFetchNoLimit = /fetchReadModel[^}]*kind:\s*["']jobs["'][^}]*\}/.test(wsText) &&
  !/fetchReadModel[^}]*kind:\s*["']jobs["'][^}]*limit[^}]*\}/.test(wsText);
if (jobsFetchNoLimit) {
  warn(`website backend-service.ts: fetchReadModel for 'jobs' has no limit/cursor param — add pagination.`);
}

const docsFetchNoLimit = /fetchReadModel[^}]*kind:\s*["']documents["'][^}]*\}/.test(wsText) &&
  !/fetchReadModel[^}]*kind:\s*["']documents["'][^}]*limit[^}]*\}/.test(wsText);
if (docsFetchNoLimit) {
  warn(`website backend-service.ts: fetchReadModel for 'documents' has no limit/cursor param — add pagination.`);
}

// ─── Check 3: Mobile cache-fetchers missing limit on jobs/documents ───────────
const mobileFetchers = join(ROOT, 'phone_app', 'contexts', 'cache-fetchers.ts');
const mfText = readText(mobileFetchers);

// bootstrap with includeCollections:true fetches broad collections — keep mobile on cursor pages.
if (/readBootstrap\([^)]*,\s*true\s*\)/.test(mfText)) {
  warn(`phone_app/contexts/cache-fetchers.ts: bootstrap with includeCollections:true is still used — use paginated jobs/documents fetch instead.`);
}

const readModel = join(ROOT, 'supabase', 'functions', 'read-model', 'index.ts');
const rmText = readText(readModel);
if (/const userInventory = await getUserInventoryParts[\s\S]*if \(countOnly\)/.test(rmText) ||
    /const companyInventory = await getCompanyInventoryParts[\s\S]*if \(countOnly\)/.test(rmText)) {
  warn(`supabase/functions/read-model/index.ts: countOnly still loads full inventory payloads before returning counts.`);
}

// ─── Check 4: packages/db list functions return nextCursor ───────────────────
const dbJobs = join(ROOT, 'packages', 'db', 'jobs.ts');
const dbDocs = join(ROOT, 'packages', 'db', 'documents.ts');
const dbReadModel = join(ROOT, 'packages', 'db', 'read-model.ts');

for (const [label, file] of [['packages/db/jobs.ts', dbJobs], ['packages/db/documents.ts', dbDocs], ['packages/db/read-model.ts', dbReadModel]]) {
  const text = readText(file);
  if (/listCompany(Jobs|Documents)/.test(text) && !/nextCursor/.test(text)) {
    warn(`${label}: listCompanyJobs/listCompanyDocuments does not return nextCursor — cursor-based pagination not yet implemented.`);
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────
if (warnings === 0) {
  console.log('[PERF BUDGET] All checks passed.');
} else {
  console.warn(`[PERF BUDGET] ${warnings} warning(s) found. Fix before promoting to blocking.`);
}
// Always exit 0 — non-blocking budget check.
process.exit(0);
