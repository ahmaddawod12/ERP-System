import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Bucket, File } from '@google-cloud/storage';

import type { ArchiverPageRecord } from '@smart-job/db';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ID_MANIFEST_BYTES = 64 * 1024 * 1024;

export interface ArchivePayloadFiles {
  readonly directory: string;
  readonly dataFilePath: string;
  readonly idFilePath: string;
  readonly checksum: string;
  readonly idManifestChecksum: string;
  readonly docCount: number;
  readonly pageCount: number;
  cleanup(): Promise<void>;
}

export interface StoredArchiveObject {
  readonly path: string;
  readonly checksum: string;
  readonly generation: string;
}

export interface StoredArchivePair {
  readonly data: StoredArchiveObject;
  readonly ids: StoredArchiveObject;
}

async function writeChunk(
  stream: NodeJS.WritableStream,
  digest: ReturnType<typeof createHash>,
  value: string,
): Promise<void> {
  digest.update(value);
  if (stream.write(value)) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      stream.off('drain', onDrain);
      stream.off('error', onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    stream.once('drain', onDrain);
    stream.once('error', onError);
  });
}

async function finishStream(stream: NodeJS.WritableStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.once('error', reject);
    stream.end(resolve);
  });
}

export async function createArchivePayloadFiles(input: {
  readonly archiveKey: string;
  readonly pageSize: number;
  readonly loadPage: (
    afterCursorAt: Date | null,
    afterId: string | null,
  ) => Promise<readonly ArchiverPageRecord[]>;
  readonly renewLease: () => Promise<void>;
}): Promise<ArchivePayloadFiles> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(input.archiveKey)) {
    throw new TypeError('Archive key is invalid');
  }
  if (!Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 500) {
    throw new TypeError('Archive page size must be between 1 and 500');
  }

  const directory = await mkdtemp(join(tmpdir(), 'smart-job-archive-'));
  const dataFilePath = join(directory, `${input.archiveKey}.json`);
  const idFilePath = join(directory, `${input.archiveKey}.ids.json`);
  const dataStream = createWriteStream(dataFilePath, { encoding: 'utf8' });
  const idStream = createWriteStream(idFilePath, { encoding: 'utf8' });
  const dataDigest = createHash('sha256');
  const idDigest = createHash('sha256');
  let firstRecord = true;
  let docCount = 0;
  let pageCount = 0;
  let afterCursorAt: Date | null = null;
  let afterId: string | null = null;

  try {
    await Promise.all([
      writeChunk(dataStream, dataDigest, '['),
      writeChunk(idStream, idDigest, '['),
    ]);
    while (true) {
      await input.renewLease();
      const page = await input.loadPage(afterCursorAt, afterId);
      pageCount += 1;
      if (page.length > input.pageSize) {
        throw new Error('Archive database page exceeded the configured bound');
      }
      for (const item of page) {
        if (!UUID_PATTERN.test(item.sourceId)) {
          throw new Error('Archive source ID is invalid');
        }
        const cursor = new Date(item.cursorAt);
        if (!Number.isFinite(cursor.getTime())) {
          throw new Error('Archive cursor timestamp is invalid');
        }
        const separator = firstRecord ? '' : ',';
        await Promise.all([
          writeChunk(dataStream, dataDigest, `${separator}${JSON.stringify(item.record)}`),
          writeChunk(idStream, idDigest, `${separator}${JSON.stringify(item.sourceId)}`),
        ]);
        firstRecord = false;
        docCount += 1;
        afterCursorAt = cursor;
        afterId = item.sourceId;
      }
      if (page.length < input.pageSize) break;
    }
    await Promise.all([
      writeChunk(dataStream, dataDigest, ']'),
      writeChunk(idStream, idDigest, ']'),
    ]);
    await Promise.all([finishStream(dataStream), finishStream(idStream)]);
    return {
      directory,
      dataFilePath,
      idFilePath,
      checksum: dataDigest.digest('hex'),
      idManifestChecksum: idDigest.digest('hex'),
      docCount,
      pageCount,
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    dataStream.destroy();
    idStream.destroy();
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function preconditionFailed(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; statusCode?: unknown };
  return Number(candidate.code ?? candidate.statusCode) === 412;
}

async function hashStoredFile(file: File): Promise<string> {
  const digest = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = file.createReadStream();
    stream.on('data', (chunk) => digest.update(chunk));
    stream.once('end', resolve);
    stream.once('error', reject);
  });
  return digest.digest('hex');
}

