const { HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { normalizeAccountType: normalizeContractAccountType } = require("@smart-job/contracts");

function userDataDocPath(uid, docId) {
  return `users/${uid}/data/${docId}`;
}

function userProfileDocPath(uid) {
  return userDataDocPath(uid, 'profile');
}

function userCacheDocPath(uid) {
  return userDataDocPath(uid, 'cache');
}

function companyWorkerDocPath(companyId, wid) {
  return `companies/${companyId}/workers/${wid}`;
}

function companyManagerDocPath(companyId, mid) {
  return `companies/${companyId}/managers/${mid}`;
}

function normalizeRole(role) {
  const raw = String(role || '').trim().toLowerCase();
  if (raw === 'manager') return 'manager';
  if (raw === 'worker') return 'worker';
  if (raw === 'user') return 'user';
  if (raw === 'basic') return 'basic';
  if (raw === 'dev') return 'dev';
  return '';
}

function toProfileRole(role) {
  return normalizeRole(role);
}

function normalizeAccountType(accountType) {
  return normalizeContractAccountType(accountType);
}

function validateCompanyId(companyId) {
  if (!companyId || typeof companyId !== 'string') {
    throw new HttpsError('invalid-argument', 'companyId is required');
  }
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(companyId)) {
    throw new HttpsError('invalid-argument', 'Invalid companyId format');
  }
  return companyId;
}

async function getUserProfileOrThrow(uid) {
  const ref = admin.firestore().doc(userProfileDocPath(uid));
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'User profile not found');
  }
  return snap.data() || {};
}

async function assertTargetUserInCompany(targetUid, companyId) {
  const targetProfile = await getUserProfileOrThrow(targetUid);
  if (String(targetProfile.companyId || '') !== companyId) {
    throw new HttpsError('permission-denied', 'Target user is not in this company');
  }

  const targetRole = normalizeRole(targetProfile.role);
  if (targetRole === 'manager') {
    const targetMid = String(targetProfile.mid || '').trim();
    let managerSnap = null;
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

async function assertTargetWorkerScopedUserInCompany(targetUid, companyId) {
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

async function assertHttpCompanyAccess(params) {
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
  let workerSnap = null;

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
      let managerSnap = null;
      if (profileMid) {
        managerSnap = await admin.firestore().doc(companyManagerDocPath(companyId, profileMid)).get();
      }
      if ((!managerSnap || !managerSnap.exists) && profileRole !== 'dev') {
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
      } else if (profileRole !== 'dev') {
        throw new HttpsError('permission-denied', 'Company manager membership record not found');
      }
    } else if ((!workerSnap || !workerSnap.exists) && profileRole !== 'dev') {
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

async function verifyManagerAuth(auth, targetWorkerUid, companyId) {
  if (!auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const managerUid = auth.uid;
  const managerProfileRef = admin.firestore().doc(userProfileDocPath(managerUid));
  const managerProfile = await managerProfileRef.get();

  if (!managerProfile.exists) {
    throw new HttpsError('not-found', 'Manager profile not found');
  }

  const managerData = managerProfile.data();
  const managerRole = normalizeRole(managerData.role);

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

    const workerData = workerProfile.data();
    const workerRole = normalizeRole(workerData.role);

    if (['manager', 'dev'].includes(workerRole) && managerRole !== 'dev') {
      throw new HttpsError('permission-denied', 'Cannot manage a user with manager or dev role');
    }

    if (workerData.companyId !== companyId) {
      throw new HttpsError('permission-denied', 'Worker is not from the same company');
    }
  }

  return { managerUid, managerEmail: auth.token.email };
}

async function getAuthenticatedUserProfile(auth, options = {}) {
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

  const userData = userProfileDoc.data() || {};
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

module.exports = {
  userDataDocPath,
  userProfileDocPath,
  userCacheDocPath,
  companyWorkerDocPath,
  companyManagerDocPath,
  normalizeRole,
  toProfileRole,
  normalizeAccountType,
  validateCompanyId,
  getUserProfileOrThrow,
  assertTargetUserInCompany,
  assertTargetWorkerScopedUserInCompany,
  assertHttpCompanyAccess,
  verifyManagerAuth,
  getAuthenticatedUserProfile,
};
