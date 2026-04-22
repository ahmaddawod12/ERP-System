import { HttpsError } from 'firebase-functions/v2/https';
import { isSqlPersistenceEnabled } from './sql-access';

function loadDbModule() {
  try {
    return require('@smart-job/db');
  } catch (packageError) {
    try {
      const relativeDbModulePath = '../../packages/db';
      return require(relativeDbModulePath);
    } catch (relativeError) {
      const error = relativeError.code === 'MODULE_NOT_FOUND' ? packageError : relativeError;
      throw new Error(`SQL persistence is enabled but @smart-job/db could not be loaded: ${error.message}`);
    }
  }
}

function mapSqlDocumentTaskError(error, fallbackMessage) {
  if (error instanceof HttpsError) {
    throw error;
  }

  switch (error?.code) {
    case 'not-found':
      throw new HttpsError('not-found', error.message || fallbackMessage);
    case 'failed-precondition':
      throw new HttpsError('failed-precondition', error.message || fallbackMessage);
    default:
      throw new HttpsError('internal', error?.message || fallbackMessage);
  }
}

async function createDocumentTaskInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    return null;
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.createDocumentTask(input);
  } catch (error) {
    mapSqlDocumentTaskError(error, 'Failed to create document task');
  }
}

async function markDocumentTaskQueuedInSql(taskId, options: any = {}) {
  if (!isSqlPersistenceEnabled()) {
    return null;
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.markDocumentTaskQueued(taskId, options);
  } catch (error) {
    mapSqlDocumentTaskError(error, 'Failed to queue document task');
  }
}

async function markDocumentTaskFailedInSql(taskId, errorMessage) {
  if (!isSqlPersistenceEnabled()) {
    return null;
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.markDocumentTaskFailed(taskId, errorMessage);
  } catch (error) {
    mapSqlDocumentTaskError(error, 'Failed to fail document task');
  }
}

export { createDocumentTaskInSql, markDocumentTaskFailedInSql, markDocumentTaskQueuedInSql };

