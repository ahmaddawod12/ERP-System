/**
 * Invite & join-company domain module.
 */

const {
  onRequest,
  HttpsError,
  resolveHttpAuth,
  sendHttpOk,
  sendHttpError,
  parseJsonBody,
  sendCaughtHttpError,
  CORS_ALLOWED_ORIGINS,
  admin,
  logger,
  validateCompanyId,
  assertHttpCompanyAccess,
  HTTP_COMPANY_MANAGER_ROLES,
  generateInviteCode,
  userProfileDocPath,
  companyWorkerDocPath,
  requireNonEmptyString,
  optionalTrimmedString,
  toProfileRole,
  isValidEmail,
  isRateLimited,
  getClientIp,
  redactEmail,
  normalizeRole,
  normalizeAccountType,
} = require('./shared');

/**
 * HTTP Function: createInviteV1
 */
exports.createInviteV1 = onRequest({
  region: "us-central1",
  cors: CORS_ALLOWED_ORIGINS,
}, async (req, res) => {
  if (req.method !== 'POST') {
    return sendHttpError(res, 405, 'method_not_allowed', 'Only POST is allowed');
  }

  // P1-4: Rate limit invite creation per IP
  const inviteIp = getClientIp(req);
  if (isRateLimited(`invite_${inviteIp}`)) {
    return sendHttpError(res, 429, 'rate_limited', 'Too many requests. Please try again later.');
  }

  try {
    const body = parseJsonBody(req);
    const auth = await resolveHttpAuth(req);

    const companyId = validateCompanyId(requireNonEmptyString(body.companyId, 'companyId', 3, 80));
    const rawTargetRole = String(body.targetRole || 'worker').trim();
    const targetRole = toProfileRole(rawTargetRole);
    if (!['worker', 'user', 'basic'].includes(targetRole)) {
      throw new HttpsError('invalid-argument', 'targetRole must be worker, user, or basic');
    }

    await assertHttpCompanyAccess({
      uid: auth.uid,
      companyId,
      allowedRoles: HTTP_COMPANY_MANAGER_ROLES,
      allowSoloScope: false,
    });

    const inviteCode = generateInviteCode();
    const inviteRef = admin.firestore()
      .collection('companies')
      .doc(companyId)
      .collection('invites')
      .doc();

    const now = Date.now();
    const expiresAt = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
    await inviteRef.set({
      inviteId: inviteRef.id,
      code: inviteCode,
      companyId,
      targetRole,
      status: 'active',
      createdBy: auth.uid,
      createdAt: new Date(now).toISOString(),
      expiresAt,
      usedBy: null,
      usedAt: null,
    });

    return sendHttpOk(res, {
      inviteId: inviteRef.id,
      inviteCode,
      expiresAt,
      targetRole,
    });
  } catch (error) {
    return sendCaughtHttpError(res, error);
  }
});

/**
 * HTTP Function: joinCompanyV1
 * Canonical privileged endpoint for company onboarding via invite.
 */
