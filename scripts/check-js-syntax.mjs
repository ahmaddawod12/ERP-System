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

function walk(target) {
  const resolved = path.resolve(cwd, target);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Path does not exist: ${target}`);
  }
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(resolved)) {
      if (entry === 'node_modules' || entry === '.next' || entry === 'coverage') continue;
      walk(path.join(target, entry));
    }
    return;
  }
  if (stat.isFile() && resolved.endsWith('.js')) {
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

console.log(`Checked JS syntax for ${files.length} files.`);
