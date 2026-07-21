const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexSource = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');
const pubsubAuthSource = fs.readFileSync(path.resolve(__dirname, '../pubsub-auth.js'), 'utf8');
const workerStoreSource = fs.readFileSync(path.resolve(__dirname, '../worker-store.js'), 'utf8');
const pageSecuritySource = fs.readFileSync(path.resolve(__dirname, '../page-security.js'), 'utf8');
const templateSource = fs.readFileSync(path.resolve(__dirname, '../htmlTemplate.js'), 'utf8');

function resolvePackageFile(name) {
  for (const candidate of [path.resolve(__dirname, '..', name), path.resolve(__dirname, '..', '..', name)]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Unable to resolve ${name} from the PDF package`);
}

const dockerfileSource = fs.readFileSync(resolvePackageFile('Dockerfile'), 'utf8');

function resolveRepoRoot() {
  for (const candidate of [path.resolve(__dirname, '..', '..'), path.resolve(__dirname, '..', '..', '..')]) {
    if (fs.existsSync(path.join(candidate, 'packages', 'db', 'migrations'))) return candidate;
  }
  throw new Error('Unable to resolve repository root');
}

test('Pub/Sub verification fails closed when allowlist or OIDC checks fail', () => {
  assert.match(indexSource, /PUBSUB_ALLOWED_SERVICE_ACCOUNTS.length === 0/);
  assert.match(pubsubAuthSource, /Service account allowlist not configured/);
  assert.match(pubsubAuthSource, /verifySelfSignedServiceAccountJwt/);
  assert.match(pubsubAuthSource, /Trusted bearer token required/);
  assert.match(pubsubAuthSource, /x-pubsub-token/);
});

test('Chromium is non-root, scriptless and unable to fetch caller-controlled URLs', () => {
  assert.match(indexSource, /hardenPdfPage[^\n(]*\(page\)/);
  assert.match(pageSecuritySource, /setJavaScriptEnabled\(false\)/);
  assert.match(pageSecuritySource, /setRequestInterception\(true\)/);
  assert.match(pageSecuritySource, /request\.abort\('blockedbyclient'\)/);
  assert.doesNotMatch(templateSource, /\^https\?:/);
  assert.match(dockerfileSource, /USER pptruser/);
  assert.match(dockerfileSource, /npm --prefix packages\/contracts prune --omit=dev/);
  assert.match(dockerfileSource, /npm --prefix packages\/api-contracts prune --omit=dev/);
});

test('opaque dispatch messages cannot supply tenant, user, or document authority', async () => {
  const { DocumentDispatchMessageSchema } = await import('@smart-job/api-contracts');
  assert.deepEqual(DocumentDispatchMessageSchema.parse({ taskId: 'task-1' }), { taskId: 'task-1' });
  assert.equal(DocumentDispatchMessageSchema.safeParse({
    taskId: 'task-1',
    companyId: 77,
    uid: 'attacker',
    documentData: {},
  }).success, false);
  assert.match(workerStoreSource, /private\.claim_pdf_document_task/);
  assert.doesNotMatch(indexSource, /message\.companyId|message\.uid|message\.documentData/);
});

test('only the dedicated PDF role receives canonical worker RPC access', () => {
  const migration = fs.readFileSync(
    path.join(resolveRepoRoot(), 'packages', 'db', 'migrations', '0028_reliable_document_email_pipeline.sql'),
    'utf8',
  );
  assert.match(migration, /GRANT EXECUTE ON FUNCTION private\.claim_pdf_document_task[\s\S]*TO smart_job_pdf/);
  assert.match(migration, /REVOKE ALL ON FUNCTION private\.claim_pdf_document_task[\s\S]*smart_job_api[\s\S]*smart_job_email/);
  assert.doesNotMatch(workerStoreSource, /FROM public\.|UPDATE public\.|INSERT INTO public\./);
});
