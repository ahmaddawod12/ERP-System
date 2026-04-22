import { HttpsError } from 'firebase-functions/v2/https';
import admin from 'firebase-admin';
import { normalizeAccountType as normalizeContractAccountType } from '@smart-job/contracts';
import {
  assertSqlCompanyAccess,
  assertSqlTargetUserInCompany,
  assertSqlTargetWorkerScopedUserInCompany,
  getSqlAuthenticatedUserProfile,
  getSqlUserProfileOrThrow,
  isSqlPersistenceEnabled,
  verifySqlManagerAuth,
} from './sql-access';

type AuthLike = {
  uid: string;
  token?: {
    email?: string;
  };
} | null | undefined;

type UserProfileLike = {
  role?: string;
  accountType?: string;
  companyId?: string;
  wid?: string | number;
  mid?: string | number;
  [key: string]: any;
};

type HttpCompanyAccessParams = {
  uid: string;
  companyId: string;
  allowedRoles?: string[];
  allowSoloScope?: boolean;
  preloadedProfile?: UserProfileLike | null;
};

export function userDataDocPath(uid: string, docId: string): string {
  return `users/${uid}/data/${docId}`;
}

export function userProfileDocPath(uid: string): string {
  return userDataDocPath(uid, 'profile');
}

export function userCacheDocPath(uid: string): string {
  return userDataDocPath(uid, 'cache');
}

export function companyWorkerDocPath(companyId: string, wid: string | number): string {
  return `companies/${companyId}/workers/${wid}`;
}

export function companyManagerDocPath(companyId: string, mid: string | number): string {
  return `companies/${companyId}/managers/${mid}`;
}

export function normalizeRole(role: unknown): string {
  const raw = String(role || '').trim().toLowerCase();
  if (raw === 'manager') return 'manager';
  if (raw === 'worker') return 'worker';
  if (raw === 'user') return 'user';
  if (raw === 'basic') return 'basic';
  if (raw === 'dev') return 'dev';
  return '';
}

export function toProfileRole(role: unknown): string {
  return normalizeRole(role);
}

export function normalizeAccountType(accountType: unknown): string {
  return normalizeContractAccountType(accountType as string | null | undefined);
}

export function validateCompanyId(companyId: unknown): string {
  if (!companyId || typeof companyId !== 'string') {
    throw new HttpsError('invalid-argument', 'companyId is required');
  }
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(companyId)) {
    throw new HttpsError('invalid-argument', 'Invalid companyId format');
  }
  return companyId;
}

export async function getUserProfileOrThrow(uid: string): Promise<UserProfileLike> {
  if (isSqlPersistenceEnabled()) {
    return getSqlUserProfileOrThrow(uid);
  }

  const ref = admin.firestore().doc(userProfileDocPath(uid));
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'User profile not found');
  }
  return (snap.data() || {}) as UserProfileLike;
}

export async function assertTargetUserInCompany(targetUid: string, companyId: string): Promise<void> {
  if (isSqlPersistenceEnabled()) {
    await assertSqlTargetUserInCompany(targetUid, companyId);
    return;
  }

  const targetProfile = await getUserProfileOrThrow(targetUid);
  if (String(targetProfile.companyId || '') !== companyId) {
    throw new HttpsError('permission-denied', 'Target user is not in this company');
  }

  const targetRole = normalizeRole(targetProfile.role);
  if (targetRole === 'manager') {
    const targetMid = String(targetProfile.mid || '').trim();
    let managerSnap: FirebaseFirestore.DocumentSnapshot | null = null;
    if (targetMid) {
      managerSnap = await admin.firestore().doc(companyManagerDocPath(companyId, targetMid)).get();
    }
    if (!managerSnap || !managerSnap.exists) {
      const managerQuery = await admin.firestore()
        .collection(`companies/${companyId}/managers`)
        .where('uid', '==', targetUid)
        .limit(1)
        .get();
      if (managerQuery.empty) {
        throw new HttpsError('permission-denied', 'Target manager membership record not found');
      }
    }
    return;
  }

  const targetWid = String(targetProfile.wid || '').trim();
  if (!targetWid) {
    throw new HttpsError('permission-denied', 'Target user has no wid membership key');
  }

  const membershipSnap = await admin.firestore().doc(companyWorkerDocPath(companyId, targetWid)).get();
  if (!membershipSnap.exists) {
    throw new HttpsError('permission-denied', 'Target worker membership record not found');
  }
}

