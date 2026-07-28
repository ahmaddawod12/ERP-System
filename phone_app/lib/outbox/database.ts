import * as SecureStore from 'expo-secure-store';
import { randomUUID, getRandomBytes } from 'expo-crypto';
import {
  openDatabaseAsync,
  type SQLiteDatabase,
} from 'expo-sqlite';

import { safeJsonParse } from '../../utils/helpers';
import { requireSqlCipherVersion } from './sqlcipher';

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SQLCIPHER_KEY_PATTERN = /^[a-f0-9]{64}$/;
const LEASE_DURATION_MS = 60_000;
const databaseKeyPromises = new Map<string, Promise<string>>();

export type OutboxOperationKind = 'job.create_finished' | 'job.complete_assigned';
export type OutboxOperationStatus =
  | 'pending'
  | 'syncing'
  | 'retry_wait'
  | 'paused_auth'
  | 'conflict'
  | 'terminal_error';

export interface OutboxOperation {
  readonly id: string;
  readonly userId: string;
  readonly companyId: number;
  readonly kind: OutboxOperationKind;
  readonly payload: Record<string, unknown>;
  readonly idempotencyKey: string;
  readonly entityVersion: string | null;
  readonly attempts: number;
  readonly status: OutboxOperationStatus;
  readonly nextRetryAt: number | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface OutboxAttachmentRecord {
  readonly id: string;
  readonly operationId: string;
  readonly kind: 'photo' | 'signature';
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly stagedDirectoryUri: string;
  readonly chunkCount: number;
}

export interface OutboxFileCleanupRecord {
  readonly id: string;
  readonly stagedDirectoryUri: string;
}

interface OperationRow {
  id: string;
  user_id: string;
  company_id: number;
  kind: OutboxOperationKind;
  payload_json: string;
  idempotency_key: string;
  entity_version: string | null;
  attempts: number;
  status: OutboxOperationStatus;
  next_retry_at: number | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: number;
  updated_at: number;
}

interface AttachmentRow {
  id: string;
  operation_id: string;
  kind: 'photo' | 'signature';
  file_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  staged_directory_uri: string;
  chunk_count: number;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function requireUserId(userId: string): string {
  const normalized = userId.trim().toLowerCase();
  if (!USER_ID_PATTERN.test(normalized)) {
    throw new Error('A canonical authenticated user id is required for the outbox');
  }
  return normalized;
}

async function getOrCreateDatabaseKey(userId: string): Promise<string> {
  const normalized = requireUserId(userId);
  const active = databaseKeyPromises.get(normalized);
  if (active) {
    return active;
  }

  const pending = (async () => {
    const keyName = `smart-job.outbox.database-key.${normalized}`;
    const existing = await SecureStore.getItemAsync(keyName);
    if (existing && SQLCIPHER_KEY_PATTERN.test(existing)) {
      return existing;
    }
    const generated = bytesToHex(getRandomBytes(32));
    await SecureStore.setItemAsync(keyName, generated, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return generated;
  })();
  databaseKeyPromises.set(normalized, pending);
  try {
    return await pending;
  } finally {
    if (databaseKeyPromises.get(normalized) === pending) {
      databaseKeyPromises.delete(normalized);
    }
  }
}

async function assertCipherIntegrity(database: SQLiteDatabase): Promise<void> {
  const versionRows = await database.getAllAsync<Record<string, unknown>>(
    'PRAGMA cipher_version',
  );
  requireSqlCipherVersion(versionRows);

  const rows = await database.getAllAsync<Record<string, unknown>>(
    'PRAGMA cipher_integrity_check',
  );
  const failures = rows.flatMap((row) => Object.values(row))
    .filter((value): value is string => (
      typeof value === 'string' && value.trim().toLowerCase() !== 'ok'
    ));
  if (failures.length > 0) {
    throw new Error(`The encrypted outbox failed its integrity check: ${failures[0]}`);
  }
}

function mapOperation(row: OperationRow): OutboxOperation {
  const payload = safeJsonParse<Record<string, unknown>>(row.payload_json, {});
  return {
    id: row.id,
    userId: row.user_id,
    companyId: row.company_id,
    kind: row.kind,
    payload: payload ?? {},
    idempotencyKey: row.idempotency_key,
    entityVersion: row.entity_version,
    attempts: row.attempts,
    status: row.status,
    nextRetryAt: row.next_retry_at,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAttachment(row: AttachmentRow): OutboxAttachmentRecord {
  return {
    id: row.id,
    operationId: row.operation_id,
    kind: row.kind,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    stagedDirectoryUri: row.staged_directory_uri,
    chunkCount: row.chunk_count,
  };
}

export class UserOutboxDatabase {
  private constructor(
    readonly userId: string,
    private readonly database: SQLiteDatabase,
  ) {}

  static async open(userId: string): Promise<UserOutboxDatabase> {
    const normalizedUserId = requireUserId(userId);
    const key = await getOrCreateDatabaseKey(normalizedUserId);
    const database = await openDatabaseAsync(`smart-job-outbox-${normalizedUserId}.db`);
    try {
      await database.execAsync(`PRAGMA key = "x'${key}'"`);
      await assertCipherIntegrity(database);
      await database.execAsync('PRAGMA journal_mode = WAL');
      await database.execAsync('PRAGMA foreign_keys = ON');
      await database.execAsync(`
        CREATE TABLE IF NOT EXISTS outbox_operations (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL,
          company_id INTEGER NOT NULL CHECK (company_id > 0),
          kind TEXT NOT NULL CHECK (kind IN ('job.create_finished', 'job.complete_assigned')),
          payload_json TEXT NOT NULL,
          idempotency_key TEXT NOT NULL UNIQUE,
          entity_version TEXT,
          attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
          next_retry_at INTEGER,
          lease_expires_at INTEGER,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'syncing', 'retry_wait', 'paused_auth', 'conflict', 'terminal_error')),
          last_error_code TEXT,
          last_error_message TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS outbox_operations_due_idx
          ON outbox_operations (status, next_retry_at, created_at);
        CREATE TABLE IF NOT EXISTS outbox_attachments (
          id TEXT PRIMARY KEY NOT NULL,
          operation_id TEXT NOT NULL REFERENCES outbox_operations(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('photo', 'signature')),
          file_name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
          sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
          staged_directory_uri TEXT NOT NULL,
          chunk_count INTEGER NOT NULL CHECK (chunk_count > 0)
        );
        CREATE INDEX IF NOT EXISTS outbox_attachments_operation_idx
          ON outbox_attachments (operation_id);
        CREATE TABLE IF NOT EXISTS outbox_file_cleanup (
          id TEXT PRIMARY KEY NOT NULL,
          staged_directory_uri TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS outbox_file_cleanup_created_idx
          ON outbox_file_cleanup (created_at);
      `);
      return new UserOutboxDatabase(normalizedUserId, database);
    } catch (error) {
      await database.closeAsync().catch(() => undefined);
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.database.closeAsync();
  }

  async enqueue(input: {
    readonly companyId: number;
    readonly kind: OutboxOperationKind;
    readonly payload: Record<string, unknown>;
    readonly entityVersion?: string | null;
    readonly attachments?: readonly Omit<OutboxAttachmentRecord, 'operationId'>[];
  }): Promise<string> {
    const operationId = randomUUID();
    const idempotencyKey = randomUUID();
    const now = Date.now();
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        `INSERT INTO outbox_operations (
           id, user_id, company_id, kind, payload_json, idempotency_key,
           entity_version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        operationId,
        this.userId,
        input.companyId,
        input.kind,
        JSON.stringify(input.payload),
        idempotencyKey,
        input.entityVersion ?? null,
        now,
        now,
      );
      for (const attachment of input.attachments ?? []) {
        await transaction.runAsync(
          `INSERT INTO outbox_attachments (
             id, operation_id, kind, file_name, mime_type, size_bytes,
             sha256, staged_directory_uri, chunk_count
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          attachment.id,
          operationId,
          attachment.kind,
          attachment.fileName,
          attachment.mimeType,
          attachment.sizeBytes,
          attachment.sha256,
          attachment.stagedDirectoryUri,
          attachment.chunkCount,
        );
      }
    });
    return operationId;
  }

  async listOperations(limit = 100): Promise<OutboxOperation[]> {
    const boundedLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
    const rows = await this.database.getAllAsync<OperationRow>(
      `SELECT id, user_id, company_id, kind, payload_json, idempotency_key,
              entity_version, attempts, status, next_retry_at,
              last_error_code, last_error_message, created_at, updated_at
       FROM outbox_operations
       ORDER BY created_at DESC
       LIMIT ?`,
      boundedLimit,
    );
    return rows.map(mapOperation);
  }

  async operation(operationId: string): Promise<OutboxOperation | null> {
    const row = await this.database.getFirstAsync<OperationRow>(
      `SELECT id, user_id, company_id, kind, payload_json, idempotency_key,
              entity_version, attempts, status, next_retry_at,
              last_error_code, last_error_message, created_at, updated_at
       FROM outbox_operations
       WHERE id = ?`,
      operationId,
    );
    return row ? mapOperation(row) : null;
  }

  async retry(operationId: string): Promise<boolean> {
    const result = await this.database.runAsync(
      `UPDATE outbox_operations
       SET status = 'pending', next_retry_at = NULL, lease_expires_at = NULL,
           last_error_code = NULL, last_error_message = NULL, updated_at = ?
       WHERE id = ? AND status <> 'syncing'`,
      Date.now(),
      operationId,
    );
    return result.changes === 1;
  }

  async claimNext(now = Date.now()): Promise<OutboxOperation | null> {
    let claimedRow: OperationRow | null = null;
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      claimedRow = await transaction.getFirstAsync<OperationRow>(
        `UPDATE outbox_operations
         SET status = 'syncing',
             attempts = attempts + 1,
             lease_expires_at = ?,
             updated_at = ?
         WHERE id = (
           SELECT id
           FROM outbox_operations
           WHERE (
             status = 'pending'
             OR (status = 'retry_wait' AND COALESCE(next_retry_at, 0) <= ?)
             OR (status = 'syncing' AND COALESCE(lease_expires_at, 0) <= ?)
           )
           ORDER BY created_at ASC
           LIMIT 1
         )
         RETURNING id, user_id, company_id, kind, payload_json,
                   idempotency_key, entity_version, attempts, status,
                   next_retry_at, last_error_code, last_error_message,
                   created_at, updated_at`,
        now + LEASE_DURATION_MS,
        now,
        now,
        now,
      );
    });
    return claimedRow ? mapOperation(claimedRow) : null;
  }

