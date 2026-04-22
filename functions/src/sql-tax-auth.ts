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

function mapSqlTaxAuthError(error, fallbackMessage) {
  if (error instanceof HttpsError) {
    throw error;
  }
  switch (error?.code) {
    case 'not-found':
      throw new HttpsError('not-found', error.message || fallbackMessage);
    case 'invalid-argument':
      throw new HttpsError('invalid-argument', error.message || fallbackMessage);
    case 'permission-denied':
      throw new HttpsError('permission-denied', error.message || fallbackMessage);
    case 'already-exists':
      throw new HttpsError('already-exists', error.message || fallbackMessage);
    case 'deadline-exceeded':
      throw new HttpsError('deadline-exceeded', error.message || fallbackMessage);
    default:
      throw new HttpsError('internal', error?.message || fallbackMessage);
  }
}

async function createTaxOauthSessionInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.createTaxOauthSession(input);
  } catch (error) {
    mapSqlTaxAuthError(error, 'Failed to create Tax Authority OAuth session');
  }
}

async function getLatestTaxOauthCallbackInSql(authId) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.getLatestTaxOauthCallback(authId);
  } catch (error) {
    mapSqlTaxAuthError(error, 'Failed to load Tax Authority OAuth callback');
  }
}

async function consumeTaxOauthSessionInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.consumeTaxOauthSession(input);
  } catch (error) {
    mapSqlTaxAuthError(error, 'Failed to consume Tax Authority OAuth session');
  }
}

async function finalizeTaxOauthCallbackInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.finalizeTaxOauthCallback(input);
  } catch (error) {
    mapSqlTaxAuthError(error, 'Failed to finalize Tax Authority OAuth callback');
  }
}

async function getTaxAuthorityTokensInSql(companyId) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.getTaxAuthorityTokens(companyId);
  } catch (error) {
    mapSqlTaxAuthError(error, 'Failed to load Tax Authority tokens');
  }
}

async function upsertTaxAuthorityTokensInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.upsertTaxAuthorityTokens(input);
  } catch (error) {
    mapSqlTaxAuthError(error, 'Failed to store Tax Authority tokens');
  }
}

async function finalizeTaxAuthorityTokenRefreshInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.finalizeTaxAuthorityTokenRefresh(input);
  } catch (error) {
    mapSqlTaxAuthError(error, 'Failed to finalize Tax Authority token refresh');
  }
}

export { consumeTaxOauthSessionInSql, createTaxOauthSessionInSql, finalizeTaxAuthorityTokenRefreshInSql, finalizeTaxOauthCallbackInSql, getLatestTaxOauthCallbackInSql, getTaxAuthorityTokensInSql, upsertTaxAuthorityTokensInSql };