export async function assertTargetWorkerScopedUserInCompany(targetUid: string, companyId: string): Promise<void> {
  if (isSqlPersistenceEnabled()) {
    await assertSqlTargetWorkerScopedUserInCompany(targetUid, companyId);
    return;
  }

  const targetProfile = await getUserProfileOrThrow(targetUid);
  if (String(targetProfile.companyId || '') !== companyId) {
    throw new HttpsError('permission-denied', 'Target user is not in this company');
  }

  const targetRole = normalizeRole(targetProfile.role);
  if (!['worker', 'user', 'basic'].includes(targetRole)) {
    throw new HttpsError('permission-denied', 'Target user is not a worker-scoped member');
  }

  const targetWid = String(targetProfile.wid || '').trim();
  if (!targetWid) {
    throw new HttpsError('permission-denied', 'Target user has no wid membership key');
  }

  const membershipSnap = await admin.firestore().doc(companyWorkerDocPath(companyId, targetWid)).get();
  if (!membershipSnap.exists) {
    throw new HttpsError('permission-denied', 'Target worker membership record not found');
  }
}

export async function assertHttpCompanyAccess(params: HttpCompanyAccessParams): Promise<{
  profile: UserProfileLike;
  resolvedRole: string;
  isSoloScope: boolean;
  workerSnap: FirebaseFirestore.DocumentSnapshot | null;
}> {
  if (isSqlPersistenceEnabled()) {
    return assertSqlCompanyAccess(params);
  }

  const {
    uid,
    companyId,
    allowedRoles = [],
    allowSoloScope = false,
    preloadedProfile = null,
  } = params;

  const profile = preloadedProfile || await getUserProfileOrThrow(uid);
  const profileRole = normalizeRole(profile.role);
  if (!profileRole) {
    throw new HttpsError('failed-precondition', 'User role is missing from profile');
  }

  const profileAccountType = normalizeAccountType(profile.accountType);
  const profileCompanyId = String(profile.companyId || '');
  const isSoloScope = allowSoloScope && profileAccountType === 'solo' && profileCompanyId === companyId;

  let resolvedRole = profileRole;
  let workerSnap: FirebaseFirestore.DocumentSnapshot | null = null;

  if (!isSoloScope) {
    if (profileCompanyId !== companyId && profileRole !== 'dev') {
      throw new HttpsError('permission-denied', 'Company mismatch');
    }

    const profileWid = String(profile.wid || '').trim();
    const profileMid = String(profile.mid || '').trim();

    if (profileWid) {
      workerSnap = await admin.firestore().doc(companyWorkerDocPath(companyId, profileWid)).get();
    }

    if (workerSnap && workerSnap.exists) {
      const workerRole = normalizeRole(workerSnap.data()?.role);
      if (workerRole) {
        resolvedRole = workerRole;
      }
    }

    if ((!workerSnap || !workerSnap.exists) && profileRole === 'manager') {
      let managerSnap: FirebaseFirestore.DocumentSnapshot | null = null;
      if (profileMid) {
        managerSnap = await admin.firestore().doc(companyManagerDocPath(companyId, profileMid)).get();
      }
      if (!managerSnap || !managerSnap.exists) {
        const managerQuery = await admin.firestore()
          .collection(`companies/${companyId}/managers`)
          .where('uid', '==', uid)
          .limit(1)
          .get();
        if (!managerQuery.empty) {
          managerSnap = managerQuery.docs[0];
        }
      }
      if (managerSnap && managerSnap.exists) {
        const managerRole = normalizeRole(managerSnap.data()?.role);
        if (managerRole) {
          resolvedRole = managerRole;
        }
      } else {
        throw new HttpsError('permission-denied', 'Company manager membership record not found');
      }
    } else if (!workerSnap || !workerSnap.exists) {
      throw new HttpsError('permission-denied', 'Company worker membership record not found');
    }
  }

  if (Array.isArray(allowedRoles) && allowedRoles.length > 0 && !allowedRoles.includes(resolvedRole)) {
    throw new HttpsError('permission-denied', 'Role is not allowed for this action');
  }

  return {
    profile,
    resolvedRole,
    isSoloScope,
    workerSnap,
  };
}

