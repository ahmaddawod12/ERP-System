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

function mapSqlClientError(error, fallbackMessage) {
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

async function addClientInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.createClient(input);
  } catch (error) {
    mapSqlClientError(error, 'Failed to create client');
  }
}

async function updateClientInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.updateClient(input);
  } catch (error) {
    mapSqlClientError(error, 'Failed to update client');
  }
}

async function deleteClientInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.deleteClient(input);
  } catch (error) {
    mapSqlClientError(error, 'Failed to delete client');
  }
}

export { addClientInSql, deleteClientInSql, updateClientInSql };
