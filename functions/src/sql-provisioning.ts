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

function mapProvisioningError(error) {
  if (error instanceof HttpsError) {
    throw error;
  }

  if (error?.code === 'already-exists') {
    throw new HttpsError('already-exists', error.message || 'User is already registered with a company');
  }

  throw new HttpsError('internal', error?.message || 'SQL registration failed');
}

async function registerBusinessInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }

  try {
    const dbModule = loadDbModule();
    return await dbModule.createWorkspaceRegistration(input);
  } catch (error) {
    mapProvisioningError(error);
  }
}

export { registerBusinessInSql };
