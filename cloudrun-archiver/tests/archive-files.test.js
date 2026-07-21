const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const { Readable } = require('node:stream');

const {
  createArchivePayloadFiles,
  loadVerifiedIdManifest,
  uploadArchivePairCreateOnly,
  verifyArchiveObject,
} = require('../archive-files');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

class FakeBucket {
  constructor() {
    this.objects = new Map();
    this.uploadOptions = [];
    this.nextGeneration = 1;
  }

  file(path) {
    return {
      getMetadata: async () => {
        const object = this.objects.get(path);
        if (!object) throw new Error('not found');
        return [{ generation: object.generation, metadata: object.custom }];
      },
      createReadStream: () => {
        const object = this.objects.get(path);
        if (!object) return Readable.from([]).destroy(new Error('not found'));
        return Readable.from([object.bytes]);
      },
    };
  }

  async upload(localPath, options) {
    this.uploadOptions.push(options);
    if (this.objects.has(options.destination) && options.preconditionOpts?.ifGenerationMatch === 0) {
      const error = new Error('precondition');
      error.code = 412;
      throw error;
    }
    const bytes = await readFile(localPath);
    this.objects.set(options.destination, {
      bytes,
      generation: String(this.nextGeneration++),
      custom: options.metadata.metadata,
    });
  }
}

const ids = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
];

test('payload creation streams bounded pages into matching records and ID files', async () => {
  const pages = [
    ids.slice(0, 2).map((sourceId, index) => ({
      sourceId,
      cursorAt: `2026-01-0${index + 1}T00:00:00.000Z`,
      record: { id: index + 1 },
    })),
    [
      {
        sourceId: ids[2],
        cursorAt: '2026-01-03T00:00:00.000Z',
        record: { id: 3 },
      },
    ],
  ];
  let renewals = 0;
  const payload = await createArchivePayloadFiles({
    archiveKey: '2026-01-j-s000001',
    pageSize: 2,
    renewLease: async () => { renewals += 1; },
    loadPage: async () => pages.shift(),
  });
  try {
    const data = await readFile(payload.dataFilePath, 'utf8');
    const idManifest = await readFile(payload.idFilePath, 'utf8');
    assert.deepEqual(JSON.parse(data), [{ id: 1 }, { id: 2 }, { id: 3 }]);
    assert.deepEqual(JSON.parse(idManifest), ids);
    assert.equal(payload.docCount, 3);
    assert.equal(payload.pageCount, 2);
    assert.equal(payload.checksum, sha256(data));
    assert.equal(payload.idManifestChecksum, sha256(idManifest));
    assert.equal(renewals, 2);
  } finally {
    await payload.cleanup();
  }
});

test('uploads are create-only and a pre-existing object is accepted only after full verification', async () => {
  const payload = await createArchivePayloadFiles({
    archiveKey: '2026-01-j-s000001',
    pageSize: 500,
    renewLease: async () => {},
    loadPage: (() => {
      let loaded = false;
      return async () => {
        if (loaded) return [];
        loaded = true;
        return [{ sourceId: ids[0], cursorAt: '2026-01-01T00:00:00Z', record: { id: 1 } }];
      };
    })(),
  });
  const bucket = new FakeBucket();
  try {
    const input = {
      bucket,
      archiveKey: '2026-01-j-s000001',
      storagePath: 'companies/1/archives/2026-01-j-s000001.json',
      idManifestPath: 'companies/1/archives/2026-01-j-s000001.ids.json',
      payload,
    };
    const first = await uploadArchivePairCreateOnly(input);
    const replay = await uploadArchivePairCreateOnly(input);
    assert.equal(first.data.generation, replay.data.generation);
    assert.equal(first.ids.generation, replay.ids.generation);
    assert.equal(bucket.uploadOptions.length, 4);
    assert.ok(bucket.uploadOptions.every((options) => (
      options.preconditionOpts.ifGenerationMatch === 0 && options.resumable === false
    )));

    const loadedIds = await loadVerifiedIdManifest({
      bucket,
      path: first.ids.path,
      checksum: first.ids.checksum,
      generation: first.ids.generation,
      docCount: 1,
      archiveKey: input.archiveKey,
    });
    assert.deepEqual(loadedIds, [ids[0]]);

    bucket.objects.get(first.data.path).bytes = Buffer.from('corrupt');
    await assert.rejects(
      verifyArchiveObject({
        bucket,
        path: first.data.path,
        checksum: first.data.checksum,
        generation: first.data.generation,
        docCount: 1,
        archiveKey: input.archiveKey,
        objectKind: 'records',
      }),
      /checksum mismatch/,
    );
  } finally {
    await payload.cleanup();
  }
});
