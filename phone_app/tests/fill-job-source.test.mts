import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readProjectFile(...segments: string[]) {
  return fs.readFileSync(path.resolve(process.cwd(), ...segments), 'utf8');
}

test('solo finished jobs upload files before createJobV1 is called', () => {
  const fillJob = readProjectFile('modules', 'jobs', 'screens', 'FillJob.tsx');

  const uploadIndex = fillJob.indexOf('const userUploadResult = await uploadJobFilesForStorage(');
  const createIndex = fillJob.indexOf("const result = await createJobFn({");
  assert.notEqual(uploadIndex, -1);
  assert.notEqual(createIndex, -1);
  assert.ok(uploadIndex < createIndex, 'file upload should happen before createJobV1');
  assert.match(fillJob, /photos: userUploadResult\.photoRefs/);
  assert.match(fillJob, /signature: userUploadResult\.signatureRef/);
  assert.doesNotMatch(fillJob, /photos:\s*\[\]/);
});
