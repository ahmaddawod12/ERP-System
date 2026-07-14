import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('offline synchronization is foreground-triggered and isolated per user database', async () => {
  const [provider, processor] = await Promise.all([
    readSource('../contexts/OutboxContext.tsx'),
    readSource('../lib/outbox/processor.ts'),
  ]);

  assert.match(provider, /AppState\.addEventListener\('change'/);
  assert.match(provider, /NetInfo\.addEventListener/);
  assert.match(provider, /invalidateUserJobQueries/);
  assert.match(provider, /query\.queryKey\[1\] === userId/);
  assert.match(provider, /query\.queryKey\[3\] === 'jobs'/);
  assert.doesNotMatch(provider, /BackgroundFetch|TaskManager|setInterval/);
  assert.match(processor, /WeakMap<[\s\S]*UserOutboxDatabase,[\s\S]*Promise<OutboxSynchronizationResult>/);
  assert.doesNotMatch(processor, /let activeSync/);
});

test('the SQLCipher outbox remains per-user and staged files have explicit cleanup', async () => {
  const [database, operations, appConfig] = await Promise.all([
    readSource('../lib/outbox/database.ts'),
    readSource('../lib/outbox/operations.ts'),
    readSource('../app.json'),
  ]);

  assert.match(database, /smart-job-outbox-\$\{normalizedUserId\}\.db/);
  assert.match(database, /PRAGMA key/);
  assert.match(database, /PRAGMA cipher_integrity_check/);
  assert.match(operations, /deleteStagedAttachment/);
  assert.match(appConfig, /"useSQLCipher": true/);
});

test('mobile Supabase sessions require verified email and remain in SecureStore', async () => {
  const source = await readSource('../lib/auth/supabase-client.ts');

  assert.match(source, /email_confirmed_at/);
  assert.match(source, /expo-secure-store/);
  assert.doesNotMatch(source, /AsyncStorage|react-native-mmkv/);
});