export async function verifyManagerAuth(auth: AuthLike, targetWorkerUid: string | null, companyId: string): Promise<{
  managerUid: string;
  managerEmail: string | null | undefined;
}> {
  if (isSqlPersistenceEnabled()) {
    return verifySqlManagerAuth(auth, targetWorkerUid, companyId);
  }

  if (!auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const managerUid = auth.uid;
  const managerProfileRef = admin.firestore().doc(userProfileDocPath(managerUid));
  const managerProfile = await managerProfileRef.get();

  if (!managerProfile.exists) {
    throw new HttpsError('not-found', 'Manager profile not found');
  }

  const managerData = (managerProfile.data() || {}) as UserProfileLike;
  const managerRole: string = normalizeRole(managerData.role);

  if (!['manager', 'dev'].includes(managerRole)) {
    throw new HttpsError('permission-denied', 'Only managers can perform this action');
  }

  if (managerRole !== 'dev' && managerData.companyId !== companyId) {
    throw new HttpsError('permission-denied', 'Manager can only manage workers from their own company');
  }

  if (targetWorkerUid) {
    const workerProfileRef = admin.firestore().doc(userProfileDocPath(targetWorkerUid));
    const workerProfile = await workerProfileRef.get();

    if (!workerProfile.exists) {
      throw new HttpsError('not-found', 'Worker profile not found');
    }

    const workerData = workerProfile.data() as UserProfileLike;
    const workerRole = normalizeRole(workerData.role);

    if (['manager', 'dev'].includes(workerRole) && String(managerRole) !== 'dev') {
      throw new HttpsError('permission-denied', 'Cannot manage a user with manager or dev role');
    }

    if (workerData.companyId !== companyId) {
      throw new HttpsError('permission-denied', 'Worker is not from the same company');
    }
  }

  return { managerUid, managerEmail: auth.token?.email };
}

export async function getAuthenticatedUserProfile(auth: AuthLike, options: {
  allowedRoles?: string[] | null;
  requireCompany?: boolean;
  companyId?: string | null;
} = {}): Promise<{
  uid: string;
  userData: UserProfileLike;
  role: string;
}> {
  if (isSqlPersistenceEnabled()) {
    return getSqlAuthenticatedUserProfile(auth, options);
  }

  const {
    allowedRoles = null,
    requireCompany = false,
    companyId = null,
  } = options;

  if (!auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const uid = auth.uid;
  const userProfileRef = admin.firestore().doc(userProfileDocPath(uid));
  const userProfileDoc = await userProfileRef.get();

  if (!userProfileDoc.exists) {
    throw new HttpsError('not-found', 'User profile not found');
  }

  const userData = (userProfileDoc.data() || {}) as UserProfileLike;
  const role = normalizeRole(userData.role);

  if (!role) {
    throw new HttpsError('failed-precondition', 'User role is missing from profile');
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    throw new HttpsError('permission-denied', 'User role is not allowed for this action');
  }

  if (requireCompany && !userData.companyId) {
    throw new HttpsError('failed-precondition', 'User has no company assigned');
  }

  if (companyId && userData.companyId !== companyId) {
    throw new HttpsError('permission-denied', 'Company name mismatch');
  }

  return { uid, userData, role };
}