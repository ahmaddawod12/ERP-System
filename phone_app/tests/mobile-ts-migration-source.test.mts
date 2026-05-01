import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readProjectFile(...segments: string[]) {
  return fs.readFileSync(path.resolve(process.cwd(), ...segments), 'utf8');
}

test('typed job and document screens do not regress to ts-nocheck', () => {
  const documentHistory = readProjectFile('modules', 'documents', 'DocumentHistory.tsx');
  const createDocument = readProjectFile('modules', 'documents', 'CreateDocument.tsx');
  const useTaxInvoiceSubmission = readProjectFile('modules', 'documents', 'useTaxInvoiceSubmission.ts');
  const userJob = readProjectFile('modules', 'solojob', 'Userjob.tsx');
  const workerJob = readProjectFile('modules', 'team', 'Workerjob.tsx');
  const fillJob = readProjectFile('modules', 'shared', 'FillJob.tsx');

  assert.doesNotMatch(documentHistory, /@ts-nocheck/);
  assert.doesNotMatch(createDocument, /@ts-nocheck/);
  assert.doesNotMatch(useTaxInvoiceSubmission, /@ts-nocheck/);
  assert.doesNotMatch(userJob, /@ts-nocheck/);
  assert.doesNotMatch(workerJob, /@ts-nocheck/);
  assert.doesNotMatch(fillJob, /@ts-nocheck/);
});

test('auth MMKV storage does not use a hardcoded encryption key literal', () => {
  const mmkvStorage = readProjectFile('contexts', 'mmkv-storage.ts');

  assert.doesNotMatch(mmkvStorage, /encryptionKey:\s*['"]smart-job-auth-v1['"]/);
  assert.doesNotMatch(mmkvStorage, /AUTH_STORAGE_KEY_SEED/);
  assert.doesNotMatch(mmkvStorage, /storage\.getString\([^\n]*AUTH_STORAGE_KEY/);
  assert.match(mmkvStorage, /Constants\.expoConfig\?/);
  assert.match(mmkvStorage, /Device\.(brand|manufacturer|modelId|modelName)/);
});
