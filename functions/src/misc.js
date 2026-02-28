/**
 * Miscellaneous domain module (upgrade requests, contact form).
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
  isRateLimited,
  getClientIp,
  isValidEmail,
  requireNonEmptyString,
  optionalTrimmedString,
  getUserProfileOrThrow,
  toProfileRole,
} = require('./shared');

/**
 * HTTP Function: requestUpgradeV1
 * Canonical privileged endpoint for upgrade request submission.
 */
exports.requestUpgradeV1 = onRequest({
  region: "us-central1",
  cors: CORS_ALLOWED_ORIGINS,
}, async (req, res) => {
  if (req.method !== 'POST') {
    return sendHttpError(res, 405, 'method_not_allowed', 'Only POST is allowed');
  }

  try {
    const body = parseJsonBody(req);
    const auth = await resolveHttpAuth(req, body);

    const requestedTier = requireNonEmptyString(body.requestedTier, 'requestedTier', 2, 32);
    const message = requireNonEmptyString(body.message, 'message', 10, 2000);
    const currentTier = optionalTrimmedString(body.currentTier, 32) || 'Basic';
    if (!['Solo', 'Team', 'Enterprise'].includes(requestedTier)) {
      throw new HttpsError('invalid-argument', 'requestedTier is invalid');
    }
    if (currentTier === requestedTier) {
      throw new HttpsError('invalid-argument', 'Requested tier must differ from current tier');
    }

    const profile = await getUserProfileOrThrow(auth.uid);
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
      status: 'new',
    });

    return sendHttpOk(res, { requestId: requestRef.id }, 201);
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
exports.contactRequestV1 = onRequest({
  region: "us-central1",
  cors: CORS_ALLOWED_ORIGINS,
  enforceAppCheck: false, // Public endpoint — no App Check required
}, async (req, res) => {
  if (req.method !== 'POST') {
    return sendHttpError(res, 405, 'method_not_allowed', 'Only POST is allowed');
  }

  // S6: IP-based rate limiting
  const clientIp = getClientIp(req);
  if (isRateLimited(`contact_${clientIp}`)) {
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
    });

    return sendHttpOk(res, { requestId: ref.id }, 201);
  } catch (error) {
    return sendCaughtHttpError(res, error);
  }
});