  async attachments(operationId: string): Promise<OutboxAttachmentRecord[]> {
    const rows = await this.database.getAllAsync<AttachmentRow>(
      `SELECT id, operation_id, kind, file_name, mime_type, size_bytes,
              sha256, staged_directory_uri, chunk_count
       FROM outbox_attachments
       WHERE operation_id = ?
       ORDER BY id ASC`,
      operationId,
    );
    return rows.map(mapAttachment);
  }

  async complete(operationId: string): Promise<OutboxAttachmentRecord[]> {
    return this.queueCleanupAndDelete(operationId);
  }

  async discard(operationId: string): Promise<OutboxAttachmentRecord[]> {
    return this.queueCleanupAndDelete(operationId);
  }

  async updatePayload(
    operationId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.database.runAsync(
      `UPDATE outbox_operations
       SET payload_json = ?, updated_at = ?
       WHERE id = ?`,
      JSON.stringify(payload),
      Date.now(),
      operationId,
    );
  }

  async releaseClaim(operationId: string): Promise<void> {
    await this.database.runAsync(
      `UPDATE outbox_operations
       SET status = 'pending',
           attempts = MAX(attempts - 1, 0),
           next_retry_at = NULL,
           lease_expires_at = NULL,
           updated_at = ?
       WHERE id = ?
         AND status = 'syncing'`,
      Date.now(),
      operationId,
    );
  }

