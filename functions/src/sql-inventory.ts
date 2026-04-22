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

function mapSqlInventoryError(error, fallbackMessage) {
  if (error instanceof HttpsError) {
    throw error;
  }

  switch (error?.code) {
    case 'invalid-argument':
      throw new HttpsError('invalid-argument', error.message || fallbackMessage);
    case 'not-found':
      throw new HttpsError('not-found', error.message || fallbackMessage);
    case 'failed-precondition':
      throw new HttpsError('failed-precondition', error.message || fallbackMessage);
    default:
      throw new HttpsError('internal', error?.message || fallbackMessage);
  }
}

async function addCompanyInventoryPartInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.addCompanyInventoryPart(input);
  } catch (error) {
    mapSqlInventoryError(error, 'Failed to add company inventory part');
  }
}

async function updateCompanyInventoryPartInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.updateCompanyInventoryPart(input);
  } catch (error) {
    mapSqlInventoryError(error, 'Failed to update company inventory part');
  }
}

async function toggleCompanyInventoryPartInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.toggleCompanyInventoryPart(input);
  } catch (error) {
    mapSqlInventoryError(error, 'Failed to toggle company inventory part');
  }
}

async function removeCompanyInventoryPartInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.removeCompanyInventoryPart(input);
  } catch (error) {
    mapSqlInventoryError(error, 'Failed to remove company inventory part');
  }
}

async function addUserInventoryPartInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.addUserInventoryPart(input);
  } catch (error) {
    mapSqlInventoryError(error, 'Failed to add user inventory part');
  }
}

async function updateUserInventoryPartInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.updateUserInventoryPart(input);
  } catch (error) {
    mapSqlInventoryError(error, 'Failed to update user inventory part');
  }
}

async function toggleUserInventoryPartInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.toggleUserInventoryPart(input);
  } catch (error) {
    mapSqlInventoryError(error, 'Failed to toggle user inventory part');
  }
}

async function removeUserInventoryPartInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.removeUserInventoryPart(input);
  } catch (error) {
    mapSqlInventoryError(error, 'Failed to remove user inventory part');
  }
}

async function replaceUserInventoryPartsInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.replaceUserInventoryParts(input);
  } catch (error) {
    mapSqlInventoryError(error, 'Failed to replace user inventory parts');
  }
}

async function pickCompanyPartsInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.pickCompanyParts(input);
  } catch (error) {
    mapSqlInventoryError(error, 'Failed to pick company parts');
  }
}

async function deductUserInventoryPartsInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.deductUserInventoryParts(input);
  } catch (error) {
    mapSqlInventoryError(error, 'Failed to deduct user inventory parts');
  }
}

export { addCompanyInventoryPartInSql, addUserInventoryPartInSql, deductUserInventoryPartsInSql, pickCompanyPartsInSql, removeCompanyInventoryPartInSql, removeUserInventoryPartInSql, replaceUserInventoryPartsInSql, toggleCompanyInventoryPartInSql, toggleUserInventoryPartInSql, updateCompanyInventoryPartInSql, updateUserInventoryPartInSql };
