import { Storage } from "@google-cloud/storage";

import type {
  BackupDestination,
  DatabaseManifest,
  DestinationObjectMetadata,
  StorageCheckpoint,
  StorageManifest,
} from "./types.js";

const CHECKPOINT_PREFIX = "state/storage-inventory-checkpoints/";

function generationOf(metadata: { generation?: string | number }): string {
  if (metadata.generation === undefined) {
    throw new Error("GCS response omitted object generation");
  }
  return String(metadata.generation);
}

export class GcsBackupDestination implements BackupDestination {
  constructor(
    private readonly storage: Storage,
    private readonly bucketName: string,
  ) {}

  async loadCheckpoint(): Promise<{
    checkpoint?: StorageCheckpoint;
    generation?: string;
  }> {
    const bucket = this.storage.bucket(this.bucketName);
    const [files] = await bucket.getFiles({
      prefix: CHECKPOINT_PREFIX,
      autoPaginate: true,
    });
    const file = files.sort((left, right) =>
      left.name.localeCompare(right.name),
    ).at(-1);
    if (!file) return {};
    const [[bytes], [metadata]] = await Promise.all([
      file.download(),
      file.getMetadata(),
    ]);
    return {
      checkpoint: JSON.parse(bytes.toString("utf8")) as StorageCheckpoint,
      generation: generationOf(metadata),
    };
  }

  async saveCheckpoint(
    checkpoint: StorageCheckpoint,
    expectedGeneration?: string,
  ): Promise<string> {
    const current = await this.loadCheckpoint();
    if (current.generation !== expectedGeneration) {
      throw new Error("Backup checkpoint changed concurrently");
    }
    const sequence = String(checkpoint.sequence).padStart(12, "0");
    const file = this.storage
      .bucket(this.bucketName)
      .file(`${CHECKPOINT_PREFIX}${sequence}.json`);
    await file.save(JSON.stringify(checkpoint), {
      contentType: "application/json",
      resumable: false,
      validation: "crc32c",
      preconditionOpts: { ifGenerationMatch: 0 },
    });
    const [metadata] = await file.getMetadata();
    return generationOf(metadata);
  }

  async putFileCreateOnly(input: {
    localPath: string;
    objectName: string;
    contentType: string;
    metadata: Record<string, string>;
  }): Promise<DestinationObjectMetadata> {
    const bucket = this.storage.bucket(this.bucketName);
    await bucket.upload(input.localPath, {
      destination: input.objectName,
      contentType: input.contentType,
      resumable: false,
      validation: "crc32c",
      metadata: { metadata: input.metadata },
      preconditionOpts: { ifGenerationMatch: 0 },
    });
    const [metadata] = await bucket.file(input.objectName).getMetadata();
    return {
      generation: generationOf(metadata),
      ...(input.metadata.sha256 ? { sha256: input.metadata.sha256 } : {}),
    };
  }

  async getObjectMetadata(
    objectName: string,
  ): Promise<DestinationObjectMetadata> {
    const [metadata] = await this.storage
      .bucket(this.bucketName)
      .file(objectName)
      .getMetadata();
    const custom = metadata.metadata as Record<string, string> | undefined;
    return {
      generation: generationOf(metadata),
      ...(custom?.sha256 ? { sha256: custom.sha256 } : {}),
    };
  }

  async putJsonCreateOnly(
    objectName: string,
    value: StorageManifest | DatabaseManifest,
  ): Promise<DestinationObjectMetadata> {
    const file = this.storage.bucket(this.bucketName).file(objectName);
    await file.save(JSON.stringify(value), {
      contentType: "application/json",
      resumable: false,
      validation: "crc32c",
      preconditionOpts: { ifGenerationMatch: 0 },
    });
    const [metadata] = await file.getMetadata();
    return { generation: generationOf(metadata) };
  }
}

export function createGcsDestination(
  bucketName: string,
): GcsBackupDestination {
  return new GcsBackupDestination(new Storage(), bucketName);
}
