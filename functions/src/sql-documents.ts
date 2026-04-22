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

function mapSqlDocumentError(error, fallbackMessage) {
  if (error instanceof HttpsError) {
    throw error;
  }

  switch (error?.code) {
    case 'not-found':
      throw new HttpsError('not-found', error.message || fallbackMessage);
    case 'already-exists':
      throw new HttpsError('already-exists', error.message || fallbackMessage);
    case 'failed-precondition':
      throw new HttpsError('failed-precondition', error.message || fallbackMessage);
    case 'invalid-argument':
      throw new HttpsError('invalid-argument', error.message || fallbackMessage);
    default:
      throw new HttpsError('internal', error?.message || fallbackMessage);
  }
}

async function createDocumentInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.createOrUpdateDocumentRecord(input);
  } catch (error) {
    mapSqlDocumentError(error, 'Failed to store document');
  }
}

async function getDocumentInSql(companyId, documentId) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.getDocumentRecordById(companyId, documentId);
  } catch (error) {
    mapSqlDocumentError(error, 'Failed to load document');
  }
}

async function deleteDocumentInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.deleteDocumentRecord(input);
  } catch (error) {
    mapSqlDocumentError(error, 'Failed to delete document');
  }
}

export { createDocumentInSql, deleteDocumentInSql, getDocumentInSql };
