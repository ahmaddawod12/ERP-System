import {
  GetObjectCommand,
  ListObjectVersionsCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { SourceObject, VersionedSource, VersionPage } from "./types.js";

function requiredIdentity(
  value: string | undefined,
  field: string,
): string {
  if (!value) throw new Error(`S3 response omitted ${field}`);
  return value;
}

export class S3VersionedSource implements VersionedSource {
  constructor(private readonly client: S3Client) {}

  async listVersions(input: {
    bucket: string;
    keyMarker?: string;
    versionIdMarker?: string;
  }): Promise<VersionPage> {
    const response = await this.client.send(
      new ListObjectVersionsCommand({
        Bucket: input.bucket,
        ...(input.keyMarker ? { KeyMarker: input.keyMarker } : {}),
        ...(input.versionIdMarker
          ? { VersionIdMarker: input.versionIdMarker }
          : {}),
      }),
    );

    return {
      versions: (response.Versions ?? []).map((version) => ({
        key: requiredIdentity(version.Key, "object key"),
        versionId: requiredIdentity(version.VersionId, "version ID"),
        ...(version.ETag ? { eTag: version.ETag.replaceAll('"', "") } : {}),
        size: version.Size ?? 0,
      })),
      deleteMarkers: (response.DeleteMarkers ?? []).map((marker) => ({
        key: requiredIdentity(marker.Key, "delete-marker key"),
        versionId: requiredIdentity(marker.VersionId, "delete-marker version"),
      })),
      ...(response.NextKeyMarker
        ? { nextKeyMarker: response.NextKeyMarker }
        : {}),
      ...(response.NextVersionIdMarker
        ? { nextVersionIdMarker: response.NextVersionIdMarker }
        : {}),
      truncated: response.IsTruncated === true,
    };
  }

  async getVersion(input: {
    bucket: string;
    key: string;
    versionId: string;
  }): Promise<SourceObject> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        VersionId: input.versionId,
      }),
    );
    if (!response.Body) throw new Error("S3 object response omitted its body");
    return {
      body: response.Body as AsyncIterable<Uint8Array>,
    };
  }
}

export function createS3Source(config: {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}): S3VersionedSource {
  return new S3VersionedSource(
    new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    }),
  );
}
