#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const violations = [];

function read(relativePath) {
  try {
    return readFileSync(resolve(ROOT, relativePath), 'utf8');
  } catch {
    violations.push(`${relativePath}: required performance-critical file is missing`);
    return '';
  }
}

function requirePattern(relativePath, pattern, explanation) {
  const source = read(relativePath);
  if (source && !pattern.test(source)) {
    violations.push(`${relativePath}: ${explanation}`);
  }
}

function rejectPattern(relativePath, pattern, explanation) {
  const source = read(relativePath);
  if (source && pattern.test(source)) {
    violations.push(`${relativePath}: ${explanation}`);
  }
}

function walkCode(relativeDirectory) {
  const directory = resolve(ROOT, relativeDirectory);
  const results = [];
  try {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['.expo', '.next', 'dist', 'node_modules'].includes(entry.name)) continue;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkCode(relative(ROOT, absolutePath)));
      } else if (['.js', '.mjs', '.ts', '.tsx'].includes(extname(entry.name))) {
        results.push(relative(ROOT, absolutePath).replaceAll('\\', '/'));
      }
    }
  } catch {
    violations.push(`${relativeDirectory}: required client source directory is missing`);
  }
  return results;
}

const contractPath = 'packages/api-contracts/src/index.ts';
for (const domain of ['JOB', 'CLIENT', 'WORKER', 'INVENTORY', 'DOCUMENT']) {
  requirePattern(
    contractPath,
    new RegExp(`export const DEFAULT_${domain}_PAGE_SIZE = 50;`),
    `${domain.toLowerCase()} default page size must remain 50`,
  );
  requirePattern(
    contractPath,
    new RegExp(`export const MAX_${domain}_PAGE_SIZE = 200;`),
    `${domain.toLowerCase()} maximum page size must remain 200`,
  );
  requirePattern(
    contractPath,
    new RegExp(`pageSize:[\\s\\S]{0,120}max\\(MAX_${domain}_PAGE_SIZE\\)`),
    `${domain.toLowerCase()} query validation must enforce its maximum page size`,
  );
}

for (const domain of ['clients', 'documents', 'inventory', 'jobs', 'workers']) {
  const constant = `WEBSITE_${domain.toUpperCase()}_PAGE_SIZE`;
  const relativePath = `website/src/lib/dal/${domain}-query.ts`;
  requirePattern(
    relativePath,
    new RegExp(`export const ${constant} = 25;`),
    'the server-rendered first page must remain bounded to 25 rows',
  );
  requirePattern(
    relativePath,
    /afterCursor/,
    'the query must preserve opaque cursor pagination',
  );
  requirePattern(
    relativePath,
    /queryString\.set\("afterCursor", afterCursor\)/,
    'the next-page request must forward the opaque cursor',
  );
}

for (const domain of ['clients', 'documents', 'inventory', 'jobs', 'workers']) {
  const relativePath = `phone_app/modules/${domain}/lib/use-${domain}-infinite.ts`;
  requirePattern(
    relativePath,
    /afterCursor:\s*pageParam/,
    'the infinite query must request the next opaque cursor page',
  );
  requirePattern(
    relativePath,
    /getNextPageParam:\s*\(lastPage\)\s*=>\s*lastPage\.nextCursor\s*\?\?\s*undefined/,
    'the infinite query must stop when nextCursor is null',
  );
}

for (const relativePath of [
  'phone_app/utils/read-model.ts',
  'phone_app/contexts/cache-fetchers.ts',
]) {
  requirePattern(
    relativePath,
    /const MAX_CURSOR_WINDOW_PAGES = 5;/,
    'legacy aggregate windows must remain capped at five API pages',
  );
  requirePattern(
    relativePath,
    /for \(let i = 0; i < MAX_CURSOR_WINDOW_PAGES; i\+\+\)/,
    'aggregate reads must enforce the page-count cap in the loop',
  );
}
requirePattern(
  'phone_app/utils/read-model.ts',
  /const MAX_CURSOR_WINDOW_ITEMS = 1_000;/,
  'legacy aggregate reads must remain capped at 1,000 items',
);

requirePattern(
  'packages/db/jobs.ts',
  /sql`\(\$\{dateColumn\}, \$\{jobs\.id\}\) < \(\$\{afterCursor\.dateValue\}, \$\{afterCursor\.id\}\)`/,
  'job pagination must use the stable (date, id) cursor tuple',
);
requirePattern(
  'packages/db/jobs.ts',
  /const fetchLimit = effectiveLimit \+ 1;/,
  'job pagination must fetch one extra row to determine nextCursor',
);
requirePattern(
  'packages/db/jobs.ts',
  /\.orderBy\(desc\(dateColumn\), desc\(jobs\.id\)\)[\s\S]{0,80}\.limit\(fetchLimit\)/,
  'job pagination order and limit must use the same composite cursor fields',
);
requirePattern(
  'packages/db/documents.ts',
  /\(\$\{dateColumn\}, d\.id\) < \(\$\{afterCursor\.dateValue\}, \$\{afterCursor\.id\}\)/,
  'document pagination must use the stable (date, id) cursor tuple',
);
requirePattern(
  'packages/db/documents.ts',
  /ORDER BY \$\{dateColumn\} DESC, d\.id DESC[\s\S]{0,80}LIMIT \$\{effectiveLimit \+ 1\}/,
  'document pagination must fetch one extra row in composite-cursor order',
);

const clientSourceFiles = [
  'website/src',
  'phone_app/app',
  'phone_app/components',
  'phone_app/contexts',
  'phone_app/modules',
  'phone_app/utils',
].flatMap(walkCode);
for (const relativePath of clientSourceFiles) {
  rejectPattern(
    relativePath,
    /(?:limit|pageSize)\s*:\s*10_?000\b/,
    'client-facing reads must not request an unbounded 10,000-row page',
  );
}

if (violations.length > 0) {
  for (const violation of violations) {
    process.stderr.write(`[PERF BUDGET] ${violation}\n`);
  }
  process.stderr.write(`[PERF BUDGET] Failed with ${violations.length} violation(s).\n`);
  process.exit(1);
}

process.stdout.write('[PERF BUDGET] Blocking pagination and read-bound checks passed.\n');