exports.joinCompanyV1 = onRequest({
  region: "us-central1",
  cors: CORS_ALLOWED_ORIGINS,
}, async (req, res) => {
  if (req.method !== 'POST') {
    return sendHttpError(res, 405, 'method_not_allowed', 'Only POST is allowed');
  }

  // P1-4: Rate limit join attempts per IP
  const joinIp = getClientIp(req);
  if (isRateLimited(`join_${joinIp}`)) {
    return sendHttpError(res, 429, 'rate_limited', 'Too many requests. Please try again later.');
  }

  try {
    const body = parseJsonBody(req);
    const auth = await resolveHttpAuth(req);

    const companyId = validateCompanyId(requireNonEmptyString(body.companyId, 'companyId', 3, 80));
    const inviteCode = requireNonEmptyString(body.inviteCode, 'inviteCode', 4, 80).toUpperCase();
    const email = requireNonEmptyString(body.email, 'email', 3, 320).toLowerCase();
    const name = optionalTrimmedString(body.name, 120);
    const phoneNumber = optionalTrimmedString(body.phoneNumber, 40);
    const requestedRole = body.role ? toProfileRole(String(body.role || '').trim()) : '';

    if (!isValidEmail(email)) {
      throw new HttpsError('invalid-argument', 'Invalid email format');
    }
    if (requestedRole && !['worker', 'user', 'basic'].includes(requestedRole)) {
      throw new HttpsError('invalid-argument', 'role must be worker, user, or basic');
    }
    if (auth.token?.email && String(auth.token.email).toLowerCase() !== email) {
      throw new HttpsError('permission-denied', 'Email does not match authenticated user');
    }

    const invitesRef = admin.firestore()
      .collection('companies')
      .doc(companyId)
      .collection('invites');
    const inviteQuery = await invitesRef.where('code', '==', inviteCode).limit(1).get();
    if (inviteQuery.empty) {
      throw new HttpsError('invalid-argument', 'Invalid invite code');
    }

    const inviteDocRef = inviteQuery.docs[0].ref;
    const workerRef = admin.firestore().doc(companyWorkerDocPath(companyId, auth.uid));
    const profileRef = admin.firestore().doc(userProfileDocPath(auth.uid));
    const companyCacheRef = admin.firestore().doc(`companies/${companyId}/data/cache`);
    const companyRef = admin.firestore().doc(`companies/${companyId}`);

    const result = await admin.firestore().runTransaction(async (tx) => {
      const [inviteSnap, workerSnap, profileSnap, companySnap] = await Promise.all([
        tx.get(inviteDocRef),
        tx.get(workerRef),
        tx.get(profileRef),
        tx.get(companyRef),
      ]);

      if (!inviteSnap.exists) {
        throw new HttpsError('invalid-argument', 'Invite code no longer exists');
      }

      const inviteData = inviteSnap.data() || {};
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const inviteExpiresAt = inviteData.expiresAt ? Date.parse(inviteData.expiresAt) : NaN;
      if (Number.isFinite(inviteExpiresAt) && inviteExpiresAt < now) {
        throw new HttpsError('failed-precondition', 'Invite code has expired');
      }

      const inviteUsedBy = String(inviteData.usedBy || '');
      const inviteStatus = String(inviteData.status || 'active');
      if (inviteStatus !== 'active' && inviteUsedBy !== auth.uid) {
        throw new HttpsError('failed-precondition', 'Invite code is not active');
      }
      if (inviteUsedBy && inviteUsedBy !== auth.uid) {
        throw new HttpsError('already-exists', 'Invite code was already used');
      }

      const resolvedRole = toProfileRole(
        workerSnap.exists
          ? workerSnap.data()?.role
          : (inviteData.targetRole || requestedRole || 'worker')
      );
      if (!['worker', 'user', 'basic'].includes(resolvedRole)) {
        throw new HttpsError('failed-precondition', 'Invite target role is invalid');
      }

      const isNewMembership = !workerSnap.exists;

      // Allocate sequential wid for new workers (mirrors manageWorker in auth.js)
      let workerSerial = null;
      if (isNewMembership) {
        workerSerial = Number(companySnap.data()?.wid || 1);
        tx.set(companyRef, { wid: workerSerial + 1 }, { merge: true });
      }

      tx.set(inviteDocRef, {
        usedBy: auth.uid,
        usedAt: nowIso,
        status: 'used',
      }, { merge: true });

      tx.set(workerRef, {
        workerId: auth.uid,
        uid: auth.uid,
        email,
        role: resolvedRole,
        name,
        phoneNumber,
        ...(workerSerial !== null ? { wid: workerSerial } : {}),
        createdAt: workerSnap.exists ? (workerSnap.data()?.createdAt || nowIso) : nowIso,
        updatedAt: nowIso,
      }, { merge: true });

      tx.set(profileRef, {
        uid: auth.uid,
        email,
        role: resolvedRole,
        companyId,
        accountType: 'business',
        name,
        phoneNumber,
        createdAt: profileSnap.exists ? (profileSnap.data()?.createdAt || nowIso) : nowIso,
        updatedAt: nowIso,
      }, { merge: true });

      if (isNewMembership) {
        tx.set(companyCacheRef, {
          workersVersion: admin.firestore.FieldValue.increment(1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      } else {
        tx.set(companyCacheRef, {
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }

      return { companyId, role: resolvedRole };
    });

    return sendHttpOk(res, result);
  } catch (error) {
    return sendCaughtHttpError(res, error);
  }
});
