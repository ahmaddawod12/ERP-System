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

function mapSqlCompanySyncError(error, fallbackMessage) {
  if (error instanceof HttpsError) {
    throw error;
  }

  switch (error?.code) {
    case 'not-found':
      throw new HttpsError('not-found', error.message || fallbackMessage);
    default:
      throw new HttpsError('internal', error?.message || fallbackMessage);
  }
}

async function getCompanySyncStateInSql(companyId) {
  if (!isSqlPersistenceEnabled()) {
    return null;
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.getCompanySyncState(companyId);
  } catch (error) {
    mapSqlCompanySyncError(error, 'Failed to read company sync state');
  }
}

async function initializeCompanySyncStateInSql(companyId, values: any = {}) {
  if (!isSqlPersistenceEnabled()) {
    return null;
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.initializeCompanySyncState({ companyId, values });
  } catch (error) {
    mapSqlCompanySyncError(error, 'Failed to initialize company sync state');
  }
}

async function bumpCompanySyncStateInSql(companyId, fieldsOrOptions = []) {
  if (!isSqlPersistenceEnabled()) {
    return null;
  }
  try {
    const dbModule = loadDbModule();
    const payload = Array.isArray(fieldsOrOptions)
      ? { companyId, fields: fieldsOrOptions }
      : { companyId, ...(fieldsOrOptions as object || {}) };
    return await dbModule.bumpCompanySyncState(payload);
  } catch (error) {
    mapSqlCompanySyncError(error, 'Failed to update company sync state');
  }
}

export { bumpCompanySyncStateInSql, getCompanySyncStateInSql, initializeCompanySyncStateInSql };
