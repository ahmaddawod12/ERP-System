const ATTACHMENT_SESSION_SUFFIX = ':attachments';

export function attachmentUploadSessionIdempotencyKey(operationKey: string): string {
  const normalized = operationKey.trim();
  const derived = `${normalized}${ATTACHMENT_SESSION_SUFFIX}`;
  if (normalized.length < 8 || derived.length > 128) {
    throw new Error('The outbox operation idempotency key cannot derive an upload-session key');
  }
  return derived;
}
