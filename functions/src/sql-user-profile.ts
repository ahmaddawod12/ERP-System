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

function mapSqlUserProfileError(error, fallbackMessage) {
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

async function updateUserProfileInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.updateUserProfile(input);
  } catch (error) {
    mapSqlUserProfileError(error, 'Failed to update user profile');
  }
}

async function getUserProfileInSql(uid) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    const profile: any = await dbModule.getUserProfileByFirebaseUid(uid);
    if (!profile) {
      throw new HttpsError('not-found', 'User profile not found');
    }
    return profile;
  } catch (error) {
    mapSqlUserProfileError(error, 'Failed to load user profile');
  }
}

async function updateUserPushTokenInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.updateUserPushToken(input);
  } catch (error) {
    mapSqlUserProfileError(error, 'Failed to update push token');
  }
}

async function clearUserPushTokenInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.clearUserPushToken(input);
  } catch (error) {
    mapSqlUserProfileError(error, 'Failed to clear push token');
  }
}

export { clearUserPushTokenInSql, getUserProfileInSql, updateUserProfileInSql, updateUserPushTokenInSql };
