import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const packageRoot = process.cwd();
const textExtension = /\.(?:[cm]?[jt]sx?|json|md)$/;
const ignoredDirectories = new Set(['node_modules', '.expo', 'android', 'ios']);

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(resolved));
    else if (textExtension.test(entry.name)) files.push(resolved);
  }
  return files;
}

test('Hebrew and Arabic fixtures round-trip as verified UTF-8', async () => {
  const fixturePath = path.join(packageRoot, 'tests', 'fixtures', 'rtl-copy.json');
  const bytes = await readFile(fixturePath);
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const fixture = JSON.parse(decoded) as Record<string, string>;

  assert.equal(fixture.he, 'עברית — שלום');
  assert.equal(fixture.ar, 'العربية — مرحباً');
  assert.equal(fixture.currency, '₪');
  assert.equal(fixture.separator, '·');
  assert.equal(fixture.success, '✅');
});

test('mobile source contains no common UTF-8 mojibake markers', async () => {
  const files = await sourceFiles(packageRoot);
  const failures: string[] = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (/[\u00c3\u00c2\u00e2\u00f0\ufffd]/u.test(source)) failures.push(path.relative(packageRoot, file));
  }
  assert.deepEqual(failures, []);
});

test('mobile source routes console output through the redacting logger', async () => {
  const files = await sourceFiles(packageRoot);
  const failures: string[] = [];
  for (const file of files) {
    const relative = path.relative(packageRoot, file).replaceAll('\\', '/');
    if (relative === 'utils/logger.ts' || relative.startsWith('tests/')) continue;
    const source = await readFile(file, 'utf8');
    if (/console\.(?:debug|info|log|warn|error)\s*\(/.test(source)) failures.push(relative);
  }
  assert.deepEqual(failures, []);
});
