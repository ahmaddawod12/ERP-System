import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readProjectFile(...segments: string[]) {
  return fs.readFileSync(path.resolve(process.cwd(), ...segments), 'utf8');
}

test('website backend service drains clients through paginated read-model pages', () => {
  const source = readProjectFile('src', 'lib', 'services', 'backend-service.ts');

  assert.match(source, /export async function listClients/);
  assert.match(source, /pageSize: opts\?\.pageSize \?\? 200/);
  assert.match(source, /if \(opts\?\.search\) body\.search = opts\.search/);
  assert.match(source, /do \{[\s\S]*fetchClientPage\(afterCursor\)[\s\S]*\} while \(afterCursor\)/);
});

test('website app imports the backend service instead of legacy firestore service name', () => {
  const appFiles = [
    readProjectFile('src', 'app', 'app', 'clients', 'page-client.tsx'),
    readProjectFile('src', 'app', 'app', 'documents', 'page-client.tsx'),
    readProjectFile('src', 'app', 'app', 'jobs', 'page-client.tsx'),
    readProjectFile('src', 'app', 'app', 'inventory', 'page-client.tsx'),
  ].join('\n');

  assert.doesNotMatch(appFiles, /firestore-service/);
  assert.match(appFiles, /backend-service/);
});

test('website personal inventory read remains company scoped', () => {
  const service = readProjectFile('src', 'lib', 'services', 'backend-service.ts');
  const inventoryPage = readProjectFile('src', 'app', 'app', 'inventory', 'page-client.tsx');

  assert.match(service, /export async function getUserInventory\(companyId: string, uid: string\)/);
  assert.match(service, /kind: "inventory",[\s\S]*companyId,[\s\S]*scope: "user",[\s\S]*targetUid: uid/);
  assert.match(inventoryPage, /getUserInventory\(companyId, uid\)/);
});
