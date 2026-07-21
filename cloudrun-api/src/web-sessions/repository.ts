import type { DatabaseQueryable } from "../database/runtime.js";
import type {
  EncryptedWebSessionCredentials,
  WebSessionEncryptionBinding,
} from "./crypto.js";

export interface WebSessionRow {
  readonly id: string;
  readonly userId: string;
  readonly supabaseSessionId: string;
  readonly csrfTokenHash: Buffer;
  readonly credentials: EncryptedWebSessionCredentials;
  readonly accessTokenExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

interface RawWebSessionRow {
  readonly id: string;
  readonly user_id: string;
  readonly supabase_session_id: string;
  readonly csrf_token_hash: Buffer;
  readonly credentials_ciphertext: Buffer;
  readonly credentials_iv: Buffer;
  readonly credentials_auth_tag: Buffer;
  readonly encryption_key_version: string;
  readonly access_token_expires_at: Date;
  readonly absolute_expires_at: Date;
}

export interface InsertWebSessionRecord extends WebSessionEncryptionBinding {
  readonly sessionTokenHash: Buffer;
  readonly csrfTokenHash: Buffer;
  readonly credentials: EncryptedWebSessionCredentials;
  readonly accessTokenExpiresAt: Date;
  readonly createdAt: Date;
}

function mapWebSessionRow(row: RawWebSessionRow): WebSessionRow {
  return {
    id: row.id.toLowerCase(),
    userId: row.user_id.toLowerCase(),
    supabaseSessionId: row.supabase_session_id.toLowerCase(),
    csrfTokenHash: row.csrf_token_hash,
    credentials: {
      ciphertext: row.credentials_ciphertext,
      iv: row.credentials_iv,
      authTag: row.credentials_auth_tag,
      keyVersion: row.encryption_key_version,
    },
    accessTokenExpiresAt: row.access_token_expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
  };
}

export async function insertWebSession(
  transaction: DatabaseQueryable,
  record: InsertWebSessionRecord,
): Promise<void> {
  await transaction.query(
    `INSERT INTO private.web_sessions (
       id, session_token_hash, csrf_token_hash, user_id, supabase_session_id,
       credentials_ciphertext, credentials_iv, credentials_auth_tag,
       encryption_key_version, access_token_expires_at, absolute_expires_at,
       created_at, updated_at
     ) VALUES (
       $1::uuid, $2::bytea, $3::bytea, $4::uuid, $5::uuid,
       $6::bytea, $7::bytea, $8::bytea, $9::text, $10::timestamptz,
       $11::timestamptz, $12::timestamptz, $12::timestamptz
     )`,
    [
      record.id,
      record.sessionTokenHash,
      record.csrfTokenHash,
      record.userId,
      record.supabaseSessionId,
      record.credentials.ciphertext,
      record.credentials.iv,
      record.credentials.authTag,
      record.credentials.keyVersion,
      record.accessTokenExpiresAt,
      record.absoluteExpiresAt,
      record.createdAt,
    ],
  );
}

export async function lockActiveWebSession(
  transaction: DatabaseQueryable,
  sessionTokenHash: Buffer,
  now: Date,
): Promise<WebSessionRow | null> {
  const result = await transaction.query<RawWebSessionRow>(
    `SELECT
       id, user_id, supabase_session_id, csrf_token_hash,
       credentials_ciphertext, credentials_iv, credentials_auth_tag,
       encryption_key_version, access_token_expires_at, absolute_expires_at
     FROM private.web_sessions
     WHERE session_token_hash = $1::bytea
       AND revoked_at IS NULL
       AND absolute_expires_at > $2::timestamptz
     FOR UPDATE`,
    [sessionTokenHash, now],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return mapWebSessionRow(row);
}

/**
 * Reads a safely-valid session without taking a row lock. Callers must still
 * acquire the locked variant and re-check expiry before rotating credentials.
 */
export async function readActiveWebSession(
  transaction: DatabaseQueryable,
  sessionTokenHash: Buffer,
  now: Date,
): Promise<WebSessionRow | null> {
  const result = await transaction.query<RawWebSessionRow>(
    `SELECT
       id, user_id, supabase_session_id, csrf_token_hash,
       credentials_ciphertext, credentials_iv, credentials_auth_tag,
       encryption_key_version, access_token_expires_at, absolute_expires_at
     FROM private.web_sessions
     WHERE session_token_hash = $1::bytea
       AND revoked_at IS NULL
       AND absolute_expires_at > $2::timestamptz`,
    [sessionTokenHash, now],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapWebSessionRow(row);
}

export async function updateWebSessionCredentials(
  transaction: DatabaseQueryable,
  sessionId: string,
  credentials: EncryptedWebSessionCredentials,
  accessTokenExpiresAt: Date,
  now: Date,
): Promise<void> {
  const result = await transaction.query(
    `UPDATE private.web_sessions
     SET credentials_ciphertext = $2::bytea,
         credentials_iv = $3::bytea,
         credentials_auth_tag = $4::bytea,
         encryption_key_version = $5::text,
         access_token_expires_at = $6::timestamptz,
         updated_at = $7::timestamptz
     WHERE id = $1::uuid
       AND revoked_at IS NULL`,
    [
      sessionId,
      credentials.ciphertext,
      credentials.iv,
      credentials.authTag,
      credentials.keyVersion,
      accessTokenExpiresAt,
      now,
    ],
  );
  if (result.rowCount !== 1) throw new Error("The locked web session was not updated");
}

export async function revokeWebSession(
  transaction: DatabaseQueryable,
  sessionId: string,
  reason: "user_logout" | "refresh_invalid" | "identity_mismatch" | "auth_invalid",
  now: Date,
): Promise<void> {
  const result = await transaction.query(
    `UPDATE private.web_sessions
     SET revoked_at = $2::timestamptz,
         revocation_reason = $3::text,
         updated_at = $2::timestamptz
     WHERE id = $1::uuid
       AND revoked_at IS NULL`,
    [sessionId, now, reason],
  );
  if (result.rowCount !== 1) throw new Error("The locked web session was not revoked");
}
