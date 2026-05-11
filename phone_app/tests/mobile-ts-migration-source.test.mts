import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readProjectFile(...segments: string[]) {
  return fs.readFileSync(path.resolve(process.cwd(), ...segments), 'utf8');
}

test('typed job and document screens do not regress to ts-nocheck', () => {
  const documentHistory = readProjectFile('modules', 'documents', 'screens', 'DocumentHistory.tsx');
  const createDocument = readProjectFile('modules', 'documents', 'screens', 'CreateDocument.tsx');
  const useTaxInvoiceSubmission = readProjectFile('modules', 'documents', 'hooks', 'useTaxInvoiceSubmission.ts');
  const userJob = readProjectFile('modules', 'jobs', 'screens', 'Userjob.tsx');
  const workerJob = readProjectFile('modules', 'workers', 'screens', 'Workerjob.tsx');
  const fillJob = readProjectFile('modules', 'jobs', 'screens', 'FillJob.tsx');

  assert.doesNotMatch(documentHistory, /@ts-nocheck/);
  assert.doesNotMatch(createDocument, /@ts-nocheck/);
  assert.doesNotMatch(useTaxInvoiceSubmission, /@ts-nocheck/);
  assert.doesNotMatch(userJob, /@ts-nocheck/);
  assert.doesNotMatch(workerJob, /@ts-nocheck/);
  assert.doesNotMatch(fillJob, /@ts-nocheck/);
});

test('auth tokens are stored in SecureStore instead of MMKV-derived keys', () => {
  const mmkvStorage = readProjectFile('contexts', 'mmkv-storage.ts');
  const firebase = readProjectFile('firebase.ts');

  assert.doesNotMatch(mmkvStorage, /encryptionKey:\s*['"]smart-job-auth-v1['"]/);
  assert.doesNotMatch(mmkvStorage, /AUTH_STORAGE_KEY_SEED/);
  assert.doesNotMatch(mmkvStorage, /storage\.getString\([^\n]*AUTH_STORAGE_KEY/);
  assert.doesNotMatch(mmkvStorage, /EXPO_PUBLIC_MMKV_AUTH_KEY/);
  assert.doesNotMatch(firebase, /authStorage\.(getString|set|remove)/);
  assert.match(firebase, /expo-secure-store/);
  assert.match(firebase, /SecureStore\.setItemAsync/);
  assert.match(firebase, /SecureStore\.getItemAsync/);
});

test('read-model list helpers unwrap paginated items while preserving page helpers', () => {
  const readModel = readProjectFile('utils', 'read-model.ts');

  assert.match(readModel, /type ReadModelPage/);
  assert.match(readModel, /export async function fetchCompanyJobsPage/);
  assert.match(readModel, /export async function fetchCompanyDocumentsPage/);
  assert.match(readModel, /Array\.isArray\(result\?\.items\) \? result\.items : \[\]/);
  assert.doesNotMatch(readModel, /return callHttpFunction<any\[\]>\('readModelV1', \{\s*kind: 'jobs'/);
  assert.doesNotMatch(readModel, /return callHttpFunction<any\[\]>\('readModelV1', \{\s*kind: 'documents'/);
});

test('mobile cache debug output uses dev-only logger and avoids AsyncStorage runtime imports', () => {
  const cacheContext = readProjectFile('contexts', 'CacheContext.tsx');
  const cacheFetchers = readProjectFile('contexts', 'cache-fetchers.ts');
  const archiveQuery = readProjectFile('hooks', 'useArchiveQuery.ts');
  const logger = readProjectFile('utils', 'logger.ts');
  const packageJson = readProjectFile('package.json');

  assert.match(logger, /if \(isDevRuntime\)/);
  assert.match(cacheContext, /logger\.debug/);
  assert.match(cacheFetchers, /logger\.debug/);
  assert.match(archiveQuery, /logger\.debug/);
  assert.doesNotMatch(cacheContext, /console\.log/);
  assert.doesNotMatch(cacheFetchers, /console\.log/);
  assert.doesNotMatch(archiveQuery, /console\.log/);
  assert.doesNotMatch(packageJson, /@react-native-async-storage\/async-storage/);
});
