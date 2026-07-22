#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const shaReference = /@[0-9a-f]{40}(?:\s+#.*)?$/;

for (const name of readdirSync(resolve(ROOT, '.github', 'workflows'))) {
  if (!/\.ya?ml$/.test(name)) continue;
  const relativePath = `.github/workflows/${name}`;
  const source = readFileSync(resolve(ROOT, relativePath), 'utf8');
  source.split(/\r?\n/).forEach((line, index) => {
    const match = line.match(/^\s*-?\s*uses:\s*(\S.*)$/);
    if (!match || match[1].startsWith('./')) return;
    if (!shaReference.test(match[1])) {
      failures.push(`${relativePath}:${index + 1}: GitHub Action must use a 40-character commit SHA`);
    }
  });
}

const dockerfiles = [
  'website/Dockerfile',
  'cloudrun-api/Dockerfile',
  'cloudrun-tax/Dockerfile',
  'cloudrun-pdf/Dockerfile',
  'cloudrun-email/Dockerfile',
  'cloudrun-archiver/Dockerfile',
  'local-platform/adapter/Dockerfile',
];
for (const relativePath of dockerfiles) {
  const source = readFileSync(resolve(ROOT, relativePath), 'utf8');
  source.split(/\r?\n/).forEach((line, index) => {
    if (/^FROM\s+/i.test(line) && !/@sha256:[0-9a-f]{64}(?:\s|$)/.test(line)) {
      failures.push(`${relativePath}:${index + 1}: container base must use an immutable sha256 digest`);
    }
  });
}

const composePath = 'compose.local.yml';
readFileSync(resolve(ROOT, composePath), 'utf8').split(/\r?\n/).forEach((line, index) => {
  if (/^\s+image:\s+/.test(line) && !/@sha256:[0-9a-f]{64}\s*$/.test(line)) {
    failures.push(`${composePath}:${index + 1}: Compose image must use an immutable sha256 digest`);
  }
});

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`[SUPPLY CHAIN] ${failure}\n`);
  process.exit(1);
}

process.stdout.write(`[SUPPLY CHAIN] Pinned Actions and ${dockerfiles.length} Dockerfile bases passed.\n`);
