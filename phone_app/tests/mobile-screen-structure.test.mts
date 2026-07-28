import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readProjectFile(...segments: string[]) {
  return fs.readFileSync(path.resolve(process.cwd(), ...segments), 'utf8');
}

const screens = [
  {
    path: ['modules', 'documents', 'screens', 'CreateDocument.tsx'],
    maxLines: 1_000,
    modules: ['document-composer-machine', 'CreateDocumentForm', 'CreateDocumentModal'],
  },
  {
    path: ['modules', 'jobs', 'screens', 'FillJob.tsx'],
    maxLines: 700,
    modules: ['fill-job-model', 'fill-job-copy', 'FillJobForm'],
  },
  {
    path: ['modules', 'clients', 'screens', 'ClientBook.tsx'],
    maxLines: 750,
    modules: ['use-clients-infinite', 'client-history-model', 'ClientBookCards', 'ClientFormModalContent'],
  },
  {
    path: ['modules', 'jobs', 'screens', 'Userjob.tsx'],
    maxLines: 750,
    modules: ['jobs-api', 'user-job-model', 'user-job-copy', 'Userjob.styles'],
  },
  {
    path: ['modules', 'inventory', 'screens', 'WorkerInventory.tsx'],
    maxLines: 400,
    modules: ['use-inventory-infinite', 'inventory-list-model', 'InventoryPartRow', 'worker-inventory-copy'],
  },
] as const;

for (const screen of screens) {
  test(`${screen.path.at(-1)} remains a bounded orchestration screen`, () => {
    const source = readProjectFile(...screen.path);
    const lineCount = source.split(/\r?\n/).length;

    assert.ok(
      lineCount <= screen.maxLines,
      `${screen.path.at(-1)} has ${lineCount} lines; move new form/presentation logic into modules before exceeding ${screen.maxLines}`,
    );
    for (const moduleName of screen.modules) {
      assert.match(source, new RegExp(moduleName.replace('.', '\\.')));
    }
  });
}
