import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('encrypted mobile resources serialize first-use key and store creation', async () => {
  const [persistence, attachments, database] = await Promise.all([
    readSource('../lib/query/persistence.ts'),
    readSource('../lib/outbox/attachments.ts'),
    readSource('../lib/outbox/database.ts'),
  ]);

  assert.match(persistence, /encryptionKeyPromises = new Map<string, Promise<string>>/);
  assert.match(persistence, /encryptedStorePromises = new Map<string, Promise<MMKV>>/);
  assert.match(persistence, /encryptedStorePromises\.get\(normalized\)/);
  assert.match(persistence, /encryptedStoreReleasePromises = new Map<string, Promise<void>>/);
  assert.match(persistence, /encryptedStorePromises\.delete\(normalized\)/);
  assert.match(persistence, /encryptionKeyPromises\.delete\(normalized\)/);
  assert.match(persistence, /store\.dispose\(\)/);
  assert.match(persistence, /encryptionType: 'AES-256'/);
  assert.match(attachments, /fileKeyPromises = new Map<string, Promise<AESEncryptionKey>>/);
  assert.match(attachments, /fileKeyPromises\.get\(normalized\)/);
  assert.match(database, /databaseKeyPromises = new Map<string, Promise<string>>/);
  assert.match(database, /databaseKeyPromises\.get\(normalized\)/);
  assert.match(database, /getAllAsync<Record<string, unknown>>\([\s\S]*cipher_version/);
  assert.match(database, /requireSqlCipherVersion\(versionRows\)/);
  assert.match(database, /getAllAsync<Record<string, unknown>>\([\s\S]*cipher_integrity_check/);
  assert.doesNotMatch(database, /execAsync\('PRAGMA cipher_integrity_check'\)/);
});

test('tenant lifecycle rejects stale identity work and serializes selection', async () => {
  const tenant = await readSource('../contexts/TenantContext.tsx');

  assert.match(tenant, /cancelUserRequests\(userId\)/);
  assert.match(tenant, /identityGenerationRef/);
  assert.match(tenant, /loadGenerationRef/);
  assert.match(tenant, /selectionQueueRef/);
  assert.match(tenant, /fetchWorkspaces\(userId\)/);
  assert.match(
    tenant,
    /setStatus\('loading'\)[\s\S]*await writeLastCompanyPreference\(requestedUserId, selected\.companyId\)[\s\S]*setWorkspace\(selected\)[\s\S]*setStatus\('ready'\)/,
  );
});

test('query persistence uses primitive scope and cannot roll newer data backward', async () => {
  const [provider, persistence] = await Promise.all([
    readSource('../contexts/QueryProvider.tsx'),
    readSource('../lib/query/persistence.ts'),
  ]);

  assert.match(provider, /const uid = user\?\.id \?\? null/);
  assert.match(provider, /const companyId = workspace\?\.companyId \?\? null/);
  assert.match(provider, /\}, \[companyId, uid\]\)/);
  assert.doesNotMatch(provider, /\}, \[user, workspace\]\)/);
  assert.match(persistence, /getQueryState\(query\.queryKey\)/);
  assert.match(persistence, /current\.dataUpdatedAt >= restoredUpdatedAt/);
  assert.match(persistence, /clearTimeout\(timer\)[\s\S]*flush\(\)/);
  assert.match(provider, /evictUserQueries\(uid\)/);
  assert.match(provider, /evictTenantQueries\(uid, companyId\)/);
  assert.match(provider, /releaseEncryptedQueryPersistence\(uid\)/);
  assert.match(provider, /cancelQueries\(\{ predicate \}\)[\s\S]*removeQueries\(\{ predicate \}\)/);
});

test('legacy cache bootstrap is bound to primitive selected-workspace identity', async () => {
  const appEntry = await readSource('../modules/root/AppEntry.tsx');

  assert.match(appEntry, /const workspaceCompanyId = workspace\?\.companyId \?\? null/);
  assert.match(appEntry, /const workspaceRole = workspace\?\.role \?\? null/);
  assert.match(
    appEntry,
    /initializeCache\([\s\S]*nextUser\.uid,[\s\S]*selectedCompanyId,[\s\S]*selectedRole/,
  );
  assert.match(appEntry, /workspaceCompanyId,[\s\S]*workspaceRole,[\s\S]*\]\);/);
  assert.doesNotMatch(appEntry, /\[router, initializeCache, alert, language, workspace\]/);
});

test('API requests stay on the configured origin and bind to the expected user', async () => {
  const client = await readSource('../lib/api/client.ts');

  assert.match(client, /AUTH_IDENTITY_CHANGED_CODE = 'AUTH_IDENTITY_CHANGED'/);
  assert.match(client, /export function cancelUserRequests\(uid: string\)/);
  assert.match(client, /controller\.abort\(AUTH_IDENTITY_CHANGED_CODE\)/);
  assert.match(client, /function apiRequestUrl\(path: string\)/);
  assert.match(client, /\^\\\/api\\\/v1/);
  assert.match(client, /resolved\.origin !== base\.origin/);
  assert.match(client, /beforeRefresh = await restoreSupabaseSession\(\)/);
  assert.match(client, /afterRefresh = await restoreSupabaseSession\(\)/);
  assert.match(client, /return afterRefresh\.access_token/);
  assert.match(client, /fetchWorkspaces\(uid: string\)/);
});

test('Supabase refresh single-flight cannot be reused across user identities', async () => {
  const auth = await readSource('../lib/auth/supabase-client.ts');

  assert.match(auth, /refreshFlight: \{[\s\S]*readonly userId: string/);
  assert.match(auth, /refreshSessionSingleFlight\(expectedUserId: string\)/);
  assert.match(auth, /active\.userId === expectedUserId/);
  assert.match(auth, /data\.session\?\.user\.id === expectedUserId/);
  assert.match(auth, /refreshSessionSingleFlight\(session\.user\.id\)/);
});

test('outbox uploads never materialize decrypted attachments on disk', async () => {
  const upload = await readSource('../lib/outbox/upload.ts');

  assert.match(upload, /const bytes = new Uint8Array\(new ArrayBuffer\(attachment\.sizeBytes\)\)/);
  assert.match(upload, /body: plaintextBytes\.buffer/);
  assert.match(upload, /plaintextBytes\.fill\(0\)/);
  assert.doesNotMatch(upload, /Paths\.cache|FileMode|createPlaintextUploadFile/);
});