export async function verifyArchiveObject(input: {
  readonly bucket: Bucket;
  readonly path: string;
  readonly checksum: string;
  readonly docCount: number;
  readonly archiveKey: string;
  readonly objectKind: 'records' | 'ids';
  readonly generation?: string | null;
}): Promise<StoredArchiveObject> {
  const file = input.bucket.file(input.path);
  const [metadata] = await file.getMetadata();
  const generation = String(metadata.generation ?? '').trim();
  const custom = metadata.metadata ?? {};
  if (!/^[1-9][0-9]*$/.test(generation)) {
    throw new Error(`Archive object ${input.path} has no immutable generation`);
  }
  if (input.generation && generation !== input.generation) {
    throw new Error(`Archive object ${input.path} generation changed`);
  }
  if (
    String(custom.sha256 ?? '') !== input.checksum
    || String(custom.docCount ?? '') !== String(input.docCount)
    || String(custom.archiveKey ?? '') !== input.archiveKey
    || String(custom.objectKind ?? '') !== input.objectKind
  ) {
    throw new Error(`Archive object ${input.path} metadata does not match the database run`);
  }
  const actualChecksum = await hashStoredFile(file);
  if (actualChecksum !== input.checksum) {
    throw new Error(`Archive object ${input.path} checksum mismatch`);
  }
  return { path: input.path, checksum: input.checksum, generation };
}

async function uploadCreateOnly(input: {
  readonly bucket: Bucket;
  readonly localPath: string;
  readonly destination: string;
  readonly checksum: string;
  readonly docCount: number;
  readonly archiveKey: string;
  readonly objectKind: 'records' | 'ids';
}): Promise<StoredArchiveObject> {
  try {
    await input.bucket.upload(input.localPath, {
      destination: input.destination,
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: 'application/json',
        cacheControl: 'private, no-store',
        metadata: {
          sha256: input.checksum,
          docCount: String(input.docCount),
          archiveKey: input.archiveKey,
          objectKind: input.objectKind,
        },
      },
    });
  } catch (error) {
    // A prior worker may have uploaded the immutable object and died before
    // recording it. A 412 is safe only after full metadata and byte verification.
    if (!preconditionFailed(error)) throw error;
  }
  return verifyArchiveObject({
    bucket: input.bucket,
    path: input.destination,
    checksum: input.checksum,
    docCount: input.docCount,
    archiveKey: input.archiveKey,
    objectKind: input.objectKind,
  });
}

export async function uploadArchivePairCreateOnly(input: {
  readonly bucket: Bucket;
  readonly archiveKey: string;
  readonly storagePath: string;
  readonly idManifestPath: string;
  readonly payload: ArchivePayloadFiles;
}): Promise<StoredArchivePair> {
  const data = await uploadCreateOnly({
    bucket: input.bucket,
    localPath: input.payload.dataFilePath,
    destination: input.storagePath,
    checksum: input.payload.checksum,
    docCount: input.payload.docCount,
    archiveKey: input.archiveKey,
    objectKind: 'records',
  });
  const ids = await uploadCreateOnly({
    bucket: input.bucket,
    localPath: input.payload.idFilePath,
    destination: input.idManifestPath,
    checksum: input.payload.idManifestChecksum,
    docCount: input.payload.docCount,
    archiveKey: input.archiveKey,
    objectKind: 'ids',
  });
  return { data, ids };
}

async function readBoundedFile(file: File): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  await new Promise<void>((resolve, reject) => {
    const stream = file.createReadStream();
    stream.on('data', (chunk: Buffer | Uint8Array) => {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_ID_MANIFEST_BYTES) {
        stream.destroy(new Error('Archive ID manifest exceeds the safe size bound'));
        return;
      }
      chunks.push(buffer);
    });
    stream.once('end', resolve);
    stream.once('error', reject);
  });
  return Buffer.concat(chunks, bytes);
}

export async function loadVerifiedIdManifest(input: {
  readonly bucket: Bucket;
  readonly path: string;
  readonly checksum: string;
  readonly generation: string;
  readonly docCount: number;
  readonly archiveKey: string;
}): Promise<string[]> {
  await verifyArchiveObject({
    bucket: input.bucket,
    path: input.path,
    checksum: input.checksum,
    generation: input.generation,
    docCount: input.docCount,
    archiveKey: input.archiveKey,
    objectKind: 'ids',
  });
  const bytes = await readBoundedFile(input.bucket.file(input.path));
  const parsed: unknown = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(parsed) || parsed.length !== input.docCount) {
    throw new Error('Archive ID manifest count does not match the database run');
  }
  const ids = parsed.map((value) => String(value).toLowerCase());
  if (ids.some((value) => !UUID_PATTERN.test(value)) || new Set(ids).size !== ids.length) {
    throw new Error('Archive ID manifest contains an invalid or duplicate source ID');
  }
  return ids;
}
