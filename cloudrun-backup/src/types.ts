export type BackupMode = "storage" | "database";

export interface StorageCheckpoint {
  schemaVersion: 1;
  sequence: number;
  scanStartedAt: string;
  updatedAt: string;
  lastFullScanAt?: string;
  keyMarker?: string;
  versionIdMarker?: string;
}

export interface StorageManifestEntry {
  kind: "object" | "delete-marker";
  sourceKey: string;
  sourceVersionId: string;
  sourceETag?: string;
  size?: number;
  sha256?: string;
  destinationObject?: string;
  destinationGeneration?: string;
}

export interface StorageManifest {
  schemaVersion: 1;
  kind: "supabase-storage-inventory";
  runId: string;
  startedAt: string;
  completedAt: string;
  sourceBucket: string;
  completedFullScan: boolean;
  entries: StorageManifestEntry[];
}

export interface DatabaseManifest {
  schemaVersion: 1;
  kind: "postgresql-custom-export";
  runId: string;
  startedAt: string;
  completedAt: string;
  postgresMajor: 17;
  sha256: string;
  size: number;
  destinationObject: string;
  destinationGeneration: string;
}

export interface VersionPage {
  versions: Array<{
    key: string;
    versionId: string;
    eTag?: string;
    size: number;
  }>;
  deleteMarkers: Array<{
    key: string;
    versionId: string;
  }>;
  nextKeyMarker?: string;
  nextVersionIdMarker?: string;
  truncated: boolean;
}

export interface SourceObject {
  body: AsyncIterable<Uint8Array>;
}

export interface VersionedSource {
  listVersions(input: {
    bucket: string;
    keyMarker?: string;
    versionIdMarker?: string;
  }): Promise<VersionPage>;
  getVersion(input: {
    bucket: string;
    key: string;
    versionId: string;
  }): Promise<SourceObject>;
}

export interface DestinationObjectMetadata {
  generation: string;
  sha256?: string;
}

export interface BackupDestination {
  loadCheckpoint(): Promise<{
    checkpoint?: StorageCheckpoint;
    generation?: string;
  }>;
  saveCheckpoint(
    checkpoint: StorageCheckpoint,
    expectedGeneration?: string,
  ): Promise<string>;
  putFileCreateOnly(input: {
    localPath: string;
    objectName: string;
    contentType: string;
    metadata: Record<string, string>;
  }): Promise<DestinationObjectMetadata>;
  getObjectMetadata(objectName: string): Promise<DestinationObjectMetadata>;
  putJsonCreateOnly(
    objectName: string,
    value: StorageManifest | DatabaseManifest,
  ): Promise<DestinationObjectMetadata>;
}
