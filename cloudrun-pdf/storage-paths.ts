import { createHash } from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value: unknown, label: string): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new TypeError(`${label} must be a UUID`);
  }
  return normalized;
}

export function buildGeneratedDocumentObjectPath(
  internalCompanyId: unknown,
  internalDocumentId: unknown,
): string {
  return `${requireUuid(internalCompanyId, 'internalCompanyId')}/documents/${requireUuid(internalDocumentId, 'internalDocumentId')}.pdf`;
}

export function buildPreviewObjectPath(
  internalCompanyId: unknown,
  userId: unknown,
  taskId: unknown,
): string {
  const normalizedTaskId = String(taskId || '').trim();
  if (!normalizedTaskId || normalizedTaskId.length > 160) {
    throw new TypeError('taskId must contain between 1 and 160 characters');
  }
  const taskHash = createHash('sha256').update(normalizedTaskId, 'utf8').digest('hex');
  return `${requireUuid(internalCompanyId, 'internalCompanyId')}/previews/${requireUuid(userId, 'userId')}/${taskHash}.pdf`;
}

export function buildCompanyLogoObjectPath(internalCompanyId: unknown): string {
  return `${requireUuid(internalCompanyId, 'internalCompanyId')}/branding/logo.png`;
}

