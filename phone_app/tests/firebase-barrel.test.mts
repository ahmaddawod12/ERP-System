import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readProjectFile(...segments: string[]) {
  return fs.readFileSync(path.resolve(process.cwd(), ...segments), 'utf8');
}

test('mobile firebase barrel does not export generic firestore mutation helpers', () => {
  const source = readProjectFile('firebase.ts');

  assert.doesNotMatch(source, /\baddDoc\b/);
  assert.doesNotMatch(source, /export \{[\s\S]*\bsetDoc\b/);
  assert.doesNotMatch(source, /export \{[\s\S]*\bupdateDoc\b/);
  assert.doesNotMatch(source, /export \{[\s\S]*\bdeleteDoc\b/);
  assert.doesNotMatch(source, /export \{[\s\S]*\bwriteBatch\b/);
  assert.doesNotMatch(source, /export \{[\s\S]*\brunTransaction\b/);
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

  const cacheContextFirebaseImport = cacheContext.split('\n').find((line) => line.includes("from '../firebase'")) || '';
  const userJobFirebaseImport = userJob.split('\n').find((line) => line.includes("from '../../../firebase'")) || '';
  const documentHistoryFirebaseImport = documentHistory.split('\n').find((line) => line.includes("from '../../../firebase'")) || '';
  const workerJobFirebaseImport = workerJob.split('\n').find((line) => line.includes("from '../../../firebase'")) || '';

  assert.doesNotMatch(cacheContextFirebaseImport, /\bsetDoc\b/);
  assert.doesNotMatch(userJobFirebaseImport, /\baddDoc\b|\bsetDoc\b|\bupdateDoc\b|\bdeleteDoc\b|\bwriteBatch\b|\brunTransaction\b/);
  assert.doesNotMatch(documentHistoryFirebaseImport, /\baddDoc\b|\bsetDoc\b|\bupdateDoc\b|\bdeleteDoc\b|\bwriteBatch\b|\brunTransaction\b/);
  assert.doesNotMatch(workerJobFirebaseImport, /\baddDoc\b|\bsetDoc\b|\bupdateDoc\b|\bdeleteDoc\b|\bwriteBatch\b|\brunTransaction\b/);
});
