import { Storage, type File } from "@google-cloud/storage";

import type { SourceObject, VersionedSource, VersionPage } from "./types.js";

export class GcsVersionedSource implements VersionedSource {
  constructor(private readonly storage: Storage) {}

  async listVersions(input: {
    bucket: string;
    keyMarker?: string;
    versionIdMarker?: string;
  }): Promise<VersionPage> {
    const [files, nextQuery] = await this.storage.bucket(input.bucket).getFiles({
      autoPaginate: false,
      versions: true,
      maxResults: 1_000,
      ...(input.keyMarker ? { pageToken: input.keyMarker } : {}),
    });
    const versions = files.map((file: File) => {
      const generation = String(file.generation || file.metadata.generation || "");
      if (!generation) throw new Error("GCS object response omitted its generation");
      return {
        key: file.name,
        versionId: generation,
        ...(file.metadata.etag ? { eTag: String(file.metadata.etag) } : {}),
        size: Number(file.metadata.size || 0),
      };
    });
    const pageToken = typeof nextQuery?.pageToken === "string"
      ? nextQuery.pageToken
      : undefined;
    return {
      versions,
      deleteMarkers: [],
      ...(pageToken ? { nextKeyMarker: pageToken } : {}),
      truncated: Boolean(pageToken),
    };
  }

  async getVersion(input: {
    bucket: string;
    key: string;
    versionId: string;
  }): Promise<SourceObject> {
    return {
      body: this.storage
        .bucket(input.bucket)
        .file(input.key, { generation: input.versionId })
        .createReadStream(),
    };
  }
}

export function createGcsSource(config: {
  projectId?: string;
  apiEndpoint?: string;
}): GcsVersionedSource {
  return new GcsVersionedSource(new Storage({
    ...(config.projectId ? { projectId: config.projectId } : {}),
    ...(config.apiEndpoint
      ? { apiEndpoint: config.apiEndpoint, useAuthWithCustomEndpoint: false }
      : {}),
  }));
}
