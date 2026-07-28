import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error('Usage: node scripts/check-js-syntax.mjs <dir-or-file> [...]');
  process.exit(2);
}

const cwd = process.cwd();
const files = [];
const skippedDirectories = new Set([
  '.expo',
  '.git',
  '.next',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
]);

function walk(target) {
  const resolved = path.resolve(cwd, target);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Path does not exist: ${target}`);
  }
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(resolved)) {
      if (skippedDirectories.has(entry)) continue;
      walk(path.join(target, entry));
    }
    return;
  }
  if (stat.isFile() && /\.(?:cjs|js|mjs)$/.test(resolved)) {
    files.push(resolved);
  }
}

for (const root of roots) {
  walk(root);
}

for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `Syntax check failed: ${file}\n`);
    process.exit(result.status || 1);
  }
}

const extensionCounts = files.reduce((counts, file) => {
  const extension = path.extname(file);
  counts.set(extension, (counts.get(extension) ?? 0) + 1);
  return counts;
}, new Map());
const summary = [...extensionCounts.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([extension, count]) => `${extension}: ${count}`)
  .join(', ');
console.log(`Checked JS syntax for ${files.length} files${summary ? ` (${summary})` : ''}.`);