  async pendingFileCleanup(limit = 50): Promise<OutboxFileCleanupRecord[]> {
    const rows = await this.database.getAllAsync<{
      id: string;
      staged_directory_uri: string;
    }>(
      `SELECT id, staged_directory_uri
       FROM outbox_file_cleanup
       ORDER BY created_at ASC
       LIMIT ?`,
      limit,
    );
    return rows.map((row) => ({
      id: row.id,
      stagedDirectoryUri: row.staged_directory_uri,
    }));
  }

  async acknowledgeFileCleanup(id: string): Promise<void> {
    await this.database.runAsync('DELETE FROM outbox_file_cleanup WHERE id = ?', id);
  }

  private async queueCleanupAndDelete(
    operationId: string,
  ): Promise<OutboxAttachmentRecord[]> {
    let attachments: OutboxAttachmentRecord[] = [];
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const rows = await transaction.getAllAsync<AttachmentRow>(
        `SELECT id, operation_id, kind, file_name, mime_type, size_bytes,
                sha256, staged_directory_uri, chunk_count
         FROM outbox_attachments
         WHERE operation_id = ?
         ORDER BY id ASC`,
        operationId,
      );
      attachments = rows.map(mapAttachment);
      const now = Date.now();
      for (const attachment of attachments) {
        await transaction.runAsync(
          `INSERT OR IGNORE INTO outbox_file_cleanup (
             id, staged_directory_uri, created_at
           ) VALUES (?, ?, ?)`,
          attachment.id,
          attachment.stagedDirectoryUri,
          now,
        );
      }
      await transaction.runAsync(
        'DELETE FROM outbox_operations WHERE id = ?',
        operationId,
      );
    });
    return attachments;
  }

  async markFailure(input: {
    readonly operationId: string;
    readonly status: Exclude<OutboxOperationStatus, 'pending' | 'syncing'>;
    readonly code: string;
    readonly message: string;
    readonly nextRetryAt?: number | null;
  }): Promise<void> {
    await this.database.runAsync(
      `UPDATE outbox_operations
       SET status = ?, next_retry_at = ?, lease_expires_at = NULL,
           last_error_code = ?, last_error_message = ?, updated_at = ?
       WHERE id = ?`,
      input.status,
      input.nextRetryAt ?? null,
      input.code,
      input.message.slice(0, 1_000),
      Date.now(),
      input.operationId,
    );
  }

  async resumeAfterAuthentication(): Promise<void> {
    await this.database.runAsync(
      `UPDATE outbox_operations
       SET status = 'pending', next_retry_at = NULL, updated_at = ?
       WHERE status = 'paused_auth'`,
      Date.now(),
    );
  }
}
