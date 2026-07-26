import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const readProjectFile = (...segments: string[]) => (
  fs.readFileSync(path.resolve(process.cwd(), ...segments), 'utf8')
);

test('job detail and attachment downloads use typed exact Cloud API routes', () => {
  const jobsApi = readProjectFile('modules', 'jobs', 'lib', 'jobs-api.ts');
  const fileUtils = readProjectFile('modules', 'jobs', 'lib', 'job-file-utils.ts');
  const details = readProjectFile('components', 'domain', 'ViewJobDetails.tsx');

  assert.match(jobsApi, /JobDetailSchema/);
  assert.match(jobsApi, /JobAttachmentDownloadAccessSchema/);
  assert.match(jobsApi, /attachments\/\$\{[\s\S]*\/download/);
  assert.match(fileUtils, /createJobAttachmentDownload/);
  assert.doesNotMatch(fileUtils, /firebase|storagePath\).*getDownloadURL|putFile|\.delete\(/i);
  assert.match(details, /fetchJobDetail/);
});

test('archive reads resolve and download an exact database archive run', () => {
  const archiveApi = readProjectFile('lib', 'api', 'archives.ts');
  const archiveHook = readProjectFile('hooks', 'useArchiveQuery.ts');

  assert.match(archiveApi, /ArchiveListPageSchema/);
  assert.match(archiveApi, /ArchiveRunDownloadSchema/);
  assert.match(archiveApi, /archiveRunId[\s\S]*\/download/);
  assert.match(archiveHook, /loadArchivePeriod/);
  assert.match(archiveApi, /fetchArchivePeriodRuns/);
  assert.doesNotMatch(archiveHook, /archives\/content/);
  assert.doesNotMatch(archiveHook, /filterJobsByMembership/);
});

test('document detail loads authoritative tax and email state from the Cloud API', () => {
  const documentsApi = readProjectFile('modules', 'documents', 'lib', 'documents-api.ts');
  const documentModel = readProjectFile('modules', 'documents', 'lib', 'document-history-model.ts');
  const documentScreen = readProjectFile('modules', 'documents', 'screens', 'ViewDocument.tsx');

  assert.match(documentsApi, /DocumentDetailSchema/);
  assert.match(documentsApi, /fetchDocumentDetail/);
  assert.match(documentModel, /taxSubmissionStatus/);
  assert.match(documentModel, /emailDeliveryStatus/);
  assert.match(documentScreen, /useQuery/);
  assert.match(documentScreen, /fetchDocumentDetail/);
});

test('server sync versions remain authoritative and cache fetches are bounded', () => {
  const cacheContext = readProjectFile('contexts', 'CacheContext.tsx');
  const cacheFetchers = readProjectFile('contexts', 'cache-fetchers.ts');

  assert.equal(
    fs.existsSync(path.resolve(process.cwd(), 'contexts', 'use-cache-version-actions.ts')),
    false,
  );
  assert.doesNotMatch(cacheContext, /preIncrementVersion|fetchAllRecentJobs|fetchAllCursorPages/);
  assert.doesNotMatch(cacheFetchers, /fetchDocumentById|fetchAllRecentJobs/);
  assert.match(cacheFetchers, /MAX_CURSOR_WINDOW_PAGES = 5/);
});
