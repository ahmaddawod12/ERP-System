import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHECKER = resolve(ROOT, 'scripts', 'check-js-syntax.mjs');

function runChecker(target) {
  return spawnSync(process.execPath, [CHECKER, target], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
}

test('syntax checker validates js, mjs, and cjs while skipping generated dependencies', () => {
  const fixture = mkdtempSync(resolve(tmpdir(), 'smart-job-syntax-'));
  try {
    writeFileSync(resolve(fixture, 'valid.js'), 'export const answer = 42;\n');
    writeFileSync(resolve(fixture, 'valid.mjs'), 'await Promise.resolve();\n');
    writeFileSync(resolve(fixture, 'valid.cjs'), 'module.exports = { answer: 42 };\n');
    mkdirSync(resolve(fixture, 'node_modules'));
    writeFileSync(resolve(fixture, 'node_modules', 'ignored.mjs'), 'export const = broken;\n');

    const result = runChecker(fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\.cjs: 1/);
    assert.match(result.stdout, /\.js: 1/);
    assert.match(result.stdout, /\.mjs: 1/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('syntax checker rejects an invalid mjs file', () => {
  const fixture = mkdtempSync(resolve(tmpdir(), 'smart-job-syntax-'));
  try {
    writeFileSync(resolve(fixture, 'invalid.mjs'), 'export const = broken;\n');
    const result = runChecker(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SyntaxError/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
