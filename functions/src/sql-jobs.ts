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

function mapSqlJobError(error, fallbackMessage) {
  if (error instanceof HttpsError) {
    throw error;
  }

  switch (error?.code) {
    case 'not-found':
      throw new HttpsError('not-found', error.message || fallbackMessage);
    case 'already-exists':
      throw new HttpsError('already-exists', error.message || fallbackMessage);
    case 'permission-denied':
      throw new HttpsError('permission-denied', error.message || fallbackMessage);
    case 'failed-precondition':
      throw new HttpsError('failed-precondition', error.message || fallbackMessage);
    default:
      throw new HttpsError('internal', error?.message || fallbackMessage);
  }
}

async function createJobInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.createJob(input);
  } catch (error) {
    mapSqlJobError(error, 'Failed to create job');
  }
}

async function updateJobInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.updateJob(input);
  } catch (error) {
    mapSqlJobError(error, 'Failed to update job');
  }
}

async function deleteJobInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.deleteJob(input);
  } catch (error) {
    mapSqlJobError(error, 'Failed to delete job');
  }
}

async function acceptJobInSql(input) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.acceptJob(input);
  } catch (error) {
    mapSqlJobError(error, 'Failed to accept job');
  }
}

async function getJobInSql(companyId, jobId) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.getJobRecordById(companyId, jobId);
  } catch (error) {
    mapSqlJobError(error, 'Failed to load job');
  }
}

async function getWorkerIdentityInSql(companyId, wid) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    const member = await dbModule.getMemberByMemberNo(companyId, wid);
    if (!member) return null;
    return {
      wid: member.memberNo,
      uid: member.uid,
      role: member.role,
      name: member.name,
    };
  } catch (error) {
    mapSqlJobError(error, 'Failed to load worker');
  }
}

async function getClientIdentityInSql(companyId, clientId) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.getClientByClientNo(companyId, clientId);
  } catch (error) {
    mapSqlJobError(error, 'Failed to load client');
  }
}

async function getManagerIdentityInSql(companyId, mid) {
  if (!isSqlPersistenceEnabled()) {
    throw new HttpsError('failed-precondition', 'SQL persistence is not enabled');
  }
  try {
    const dbModule = loadDbModule();
    return await dbModule.getMemberByMemberNo(companyId, mid) || null;
  } catch (error) {
    mapSqlJobError(error, 'Failed to load manager');
  }
}

export { acceptJobInSql, createJobInSql, deleteJobInSql, getClientIdentityInSql, getJobInSql, getManagerIdentityInSql, getWorkerIdentityInSql, updateJobInSql };
