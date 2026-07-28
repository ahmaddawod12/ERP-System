import { sql } from 'drizzle-orm';

import { getDb } from './client';

export interface FileUploadCleanupClaim {
  sessionId: string;
  bucketId: string;
  objectPaths: string[];
  leaseExpiresAt: string;
  attemptCount: number;
}

export async function queueExpiredFileUploadCleanup(): Promise<Record<string, unknown>> {
  const result = await getDb().execute(sql`
    SELECT private.queue_expired_file_upload_cleanup() AS result
  `);
  return (result.rows[0]?.result ?? {}) as Record<string, unknown>;
}

export async function claimFileUploadCleanupBatch(
  limit: number,
  leaseSeconds: number,
): Promise<FileUploadCleanupClaim[]> {
  const result = await getDb().execute(sql`
    SELECT
      session_id,
      bucket_id,
      object_paths,
      lease_expires_at,
      attempt_count
    FROM private.claim_file_upload_cleanup_batch(
      ${limit}::integer,
      ${leaseSeconds}::integer
    )
  `);
  return result.rows.map((row) => ({
    sessionId: String(row.session_id),
    bucketId: String(row.bucket_id),
    objectPaths: Array.isArray(row.object_paths)
      ? row.object_paths.map(String)
      : [],
    leaseExpiresAt: new Date(String(row.lease_expires_at)).toISOString(),
    attemptCount: Number(row.attempt_count),
  }));
}

export async function finishFileUploadCleanup(input: {
  sessionId: string;
  attemptCount: number;
  succeeded: boolean;
  error: string | null;
}): Promise<Record<string, unknown>> {
  const result = await getDb().execute(sql`
    SELECT private.finish_file_upload_cleanup(
      ${input.sessionId}::uuid,
      ${input.attemptCount}::integer,
      ${input.succeeded}::boolean,
      ${input.error}::text
    ) AS result
  `);
  return (result.rows[0]?.result ?? {}) as Record<string, unknown>;
}
