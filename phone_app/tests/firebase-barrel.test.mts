import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readProjectFile(...segments: string[]) {
  return fs.readFileSync(path.resolve(process.cwd(), ...segments), 'utf8');
}

test('mobile native Firebase modules are isolated from Supabase auth', () => {
  const authTransport = readProjectFile('lib', 'auth', 'transport.ts');
  const messaging = readProjectFile('lib', 'notifications', 'firebase-messaging.ts');
  const crashlytics = readProjectFile('lib', 'firebase-crashlytics.ts');
  const packageJson = JSON.parse(readProjectFile('package.json')) as {
    dependencies?: Record<string, string>;
  };
  const appJson = JSON.parse(readProjectFile('app.json')) as {
    expo?: { plugins?: unknown[] };
  };

  assert.match(authTransport, /supabase-client/);
  assert.doesNotMatch(authTransport, /@react-native-firebase/);
  assert.match(messaging, /@react-native-firebase\/messaging/);
  assert.match(crashlytics, /@react-native-firebase\/crashlytics/);
  assert.equal(packageJson.dependencies?.['@react-native-firebase/storage'], undefined);
  assert.equal(typeof packageJson.dependencies?.['@react-native-firebase/crashlytics'], 'string');
  assert.equal(appJson.expo?.plugins?.includes('@react-native-firebase/crashlytics'), true);
  assert.equal(fs.existsSync(path.resolve(process.cwd(), 'firebase.ts')), false);
});

test('mobile modules do not import direct firestore SDK writes', () => {
  const cacheContext = readProjectFile('contexts', 'CacheContext.tsx');
  const userJob = readProjectFile('modules', 'jobs', 'screens', 'Userjob.tsx');
  const documentHistory = readProjectFile('modules', 'documents', 'screens', 'DocumentHistory.tsx');
  const workerJob = readProjectFile('modules', 'workers', 'screens', 'Workerjob.tsx');

  assert.doesNotMatch(cacheContext, /@react-native-firebase\/firestore/);
  assert.doesNotMatch(userJob, /@react-native-firebase\/firestore/);
  assert.doesNotMatch(documentHistory, /@react-native-firebase\/firestore/);
  assert.doesNotMatch(workerJob, /@react-native-firebase\/firestore/);

  assert.doesNotMatch(cacheContext, /from ['"].*firebase['"]/);
  assert.doesNotMatch(userJob, /from ['"].*firebase['"]/);
  assert.doesNotMatch(documentHistory, /from ['"].*firebase['"]/);
  assert.doesNotMatch(workerJob, /from ['"].*firebase['"]/);
});

test('mobile cache fetchers use backend naming for SQL read-model data', () => {
  const cacheFetchers = readProjectFile('contexts', 'cache-fetchers.ts');
  const cacheContext = readProjectFile('contexts', 'CacheContext.tsx');

  assert.match(cacheFetchers, /export async function fetchDataFromBackend/);
  assert.match(cacheContext, /fetchDataFromBackend as _fetchDataFromBackend/);
  assert.doesNotMatch(cacheFetchers, /fetchDataFromFirebase/);
  assert.doesNotMatch(cacheContext, /fetchDataFromFirebase/);
});
