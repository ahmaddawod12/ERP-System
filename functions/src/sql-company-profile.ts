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

function mapSqlCompanyProfileError(error, fallbackMessage) {
  if (error instanceof HttpsError) {
    throw error;
  }
  switch (error?.code) {
    case 'not-found':
      throw new HttpsError('not-found', error.message || fallbackMessage);
    case 'invalid-argument':
      throw new HttpsError('invalid-argument', error.message || fallbackMessage);
    default:
      throw new HttpsError('internal', error?.message || fallbackMessage);
  }
}

async function getCompanyBusinessInfoInSql(companyId) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.getCompanyBusinessInfoByPublicId(companyId);
  } catch (error) {
    mapSqlCompanyProfileError(error, 'Failed to load business info');
  }
}

async function updateCompanyBusinessInfoInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.updateCompanyBusinessInfo(input);
  } catch (error) {
    mapSqlCompanyProfileError(error, 'Failed to update business info');
  }
}

export { getCompanyBusinessInfoInSql, updateCompanyBusinessInfoInSql };
