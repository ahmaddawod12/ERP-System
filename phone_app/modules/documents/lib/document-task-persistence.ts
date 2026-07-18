import { createMMKV } from 'react-native-mmkv';

import { safeJsonParse } from '../../../utils/helpers';
import { logger } from '../../../utils/logger';
import {
  PersistedDocumentTaskAttemptSchema,
  type DocumentTaskAction,
  type PersistedDocumentTaskAttempt,
} from './document-task-attempt';

const documentTaskStorage = createMMKV({ id: 'smart-job-document-tasks' });

function attemptKey(uid: string, companyId: number, action: DocumentTaskAction): string {
  return `v1:${uid.toLowerCase()}:${companyId}:${action}`;
}

export function readDocumentTaskAttempt(
  uid: string,
  companyId: number,
  action: DocumentTaskAction,
): PersistedDocumentTaskAttempt | null {
  const key = attemptKey(uid, companyId, action);
  const parsed = PersistedDocumentTaskAttemptSchema.safeParse(
    safeJsonParse<unknown>(documentTaskStorage.getString(key)),
  );
  if (!parsed.success) {
    documentTaskStorage.remove(key);
    return null;
  }
  if (
    parsed.data.uid.toLowerCase() !== uid.toLowerCase()
    || parsed.data.companyId !== companyId
    || parsed.data.action !== action
  ) {
    documentTaskStorage.remove(key);
    logger.warn('Discarded mismatched persisted document task metadata');
    return null;
  }
  return parsed.data;
}

export function persistDocumentTaskAttempt(attempt: PersistedDocumentTaskAttempt): void {
  const parsed = PersistedDocumentTaskAttemptSchema.parse(attempt);
  documentTaskStorage.set(
    attemptKey(parsed.uid, parsed.companyId, parsed.action),
    JSON.stringify(parsed),
  );
}

export function clearDocumentTaskAttempt(
  uid: string,
  companyId: number,
  action: DocumentTaskAction,
): void {
  documentTaskStorage.remove(attemptKey(uid, companyId, action));
}
