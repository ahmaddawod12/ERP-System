import { HttpsError } from 'firebase-functions/v2/https';

function resolveSqlPersistenceBackend(env = process.env) {
  const raw = String(env.SMART_JOB_PERSISTENCE_BACKEND || env.PERSISTENCE_BACKEND || '').trim().toLowerCase();
  if (raw === 'sql') return 'sql';
  if (raw === 'firestore') return 'firestore';
  return String(env.DATABASE_URL || env.SMART_JOB_DATABASE_URL || '').trim() ? 'sql' : 'firestore';
}

function isSqlPersistenceEnabled(env = process.env) {
  return resolveSqlPersistenceBackend(env) === 'sql';
}

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

async function getSqlUserProfileOrThrow(uid) {
  const dbModule = loadDbModule();
  const profile: any = await dbModule.getUserProfileByFirebaseUid(uid);
  if (!profile) {
    throw new HttpsError('not-found', 'User profile not found');
  }
  return profile;
}

async function getSqlUserProfileForCompany(uid, companyId) {
  const dbModule = loadDbModule();
  return dbModule.getUserProfileByFirebaseUidForCompany(uid, companyId);
}

async function assertSqlTargetUserInCompany(targetUid, companyId) {
  const profile: any = await getSqlUserProfileForCompany(targetUid, companyId);
  if (!profile) {
    throw new HttpsError('permission-denied', 'Target user is not in this company');
  }
  return profile;
}

async function assertSqlTargetWorkerScopedUserInCompany(targetUid, companyId) {
  const profile: any = await assertSqlTargetUserInCompany(targetUid, companyId);
  if (!['worker', 'user', 'basic'].includes(String(profile.role || '').trim().toLowerCase())) {
    throw new HttpsError('permission-denied', 'Target user is not a worker-scoped member');
  }
  if (!profile.wid) {
    throw new HttpsError('permission-denied', 'Target user has no wid membership key');
  }
  return profile;
}

async function assertSqlCompanyAccess(params) {
  const {
    uid,
    companyId,
    allowedRoles = [],
    allowSoloScope = false,
    preloadedProfile = null,
  } = params;

  const baseProfile = preloadedProfile || await getSqlUserProfileOrThrow(uid);
  const isDev = String(baseProfile.systemRole || '').trim().toLowerCase() === 'dev';
  const scopedProfile = isDev
    ? (await getSqlUserProfileForCompany(uid, companyId)) || baseProfile
    : await getSqlUserProfileForCompany(uid, companyId);

  if (!scopedProfile && !isDev) {
    throw new HttpsError('permission-denied', 'Company membership record not found');
  }

  const profile: any = scopedProfile || baseProfile;
  const resolvedRole = isDev && !scopedProfile
    ? 'dev'
    : String(profile.role || '').trim().toLowerCase();

  if (!resolvedRole) {
    throw new HttpsError('failed-precondition', 'User role is missing from profile');
  }

  const isSoloScope = Boolean(
    allowSoloScope &&
    String(profile.accountType || '').trim().toLowerCase() === 'solo' &&
    String(profile.companyId || '') === String(companyId || '')
  );

  if (!isSoloScope && !isDev && String(profile.companyId || '') !== String(companyId || '')) {
    throw new HttpsError('permission-denied', 'Company mismatch');
  }

  if (Array.isArray(allowedRoles) && allowedRoles.length > 0 && !allowedRoles.includes(resolvedRole)) {
    throw new HttpsError('permission-denied', 'Role is not allowed for this action');
  }

  return {
    profile,
    resolvedRole,
    isSoloScope,
    workerSnap: null,
  };
}

async function verifySqlManagerAuth(auth, targetWorkerUid, companyId) {
  if (!auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { profile, resolvedRole } = await assertSqlCompanyAccess({
    uid: auth.uid,
    companyId,
    allowedRoles: ['manager', 'dev'],
    allowSoloScope: false,
  });

  if (targetWorkerUid) {
    const targetProfile = await assertSqlTargetUserInCompany(targetWorkerUid, companyId);
    const targetRole = String(targetProfile.role || '').trim().toLowerCase();

    if (['manager', 'dev'].includes(targetRole) && resolvedRole !== 'dev') {
      throw new HttpsError('permission-denied', 'Cannot manage a user with manager or dev role');
    }
  }

  return {
    managerUid: auth.uid,
    managerEmail: auth.token?.email || profile.email || null,
  };
}

async function getSqlAuthenticatedUserProfile(auth, options: any = {}) {
  const {
    allowedRoles = null,
    requireCompany = false,
    companyId = null,
  } = options;

  if (!auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const profile: any = companyId
    ? ((await getSqlUserProfileForCompany(auth.uid, companyId)) || await getSqlUserProfileOrThrow(auth.uid))
    : await getSqlUserProfileOrThrow(auth.uid);

  const role = String(profile.role || '').trim().toLowerCase();
  if (!role) {
    throw new HttpsError('failed-precondition', 'User role is missing from profile');
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    throw new HttpsError('permission-denied', 'User role is not allowed for this action');
  }

  if (requireCompany && !profile.companyId) {
    throw new HttpsError('failed-precondition', 'User has no company assigned');
  }

  if (companyId && String(profile.companyId || '') !== String(companyId || '') && String(profile.systemRole || '') !== 'dev') {
    throw new HttpsError('permission-denied', 'Company name mismatch');
  }

  return { uid: auth.uid, userData: profile, role };
}

export { assertSqlCompanyAccess, assertSqlTargetUserInCompany, assertSqlTargetWorkerScopedUserInCompany, getSqlAuthenticatedUserProfile, getSqlUserProfileOrThrow, getSqlUserProfileForCompany, isSqlPersistenceEnabled, resolveSqlPersistenceBackend, verifySqlManagerAuth };

