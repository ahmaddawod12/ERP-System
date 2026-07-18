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
  const supabaseClient = readProjectFile('lib', 'auth', 'supabase-client.ts');

  assert.doesNotMatch(mmkvStorage, /encryptionKey:\s*['"]smart-job-auth-v1['"]/);
  assert.doesNotMatch(mmkvStorage, /AUTH_STORAGE_KEY_SEED/);
  assert.doesNotMatch(mmkvStorage, /storage\.getString\([^\n]*AUTH_STORAGE_KEY/);
  assert.doesNotMatch(mmkvStorage, /EXPO_PUBLIC_MMKV_AUTH_KEY/);
  assert.doesNotMatch(firebase, /authStorage\.(getString|set|remove)/);
  assert.match(supabaseClient, /expo-secure-store/);
  assert.match(supabaseClient, /SecureStore\.setItemAsync/);
  assert.match(supabaseClient, /SecureStore\.getItemAsync/);
  assert.match(supabaseClient, /EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(supabaseClient, /refreshSessionSingleFlight/);
  assert.match(supabaseClient, /AppState\.addEventListener/);
  assert.doesNotMatch(supabaseClient, /EXPO_PUBLIC_SUPABASE_ANON_KEY/);
});

test('read-model list helpers use Cloud API with paginated draining', () => {
  const readModel = readProjectFile('utils', 'read-model.ts');

  assert.match(readModel, /export async function fetchCompanyJobsPage/);
  assert.match(readModel, /export async function fetchCompanyDocumentsPage/);
  assert.match(readModel, /drainPages/);
  assert.match(readModel, /items\.map\(mapJobSummary\)/);
  assert.match(readModel, /items\.map\(mapDocumentSummary\)/);
  assert.doesNotMatch(readModel, /callHttpFunction/);
  assert.doesNotMatch(readModel, /fetchRecordById/);
});

test('metadata-only job editing leaves part usage and inventory unchanged', () => {
  const editJob = readProjectFile('modules', 'jobs', 'screens', 'EditJob.tsx');

  assert.doesNotMatch(editJob, /updateInventoryV1|replaceParts|fetchRecordById/);
  assert.doesNotMatch(editJob, /partsUsed:\s*editingJob\.partsUsed/);
});

test('mobile cache uses Cloud API and avoids Edge callers', () => {
  const cacheContext = readProjectFile('contexts', 'CacheContext.tsx');
  const cacheFetchers = readProjectFile('contexts', 'cache-fetchers.ts');
  const archiveQuery = readProjectFile('hooks', 'useArchiveQuery.ts');
  const logger = readProjectFile('utils', 'logger.ts');
  const packageJson = readProjectFile('package.json');

  assert.match(logger, /if \(isDevRuntime\)/);
  assert.match(cacheContext, /logger\.debug/);
  assert.doesNotMatch(cacheContext, /console\.log/);
  assert.doesNotMatch(cacheFetchers, /console\.log/);
  assert.doesNotMatch(archiveQuery, /console\.log/);
  assert.doesNotMatch(packageJson, /@react-native-async-storage\/async-storage/);
});

test('NotifyKit replaces archived Notifee without taking over RNFirebase remote events', () => {
  const notifications = readProjectFile('utils', 'notifications.ts');
  const packageJson = JSON.parse(readProjectFile('package.json')) as {
    dependencies?: Record<string, string>;
    expo?: unknown;
  };

  assert.equal(packageJson.dependencies?.['react-native-notify-kit'], '10.4.8');
  assert.equal(packageJson.dependencies?.['@notifee/react-native'], undefined);
  assert.match(notifications, /from 'react-native-notify-kit'/);
  assert.doesNotMatch(notifications, /from '@notifee\/react-native'/);
  assert.match(
    notifications,
    /setNotificationConfig\(\{[\s\S]*ios:\s*\{\s*handleRemoteNotifications:\s*false\s*\}/,
  );
  assert.equal(packageJson.expo, undefined);
});
