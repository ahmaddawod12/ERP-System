/**
 * Miscellaneous domain module (upgrade requests, contact form).
 */
const {
  normalizeTier,
  UPGRADEABLE_TIERS,
  TIER_VALUES,
  getEnabledModulesForTier,
} = require('@smart-job/contracts');

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
  isRateLimited,
  getClientIp,
  isValidEmail,
  requireNonEmptyString,
  optionalTrimmedString,
  getUserProfileOrThrow,
  toProfileRole,
} = require('./shared');

function isDevRole(role) {
  return String(role || '').trim().toLowerCase() === 'dev';
}

async function requireDevProfile(uid) {
  const profile: any = await getUserProfileOrThrow(uid);
  if (!isDevRole(profile.role)) {
    throw new HttpsError('permission-denied', 'Only dev admins can perform this action');
  }
  return profile;
}

/**
 * HTTP Function: requestUpgradeV1
 * Canonical privileged endpoint for upgrade request submission.
 */
export const requestUpgradeV1 = onRequest({
  region: "us-central1",
  cors: CORS_ALLOWED_ORIGINS,
  enforceAppCheck: false,
}, async (req, res) => {
  if (req.method !== 'POST') {
    return sendHttpError(res, 405, 'method_not_allowed', 'Only POST is allowed');
  }

  const clientIp = getClientIp(req);
  if (await isRateLimited(`upgrade_${clientIp}`)) {
    return sendHttpError(res, 429, 'rate_limited', 'Too many requests. Please try again later.');
  }

  try {
    const body = parseJsonBody(req);
    const auth = await resolveHttpAuth(req);

    const requestedTier = requireNonEmptyString(body.requestedTier, 'requestedTier', 2, 32);
    const message = requireNonEmptyString(body.message, 'message', 10, 2000);
    if (!UPGRADEABLE_TIERS.includes(requestedTier)) {
      throw new HttpsError('invalid-argument', 'requestedTier is invalid');
    }

    const profile: any = await getUserProfileOrThrow(auth.uid);
    let currentTier = 'Basic';
    if (profile.companyId) {
      const subscriptionSnap = await admin.firestore().doc(`companies/${profile.companyId}/data/subscription`).get();
      currentTier = normalizeTier(subscriptionSnap.data()?.tier) || currentTier;
    }
    if (currentTier === requestedTier) {
      throw new HttpsError('invalid-argument', 'Requested tier must differ from current tier');
    }
    const requestRef = admin.firestore().collection('upgrade_requests').doc();
    const nowIso = new Date().toISOString();
    await requestRef.set({
      uid: auth.uid,
      email: profile.email || auth.token?.email || null,
      companyId: profile.companyId || null,
      role: toProfileRole(profile.role || ''),
      currentTier,
      requestedTier,
      message,
      createdAt: nowIso,
      updatedAt: nowIso,
      status: 'pending',
    });

    return sendHttpOk(res, { requestId: requestRef.id }, 201);
  } catch (error) {
    return sendCaughtHttpError(res, error);
  }
});

/**
 * HTTP Function: listUpgradeRequestsV1
 * Returns upgrade requests for dev moderation UI.
 */
export const listUpgradeRequestsV1 = onRequest({
  region: "us-central1",
  cors: CORS_ALLOWED_ORIGINS,
  enforceAppCheck: false,
}, async (req, res) => {
  if (req.method !== 'POST') {
    return sendHttpError(res, 405, 'method_not_allowed', 'Only POST is allowed');
  }

  try {
    const auth = await resolveHttpAuth(req);
    await requireDevProfile(auth.uid);

    const body = parseJsonBody(req);
    const limitValue = Math.min(
      200,
      Math.max(1, Number(body.limit || 100) || 100),
    );

    const snapshot = await admin.firestore()
      .collection('upgrade_requests')
      .orderBy('createdAt', 'desc')
      .limit(limitValue)
      .get();

    const items = snapshot.docs.map((docSnap) => {
      const data = docSnap.data() || {};
      return {
        id: docSnap.id,
        uid: data.uid || null,
        email: data.email || null,
        companyId: data.companyId || null,
        role: toProfileRole(data.role || ''),
        currentTier: normalizeTier(data.currentTier) || 'Basic',
        requestedTier: normalizeTier(data.requestedTier) || null,
        message: data.message || '',
        status: data.status || 'pending',
        createdAt: data.createdAt || null,
        updatedAt: data.updatedAt || null,
        moderatedAt: data.moderatedAt || null,
        moderatedByUid: data.moderatedByUid || null,
        moderationNote: data.moderationNote || '',
      };
    });

    return sendHttpOk(res, { items, allowedTiers: TIER_VALUES });
  } catch (error) {
    return sendCaughtHttpError(res, error);
  }
});

