const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { getTargetMonth } = require('../archive-month');

function resolveProjectFile(...segments) {
  const candidates = [
    path.resolve(__dirname, '..', ...segments),
    path.resolve(__dirname, '..', '..', ...segments),
  ];
  const match = candidates.find((candidate) => fs.existsSync(candidate));
  if (!match) throw new Error(`Unable to resolve project file: ${segments.join('/')}`);
  return match;
}

test('getTargetMonth returns an exclusive upper month bound', () => {
  const sameYear = getTargetMonth(new Date('2026-07-15T12:00:00.000Z'));
  assert.equal(sameYear.year, 2026);
  assert.equal(sameYear.month, 1);
  assert.equal(sameYear.startDate.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(sameYear.endDate.toISOString(), '2026-02-01T00:00:00.000Z');

  const previousYear = getTargetMonth(new Date('2026-03-15T12:00:00.000Z'));
  assert.equal(previousYear.year, 2025);
  assert.equal(previousYear.month, 9);
  assert.equal(previousYear.startDate.toISOString(), '2025-09-01T00:00:00.000Z');
  assert.equal(previousYear.endDate.toISOString(), '2025-10-01T00:00:00.000Z');
});

test('archiver uses leased immutable segments and never mutable manifests', () => {
  const runner = fs.readFileSync(resolveProjectFile('archive-runner.ts'), 'utf8');
  const files = fs.readFileSync(resolveProjectFile('archive-files.ts'), 'utf8');
  const migration = fs.readFileSync(
    resolveProjectFile('..', 'packages', 'db', 'migrations', '0000_baseline.sql'),
    'utf8',
  );

  assert.match(runner, /claimArchiveRunLease/);
  assert.match(runner, /listArchiverCandidates/);
  assert.match(runner, /loadVerifiedIdManifest/);
  assert.match(runner, /sourceIds\.slice\(deleteCursor, deleteCursor \+ DELETE_CHUNK_SIZE\)/);
  assert.match(files, /ifGenerationMatch:\s*0/);
  assert.match(files, /checksum mismatch/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /lease\.status = 'completed' THEN lease\.segment \+ 1/);
  assert.match(migration, /ARCHIVE_DELETE_CHUNK_INVALID/);
  assert.doesNotMatch(runner, /manifest\.json/);
});

test('archiver Docker and CI build shared packages from repo root context', () => {
  const dockerfile = fs.readFileSync(resolveProjectFile('Dockerfile'), 'utf8');
  const ci = fs.readFileSync(resolveProjectFile('..', '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(dockerfile, /COPY packages\/contracts/);
  assert.match(dockerfile, /npm --prefix packages\/contracts run build/);
  assert.match(dockerfile, /npm --prefix packages\/db run build/);
  assert.match(dockerfile, /npm --prefix packages\/contracts prune --omit=dev/);
  assert.match(dockerfile, /npm --prefix packages\/db prune --omit=dev/);
  assert.match(dockerfile, /npm --prefix cloudrun-archiver ci --omit=dev/);
  assert.match(dockerfile, /USER node/);
  assert.match(ci, /- name: archiver\s+dockerfile: cloudrun-archiver\/Dockerfile/);
  assert.match(
    ci,
    /docker build -f \$\{\{ matrix\.dockerfile \}\} -t smart-job-\$\{\{ matrix\.name \}\}:ci \./,
  );
});
