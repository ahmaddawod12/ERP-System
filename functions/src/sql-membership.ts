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

function mapMembershipError(error, fallbackMessage) {
  if (error instanceof HttpsError) {
    throw error;
  }

  switch (error?.code) {
    case 'already-exists':
      throw new HttpsError('already-exists', error.message || fallbackMessage);
    case 'invalid-argument':
      throw new HttpsError('invalid-argument', error.message || fallbackMessage);
    case 'permission-denied':
      throw new HttpsError('permission-denied', error.message || fallbackMessage);
    case 'failed-precondition':
      throw new HttpsError('failed-precondition', error.message || fallbackMessage);
    case 'not-found':
      throw new HttpsError('not-found', error.message || fallbackMessage);
    default:
      throw new HttpsError('internal', error?.message || fallbackMessage);
  }
}

async function createInviteInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.createCompanyInvite(input);
  } catch (error) {
    mapMembershipError(error, 'Failed to create invite');
  }
}

async function joinCompanyInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.joinCompanyWithInvite(input);
  } catch (error) {
    mapMembershipError(error, 'Failed to join company');
  }
}

async function createManagedWorkerInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.createManagedWorkerMembership(input);
  } catch (error) {
    mapMembershipError(error, 'Failed to create worker membership');
  }
}

async function updateManagedWorkerInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.updateManagedWorkerMembership(input);
  } catch (error) {
    mapMembershipError(error, 'Failed to update worker membership');
  }
}

async function deleteManagedWorkerInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.deleteManagedWorkerMembership(input);
  } catch (error) {
    mapMembershipError(error, 'Failed to delete worker membership');
  }
}

export { createInviteInSql, createManagedWorkerInSql, deleteManagedWorkerInSql, joinCompanyInSql, updateManagedWorkerInSql };