/**
 * HTTP Function: moderateUpgradeRequestV1
 * Approves or rejects an existing upgrade request.
 */
export const moderateUpgradeRequestV1 = onRequest({
  region: "us-central1",
  cors: CORS_ALLOWED_ORIGINS,
  enforceAppCheck: false,
}, async (req, res) => {
  if (req.method !== 'POST') {
    return sendHttpError(res, 405, 'method_not_allowed', 'Only POST is allowed');
  }

  try {
    const auth = await resolveHttpAuth(req);
    const moderatorProfile = await requireDevProfile(auth.uid);
    const body = parseJsonBody(req);

    const requestId = requireNonEmptyString(body.requestId, 'requestId', 3, 128);
    const status = requireNonEmptyString(body.status, 'status', 4, 32).toLowerCase();
    const moderationNote = optionalTrimmedString(body.moderationNote, 1000) || '';

    if (!['approved', 'rejected', 'pending'].includes(status)) {
      throw new HttpsError('invalid-argument', 'status must be approved, rejected, or pending');
    }

    const requestRef = admin.firestore().collection('upgrade_requests').doc(requestId);
    const snap = await requestRef.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Upgrade request not found');
    }

    const requestData = snap.data() || {};
    if (requestData.appliedAt && status !== 'approved') {
      throw new HttpsError('failed-precondition', 'Applied upgrade requests cannot be moved back to pending or rejected');
    }
    const requestedTier = normalizeTier(requestData.requestedTier);
    const companyId = String(requestData.companyId || '').trim();
    const nowIso = new Date().toISOString();
    const batch = admin.firestore().batch();
    batch.set(requestRef, {
      status,
      moderationNote,
      updatedAt: nowIso,
      moderatedAt: nowIso,
      moderatedByUid: auth.uid,
      moderatedByName: moderatorProfile.name || moderatorProfile.email || auth.uid,
    }, { merge: true });
    if (status === 'approved' && requestedTier && companyId) {
      batch.set(admin.firestore().doc(`companies/${companyId}/data/subscription`), {
        tier: requestedTier,
        status: 'active',
        enabledModules: getEnabledModulesForTier(requestedTier),
        updatedAt: nowIso,
      }, { merge: true });

      batch.set(requestRef, {
        currentTier: requestedTier,
        appliedAt: nowIso,
        appliedByUid: auth.uid,
      }, { merge: true });
    }
    await batch.commit();

    return sendHttpOk(res, { requestId, status });
  } catch (error) {
    return sendCaughtHttpError(res, error);
  }
});

/**
 * HTTP Function: contactRequestV1
 * Canonical endpoint for public contact submissions.
 * Rate-limited per IP (S6).
 * P1-2: Exempt from App Check (public endpoint).
 */
export const contactRequestV1 = onRequest({
  region: "us-central1",
  cors: CORS_ALLOWED_ORIGINS,
  enforceAppCheck: false, // Public endpoint — no App Check required
}, async (req, res) => {
  if (req.method !== 'POST') {
    return sendHttpError(res, 405, 'method_not_allowed', 'Only POST is allowed');
  }

  // S6: IP-based rate limiting
  const clientIp = getClientIp(req);
  if (await isRateLimited(`contact_${clientIp}`)) {
    return sendHttpError(res, 429, 'rate_limited', 'Too many requests. Please try again later.');
  }

  try {
    const body = parseJsonBody(req);
    const name = requireNonEmptyString(body.name, 'name', 2, 120);
    const email = requireNonEmptyString(body.email, 'email', 5, 320).toLowerCase();
    const company = requireNonEmptyString(body.company, 'company', 2, 140);
    const message = requireNonEmptyString(body.message, 'message', 8, 2000);

    if (!isValidEmail(email)) {
      throw new HttpsError('invalid-argument', 'Invalid email format');
    }
    if (optionalTrimmedString(body.website || body.url || body.companyWebsite, 500)) {
      throw new HttpsError('invalid-argument', 'Invalid contact request');
    }

    const ref = admin.firestore().collection('contact_requests').doc();
    const nowIso = new Date().toISOString();
    await ref.set({
      name,
      email,
      company,
      message,
      status: 'new',
      createdAt: nowIso,
      updatedAt: nowIso,
      expireAt: admin.firestore.Timestamp.fromMillis(Date.now() + 180 * 24 * 60 * 60 * 1000),
    });

    return sendHttpOk(res, { requestId: ref.id }, 201);
  } catch (error) {
    return sendCaughtHttpError(res, error);
  }
});
