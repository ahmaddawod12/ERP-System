/**
 * Tax Authority domain module
 * OAuth2 flow, callback handling, and invoice approval submission.
 */

const {
  admin,
  logger,
  axios,
  crypto,
  onCall,
  HttpsError,
  onRequest,
  DOC_TYPE,
  MAX_ITEMS_PER_DOCUMENT,
  VAT_RATE,
  CORS_ALLOWED_ORIGINS,
  GENERATE_TOPIC,
  getPubSub,
  normalizeRole,
  userProfileDocPath,
  getAuthenticatedUserProfile,
  assertHttpCompanyAccess,
  toDocumentDocId,
  toBaseDocumentId,
  saveAuditLog,
  clearCompanyBusyFlag,
  acquireCompanyBusyFlag,
  publishGenerateTaskHelper,
} = require('./shared');
const {
  TAX_AUTHORITY_CONFIG,
  encodeBase64Url,
  decodeBase64Url,
  buildAuthCallbackDeepLink,
  generateSuccessHTML,
  ensureTaxAuthorityConfigForCallable,
} = require('./tax-oauth');
const {
  buildStoredTaxInvoiceDocument,
  getClientVatNumber,
  normalizeInvoiceDate,
  normalizeTaxInvoiceClient,
} = require('./tax-invoice');

const TAX_INVOICE_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const TAX_INVOICE_LOCK_STALE_MS = 5 * 60 * 1000;

async function setTaxInvoiceReservationState(reservationRef, status, fields = {}) {
  await reservationRef.set({
    status,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...fields,
  }, { merge: true });
}

function sanitizeExternalErrorData(data) {
  if (!data || typeof data !== 'object') return null;
  const result = {};
  for (const key of Object.keys(data).slice(0, 20)) {
    if (/token|secret|code|authorization/i.test(key)) continue;
    const value = data[key];
    result[key] = typeof value === 'string' ? value.slice(0, 500) : value;
  }
  return result;
}

function validateTaxInvoiceItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpsError('invalid-argument', 'At least one item is required');
  }
  if (items.length > MAX_ITEMS_PER_DOCUMENT) {
    throw new HttpsError('invalid-argument', `Too many items (max ${MAX_ITEMS_PER_DOCUMENT})`);
  }
  return items.map((item, index) => {
    const description = String(item?.description || '').trim();
    const quantity = Number(item?.quantity ?? 1);
    const price = Number(item?.price);
    if (!description || description.length > 240) {
      throw new HttpsError('invalid-argument', `items[${index}].description is required and must be 240 characters or less`);
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new HttpsError('invalid-argument', `items[${index}].quantity must be a positive finite number`);
    }
    if (!Number.isFinite(price) || price < 0) {
      throw new HttpsError('invalid-argument', `items[${index}].price must be a non-negative finite number`);
    }
    return {
      ...item,
      description,
      quantity,
      price,
    };
  });
}

function normalizeTaxInvoiceIdempotencyKey(value) {
  const normalized = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{12,128}$/.test(normalized)) {
    throw new HttpsError('invalid-argument', 'idempotencyKey is required and must be 12-128 URL-safe characters');
  }
  return normalized;
}

function hashIdempotencyKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function normalizeLinkedJobIds(jobsData) {
  if (!Array.isArray(jobsData)) return [];
  const ids = [];
  for (const entry of jobsData) {
    const jobId = toBaseDocumentId(entry?.jobId);
    if (jobId && !ids.includes(jobId)) {
      ids.push(jobId);
    }
  }
  if (ids.length > 100) {
    throw new HttpsError('invalid-argument', 'Too many linked jobs');
  }
  return ids;
}

// =============================================================================
// EXPORTED CLOUD FUNCTIONS
// =============================================================================

/**
 * Cloud Function: Start Tax Authority Authorization
 * Called by the app when user clicks "Grant Permission"
 * Returns the authorization URL for the user to visit
 *
 * @returns {Object} { success, authorizationUrl }
 */
exports.startTaxAuthorityAuth = onCall({
  region: "us-central1",
}, async (request) => {
  try {
    ensureTaxAuthorityConfigForCallable();

    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const uid = request.auth.uid;
    logger.info('startTaxAuthorityAuth called', { uid });

    const userProfileRef = admin.firestore().doc(userProfileDocPath(uid));
    const userProfile = await userProfileRef.get();

    if (!userProfile.exists) {
      throw new HttpsError('not-found', 'User profile not found');
    }

    const userData = userProfile.data();
    if (normalizeRole(userData.role) !== 'manager') {
      throw new HttpsError('permission-denied', 'Only managers can authorize Tax Authority access');
    }

    const companyId = userData.companyId;
    if (!companyId) {
      throw new HttpsError('failed-precondition', 'User has no company assigned');
    }
    await assertHttpCompanyAccess({
      uid,
      companyId,
      allowedRoles: ['manager', 'dev'],
      allowSoloScope: false,
    });

    // Store pending authorization in Firestore to track which company initiated the flow
    const pendingAuthRef = admin.firestore().collection('taxAuthPending').doc();
    const authId = pendingAuthRef.id;
    const stateNonce = crypto.randomBytes(16).toString('hex');
    const oauthState = encodeBase64Url(`${authId}.${stateNonce}`);
    
    await pendingAuthRef.set({
      authId: authId,
      companyId: companyId,
      uid: uid,
      email: request.auth.token.email,
      state: oauthState,
      stateNonce: stateNonce,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtMillis: Date.now(),
      status: 'pending',
      expiresAt: Date.now() + (10 * 60 * 1000), // Expires in 10 minutes
    });

    logger.info('Starting Tax Authority OAuth flow', {
      authId: authId,
      companyId: companyId,
      uid: uid,
      callbackUrl: TAX_AUTHORITY_CONFIG.callbackUrl,
    });

    const authParams = new URLSearchParams({
      response_type: 'code',
      client_id: TAX_AUTHORITY_CONFIG.clientId,
      scope: TAX_AUTHORITY_CONFIG.scope,
      redirect_uri: TAX_AUTHORITY_CONFIG.callbackUrl,
      state: oauthState,
    });

    const authorizationUrl = `${TAX_AUTHORITY_CONFIG.authUrl}?${authParams.toString()}`;

    logger.info('Generated authorization URL', { 
      authId: authId,
      uid, 
      companyId,
      callbackUrl: TAX_AUTHORITY_CONFIG.callbackUrl
    });

    return {
      success: true,
      authorizationUrl: authorizationUrl,
    };

  } catch (error) {
    logger.error('Error in startTaxAuthorityAuth:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }
    
    throw new HttpsError('internal', 'Failed to start authorization');
  }
});

/**
 * HTTP Cloud Function: Tax Authority OAuth Callback
 * This is the redirect_uri that Tax Authority will call after user login
 * Simply receives the authorization code and saves it to Firestore
 */
exports.taxAuthorityCallback = onRequest({
  region: "me-west1",
  cors: CORS_ALLOWED_ORIGINS,
  timeoutSeconds: 30,
  memory: "512MiB",
  // Tax Authority OAuth redirects cannot carry an App Check token.
  // Auth is validated via state/nonce from Firestore instead.
  enforceAppCheck: false,
}, async (req, res) => {
  res.set('Cache-Control', 'private, max-age=0');
  
  try {
    try {
      ensureTaxAuthorityConfigForCallable();
    } catch {
      const notConfiguredLink = buildAuthCallbackDeepLink({
        success: false,
        error: 'Tax Authority OAuth is not configured on server.'
      });
      return res.send(generateSuccessHTML(notConfiguredLink, false, 'Server OAuth configuration missing'));
    }

    const { code, error, error_description, state } = req.query;

    // Handle OAuth errors from Tax Authority
    if (error) {
      const deepLink = buildAuthCallbackDeepLink({
        success: false,
        error: error_description || error,
      });
      return res.send(generateSuccessHTML(deepLink, false, error_description || error));
    }

    if (!code || !state) {
      const deepLink = buildAuthCallbackDeepLink({
        success: false,
        error: 'Missing authorization code or state'
      });
      return res.send(generateSuccessHTML(deepLink, false, 'Missing authorization code or state'));
    }

    let authId;
    try {
      const decodedState = decodeBase64Url(state);
      authId = String(decodedState || '').split('.')[0];
      if (!authId || !/^[A-Za-z0-9_-]{10,}$/.test(authId)) {
        throw new Error('Invalid auth session id');
      }
    } catch (decodeError) {
      const deepLink = buildAuthCallbackDeepLink({
        success: false,
        error: 'Invalid authorization state'
      });
      return res.send(generateSuccessHTML(deepLink, false, 'Invalid authorization state'));
    }

    const pendingAuthRef = admin.firestore().doc(`taxAuthPending/${authId}`);
    const callbackRecordRef = admin.firestore().doc(`taxAuthCallbacks/${authId}`);
    const receivedAtMillis = Date.now();
    const pendingAuthData = await admin.firestore().runTransaction(async (tx) => {
      const pendingAuthSnap = await tx.get(pendingAuthRef);
      if (!pendingAuthSnap.exists) {
        return null;
      }
      const data = pendingAuthSnap.data() || {};
      if (data.state !== state) {
        throw new HttpsError('permission-denied', 'Authorization state mismatch');
      }
      if (data.status !== 'pending') {
        throw new HttpsError('already-exists', 'Authorization session already used');
      }
      if (data.expiresAt && Date.now() > data.expiresAt) {
        throw new HttpsError('deadline-exceeded', 'Authorization session expired');
      }
      tx.update(pendingAuthRef, {
        status: 'used',
        usedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      tx.set(callbackRecordRef, {
        authId,
        companyId: data.companyId || null,
        uid: data.uid || null,
        state,
        codeHash: crypto.createHash('sha256').update(String(code)).digest('hex'),
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        receivedAtMillis,
        used: false,
        codeLength: String(code).length,
      }, { merge: true });
      return data;
    });

    if (!pendingAuthData) {
      const deepLink = buildAuthCallbackDeepLink({
        success: false,
        error: 'Authorization session not found or expired'
      });
      return res.send(generateSuccessHTML(deepLink, false, 'Authorization session not found or expired'));
    }

    if (pendingAuthData.state !== state) {
      const deepLink = buildAuthCallbackDeepLink({
        success: false,
        error: 'Authorization state mismatch'
      });
      return res.send(generateSuccessHTML(deepLink, false, 'Authorization state mismatch'));
    }
    if (pendingAuthData.status !== 'pending') {
      const deepLink = buildAuthCallbackDeepLink({
        success: false,
        error: 'Authorization session already used'
      });
      return res.send(generateSuccessHTML(deepLink, false, 'Authorization session already used'));
    }
    if (pendingAuthData.expiresAt && Date.now() > pendingAuthData.expiresAt) {
      const deepLink = buildAuthCallbackDeepLink({
        success: false,
        error: 'Authorization session expired'
      });
      return res.send(generateSuccessHTML(deepLink, false, 'Authorization session expired'));
    }

    const existingCallback = await callbackRecordRef.get();
    if (existingCallback.exists && existingCallback.data()?.used) {
      const existingData = existingCallback.data();
      const deepLink = buildAuthCallbackDeepLink({
        success: true,
        callbackId: callbackRecordRef.id,
        tokenExchanged: existingData.tokenExchangeSuccess || false
      });
      return res.send(generateSuccessHTML(deepLink, existingData.tokenExchangeSuccess || false, existingData.tokenExchangeError || null));
    }

    // IMMEDIATELY exchange the code for tokens while it's fresh
    let tokenExchangeSuccess = false;
    let tokenExchangeError = null;
    const companyId = pendingAuthData.companyId || null;

    try {
      // Exchange authorization code for tokens (axios-retry handles retries automatically)
      const tokenResponse = await axios.post(
        TAX_AUTHORITY_CONFIG.tokenUrl,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: TAX_AUTHORITY_CONFIG.callbackUrl,
          scope: TAX_AUTHORITY_CONFIG.scope,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(
              TAX_AUTHORITY_CONFIG.clientId + ':' + TAX_AUTHORITY_CONFIG.clientSecret
            ).toString('base64'),
          },
          timeout: 20000,
        }
      );

      const tokenData = tokenResponse.data;

      // Calculate token expiration timestamps using actual API response values
      const now = Date.now();
      const accessTokenExpiresAt = now + (tokenData.expires_in * 1000);
      // Use actual refresh_token_expires_in from response (not hardcoded 90 days)
      const refreshTokenExpiresAt = tokenData.refresh_token_expires_in 
        ? now + (tokenData.refresh_token_expires_in * 1000)
        : now + (90 * 24 * 60 * 60 * 1000); // Fallback to 90 days if not provided

      // Save tokens directly to company settings in Firebase (if company known)
      if (companyId) {
        const companySettingsRef = admin.firestore().doc(`companies/${companyId}/data/token`);
        await companySettingsRef.set({
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          accessTokenExpiresAt: accessTokenExpiresAt,
          refreshTokenExpiresAt: refreshTokenExpiresAt,
          authorizedAt: admin.firestore.FieldValue.serverTimestamp(),
          callbackId: callbackRecordRef.id,
        }, { merge: true });

        // Save audit log
        await saveAuditLog(companyId, 'taxAuthorityAuthorized', 'system_callback');
      }

      await callbackRecordRef.update({
        used: true,
        usedAt: admin.firestore.FieldValue.serverTimestamp(),
        tokenExchangeSuccess: true,
        companyId,
        expiresIn: tokenData.expires_in,
        accessTokenExpiresAt: accessTokenExpiresAt,
        refreshTokenExpiresAt: refreshTokenExpiresAt,
      });

      tokenExchangeSuccess = true;

    } catch (exchangeError) {
      tokenExchangeError = exchangeError.response?.data?.error_description || 
                          exchangeError.response?.data?.error || 
                          exchangeError.message;

      // Save error info to callback record
      await callbackRecordRef.update({
        tokenExchangeSuccess: false,
        tokenExchangeError: tokenExchangeError,
        tokenExchangeAttemptedAt: admin.firestore.FieldValue.serverTimestamp(),
        used: true,
      });
    }

    // Return success HTML page with deep link and instructions
    const deepLink = buildAuthCallbackDeepLink({
      success: true,
      callbackId: callbackRecordRef.id,
      tokenExchanged: tokenExchangeSuccess
    });
    
    return res.send(generateSuccessHTML(deepLink, tokenExchangeSuccess, tokenExchangeError));

  } catch (error) {
    logger.error('Error in taxAuthorityCallback:', {
      message: error.message,
      stack: error.stack,
    });
    
    // Return error HTML page
    const errorMessage = error.message || 'Failed to process authorization';
    const deepLink = buildAuthCallbackDeepLink({
      success: false,
      error: errorMessage
    });
    
    return res.send(generateSuccessHTML(deepLink, false, errorMessage));
  }
});


/**
 * Cloud Function: Submit Invoice to Tax Authority for Approval
 * CRITICAL: This function now handles the FIRST step in invoice generation:
 * 1. Accepts full document data (client, items, company, etc.)
 * 2. Saves document metadata to Firestore BEFORE Tax Authority submission
 * 3. Submits invoice to Israeli Tax Authority API for approval
 * 4. Returns documentId and approval status
 * 5. Frontend then calls generateDocument with documentId if approved
 * 
 * @param {Object} request.data - Full document data
 * @param {number} request.data.type - Document type (must be 305 for tax invoice)
 * @param {Object} request.data.client - Client details {name, email, phone, address, id}
 * @param {Array} request.data.items - Invoice items [{description, quantity, price}]
 * @param {Object} request.data.company - Company details {name, email, phone, address, vatNumber, etc.}
 * @param {string} request.data.companyId - Company name for Firestore path
 * @param {Object} request.data.businessInfo - Business registration data {vat_number, document_numbers, etc.}
 * @param {string} request.data.language - Language (he, en, ar)
 * @param {string} request.data.date - Invoice date YYYY-MM-DD
 * @param {string} request.data.notes - Optional notes
 * @param {Array<Object>} request.data.jobsData - Optional job references
 * 
 * @returns {Object} { success, documentId, documentNumber, status, message, confirmationNumber, approved, savedPath, metadata }
 */
exports.getInvoiceApproval = onCall({
  region: "me-west1",
  memory: "256MiB",
  timeoutSeconds: 60,
}, async (request) => {
  const startTime = Date.now();
  let reservationRef = null;
  let idempotencyRef = null;
  
  try {
    // Log authentication status immediately
    logger.info('getInvoiceApproval called', {
      hasAuth: !!request.auth,
      authUid: request.auth?.uid,
      timestamp: new Date().toISOString()
    });

    if (!request.auth) {
      logger.error('Authentication missing', {
        hasRequest: !!request,
        requestKeys: Object.keys(request)
      });
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }
    ensureTaxAuthorityConfigForCallable();

    const uid = request.auth.uid;
    logger.info('Processing invoice for user', { uid });

    const {
      type, client, items, companyId,
      language, date, notes, jobsData, priceProposalId,
      idempotencyKey: rawIdempotencyKey,
    } = request.data || {};

    if (!companyId) {
      throw new HttpsError('invalid-argument', 'Company ID is required for Firestore');
    }

    const { userData, role } = await getAuthenticatedUserProfile(request.auth, {
      allowedRoles: ['manager', 'user'],
      requireCompany: true,
      companyId,
    });

    logger.info('User authorized for invoice approval', { uid, role, companyId });

    // Validate required fields for document
    const numericType = Number(type);
    if (!type || numericType !== DOC_TYPE.TAX_INVOICE) {
      throw new HttpsError('invalid-argument', 'Document type must be taxInvoice (305)');
    }
    if (!client || !client.name) {
      throw new HttpsError('invalid-argument', 'Client name is required');
    }
    const normalizedItems = validateTaxInvoiceItems(items);
    const idempotencyKey = normalizeTaxInvoiceIdempotencyKey(rawIdempotencyKey);
    idempotencyRef = admin.firestore().doc(
      `companies/${companyId}/tax_invoice_idempotency/${hashIdempotencyKey(idempotencyKey)}`,
    );
    const linkedJobIds = normalizeLinkedJobIds(jobsData);
    const normalizedPriceProposalId = priceProposalId ? toDocumentDocId(priceProposalId) : '';

    if (linkedJobIds.length > 0) {
      const jobSnaps = await admin.firestore().getAll(
        ...linkedJobIds.map((jobId) => admin.firestore().doc(`companies/${companyId}/jobs/${jobId}`)),
      );
      jobSnaps.forEach((snap, index) => {
        const linkedJobId = linkedJobIds[index];
        if (!snap.exists) {
          throw new HttpsError('not-found', `Linked job ${linkedJobId} was not found`);
        }
        const job = snap.data() || {};
        if (job.status !== 'finished') {
          throw new HttpsError('failed-precondition', `Linked job ${linkedJobId} must be finished before invoicing`);
        }
        if (job.isCert === true) {
          throw new HttpsError('failed-precondition', `Linked job ${linkedJobId} already has a tax invoice`);
        }
        if (role !== 'manager' && String(job.wid || '') !== String(userData.wid || '')) {
          throw new HttpsError('permission-denied', `You cannot invoice linked job ${linkedJobId}`);
        }
      });
    }

    if (normalizedPriceProposalId) {
      const proposalRef = admin.firestore().doc(`companies/${companyId}/documents/${normalizedPriceProposalId}`);
      const proposalSnap = await proposalRef.get();
      if (!proposalSnap.exists) {
        throw new HttpsError('not-found', 'Price proposal not found');
      }
      const proposal = proposalSnap.data() || {};
      const proposalType = Number(proposal.documentType ?? proposal.type);
      if (proposalType !== DOC_TYPE.PRICE_PROPOSAL) {
        throw new HttpsError('failed-precondition', 'Only price proposal documents can be marked as used');
      }
      if (proposal.isUsed === true) {
        throw new HttpsError('failed-precondition', 'Price proposal is already used');
      }
      if (role !== 'manager' && proposal.createdByUid && proposal.createdByUid !== uid) {
        throw new HttpsError('permission-denied', 'You cannot use this price proposal');
      }
    }
    // Always fetch business info from Firestore (never trust frontend cache for security)
    let businessInfo;
    const businessRegRef = admin.firestore().doc(`companies/${companyId}/data/business_info`);

    // Reserve an invoice number and persist a reservation record up front.
    const reservationResult = await admin.firestore().runTransaction(async (tx) => {
      const idempotencySnap = await tx.get(idempotencyRef);
      if (idempotencySnap.exists) {
        const idempotencyData = idempotencySnap.data() || {};
        if (idempotencyData.status === 'approved' && idempotencyData.result) {
          return { duplicate: true, result: idempotencyData.result };
        }
        if (
          idempotencyData.status === 'in_progress' &&
          Number(idempotencyData.createdAtMillis || 0) > Date.now() - TAX_INVOICE_LOCK_STALE_MS
        ) {
          throw new HttpsError('already-exists', 'Invoice submission with this idempotency key is already in progress');
        }
      }
      const businessRegDoc = await tx.get(businessRegRef);
      if (!businessRegDoc.exists) {
        throw new HttpsError('not-found', 'Business registration not found. Please register your business first.');
      }
      const bizData = businessRegDoc.data();
      
      if (!bizData.vat_number) {
        throw new HttpsError('invalid-argument', 'Missing VAT number in business registration.');
      }
      
      const docNum = (bizData.document_numbers && bizData.document_numbers[305]) || 1;
      const docId = `TI${docNum}-${companyId}`;
      
      // Atomically increment the counter so the next request gets the next number
      tx.update(businessRegRef, {
        'document_numbers.305': admin.firestore.FieldValue.increment(1),
        last_updated: new Date().toISOString(),
      });

      tx.set(
        admin.firestore().doc(`companies/${companyId}/tax_invoice_reservations/${toDocumentDocId(docId)}`),
        {
          documentId: docId,
          documentNumber: docNum,
          uid,
          companyId,
          clientName: String(client.name || '').trim(),
          status: 'reserved',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      tx.set(idempotencyRef, {
        status: 'in_progress',
        uid,
        companyId,
        documentId: docId,
        documentNumber: docNum,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAtMillis: Date.now(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        expireAt: admin.firestore.Timestamp.fromMillis(Date.now() + TAX_INVOICE_IDEMPOTENCY_TTL_MS),
      }, { merge: true });
      
      return { documentNumber: docNum, documentId: docId, businessInfoData: bizData };
    });
    if (reservationResult.duplicate) {
      logger.info('getInvoiceApproval: idempotent duplicate detected', { companyId, uid });
      return reservationResult.result;
    }
    const { documentNumber, documentId, businessInfoData } = reservationResult;
    
    businessInfo = businessInfoData;
    reservationRef = admin.firestore().doc(
      `companies/${companyId}/tax_invoice_reservations/${toDocumentDocId(documentId)}`,
    );
    const todayDate = new Date().toISOString().split('T')[0];
    const invoiceDate = normalizeInvoiceDate(date, todayDate);
    const normalizedClient = normalizeTaxInvoiceClient(client);

    logger.info('Preparing Tax Authority submission', {
      documentId,
      companyId,
      itemCount: normalizedItems.length,
      hasClientName: Boolean(client.name),
      documentNumber,
    });

    // Calculate totals for Tax Authority
    let totalBeforeVat = 0;
    normalizedItems.forEach(item => {
      const itemTotal = (item.quantity || 1) * (item.price || 0);
      totalBeforeVat += itemTotal;
    });
    const vatAmount = totalBeforeVat * VAT_RATE;
    const totalWithVat = totalBeforeVat + vatAmount;

    // Get access token from Firestore
    const tokenRef = admin.firestore().doc(`companies/${companyId}/data/token`);
    const tokenDoc = await tokenRef.get();

    if (!tokenDoc.exists || !tokenDoc.data().accessToken) {
      throw new HttpsError('failed-precondition', 'No access token found. Please authorize with Tax Authority first.');
    }

    let tokenData = tokenDoc.data();
    let accessToken = tokenData.accessToken;
    let accessTokenExpiresAt = tokenData.accessTokenExpiresAt;
    const refreshToken = tokenData.refreshToken;

    // Check if token is expired (with 5-minute buffer) and auto-refresh if needed
    const isTokenExpired = Date.now() + (5 * 60 * 1000) >= accessTokenExpiresAt;
    
    if (isTokenExpired) {
      logger.info('Access token expired, automatically refreshing...', { 
        companyId,
        expiresAt: new Date(accessTokenExpiresAt).toISOString()
      });

      if (!refreshToken) {
        throw new HttpsError('failed-precondition', 'Access token expired and no refresh token available. Please re-authorize with Tax Authority.');
      }

      // Check if refresh token is expired
      if (tokenData.refreshTokenExpiresAt && Date.now() > tokenData.refreshTokenExpiresAt) {
        throw new HttpsError('failed-precondition', 'Refresh token expired. Please re-authorize with Tax Authority.');
      }

      // Two-phase token refresh: read in transaction, HTTP outside, write in second transaction.
      // This avoids holding Firestore transaction locks during slow HTTP calls.

      // Phase 1: Read current token state in a transaction and check if refresh is needed
      const tokenState = await admin.firestore().runTransaction(async (tx) => {
        const freshTokenDoc = await tx.get(tokenRef);
        const freshData = freshTokenDoc.data();
        const freshExpiresAt = freshData?.accessTokenExpiresAt || 0;

        // If another concurrent call already refreshed, use the fresh token
        if (Date.now() + (5 * 60 * 1000) < freshExpiresAt) {
          logger.info('Token already refreshed by concurrent call, using existing token');
          return { accessToken: freshData.accessToken, accessTokenExpiresAt: freshExpiresAt, needsRefresh: false };
        }

        return {
          needsRefresh: true,
          currentRefreshToken: freshData.refreshToken || refreshToken,
          currentExpiresAt: freshExpiresAt,
        };
      });

      if (!tokenState.needsRefresh) {
        accessToken = tokenState.accessToken;
        accessTokenExpiresAt = tokenState.accessTokenExpiresAt;
      } else {
        // Phase 2: Perform HTTP refresh OUTSIDE any transaction
        const tokenRefreshStartTime = Date.now();
        const tokenResponse = await axios.post(
          TAX_AUTHORITY_CONFIG.tokenUrl,
          new URLSearchParams({
            client_id: TAX_AUTHORITY_CONFIG.clientId,
            scope: TAX_AUTHORITY_CONFIG.scope,
            refresh_token: tokenState.currentRefreshToken,
            grant_type: 'refresh_token',
            client_secret: TAX_AUTHORITY_CONFIG.clientSecret,
          }).toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 15000,
          }
        );

        const newTokenData = tokenResponse.data;
        const tokenRefreshTime = Date.now() - tokenRefreshStartTime;
        logger.info('Token refresh successful', { 
          hasAccessToken: !!newTokenData.access_token,
          hasNewRefreshToken: !!newTokenData.refresh_token,
          expiresIn: newTokenData.expires_in,
          refreshTime: tokenRefreshTime
        });

        const now = Date.now();
        const newExpiresAt = now + (newTokenData.expires_in * 1000);

        // Phase 3: Write new token in a second transaction with optimistic concurrency
        const refreshResult = await admin.firestore().runTransaction(async (tx) => {
          // Re-read to check if someone else refreshed while we were doing HTTP
          const recheckDoc = await tx.get(tokenRef);
          const recheckData = recheckDoc.data();
          const recheckExpiresAt = recheckData?.accessTokenExpiresAt || 0;

          // If the token was refreshed by someone else while we did our HTTP call, use theirs
          if (recheckExpiresAt > tokenState.currentExpiresAt && Date.now() + (5 * 60 * 1000) < recheckExpiresAt) {
            logger.info('Token refreshed by concurrent call during our HTTP request, using theirs');
            return { accessToken: recheckData.accessToken, accessTokenExpiresAt: recheckExpiresAt, skipped: true };
          }

          const updateData = {
            accessToken: newTokenData.access_token,
            accessTokenExpiresAt: newExpiresAt,
            lastRefreshedBy: request.auth.uid,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            autoRefreshedDuringInvoiceSubmission: true,
          };

          if (newTokenData.refresh_token) {
            updateData.refreshToken = newTokenData.refresh_token;
            updateData.refreshTokenExpiresAt = newTokenData.refresh_token_expires_in
              ? now + (newTokenData.refresh_token_expires_in * 1000)
              : now + (90 * 24 * 60 * 60 * 1000);
          }

          tx.update(tokenRef, updateData);
          return { accessToken: newTokenData.access_token, accessTokenExpiresAt: newExpiresAt, skipped: false };
        });

        accessToken = refreshResult.accessToken;
        accessTokenExpiresAt = refreshResult.accessTokenExpiresAt;
        if (!refreshResult.skipped) {
          logger.info('Tokens updated in Firestore after auto-refresh', {
            companyId,
            newExpiresAt: new Date(accessTokenExpiresAt).toISOString()
          });

          // Save audit log for auto-refresh
          await saveAuditLog(companyId, 'taxAuthorityTokenAutoRefreshed', request.auth.uid);
        }
      }
    }  // end isTokenExpired

    // Generate timestamp for accounting software fields
    const timestamp = Date.now();
    
    const accountingSoftwareNumber = parseInt(timestamp.toString().substring(0, 9)); // First 9 digits as integer
    const clientSoftwareKey = timestamp.toString().substring(0, 5); // First 5 digits as string
    
    logger.info('Building Tax Authority request', {
      businessVatNumber: businessInfo.vat_number,
      documentId,
      accountingSoftwareNumber,
      clientSoftwareKey,
      invoiceDate
    });
    
    // Build request in EXACT order as API example to avoid validation issues
    const taxAuthorityData = {
      invoice_id: documentId,
      invoice_type: 305, // 305 = Tax invoice (חשבונית מס)
      vat_number: businessInfo.vat_number ,
      //user_id: 15, // REQUIRED: User ID in Tax Authority system (use fixed test value for sandbox)
      user_name: userData.name || userData.email || uid, // Use display name, fallback to email/UID
      invoice_reference_number: documentNumber,
    };

    // CRITICAL: Only add customer_vat_number and customer_name if customer is a business
    // For normal customers, these fields should NOT be included at all (not even as null)
    const clientVatNumber = getClientVatNumber(client);
    if (clientVatNumber) {
      // Customer is a business - include both customer_vat_number and customer_name
      const customerVatNumber = parseInt(clientVatNumber, 10);
      if (!isNaN(customerVatNumber)) {
        taxAuthorityData.customer_vat_number = customerVatNumber;
        taxAuthorityData.customer_name = client.customerName || normalizedClient.name;
      }
      else{
        // Israel Tax Authority generic/walk-in customer VAT number — used when the
        // provided customer VAT number is not a valid integer.  This is the standard
        // "unregistered consumer" placeholder recognised by the Tax Authority.
        taxAuthorityData.customer_vat_number = 777777715;
        taxAuthorityData.customer_name = client.customerName || normalizedClient.name;
      }
    }
    // For normal customers, customer_name and customer_vat_number are NOT included

    // Continue building in exact order
    taxAuthorityData.invoice_date = invoiceDate;
    taxAuthorityData.invoice_issuance_date = invoiceDate;
    taxAuthorityData.accounting_software_number = accountingSoftwareNumber; // REQUIRED: Integer from timestamp
    taxAuthorityData.client_software_key = clientSoftwareKey; // REQUIRED: Numeric string from timestamp
    taxAuthorityData.amount_before_discount = Math.round(totalBeforeVat * 100) / 100;
    taxAuthorityData.discount = 0;
    taxAuthorityData.payment_amount = Math.round(totalBeforeVat * 100) / 100;
    taxAuthorityData.vat_amount = Math.round(vatAmount * 100) / 100;
    taxAuthorityData.payment_amount_including_vat = Math.round(totalWithVat * 100) / 100;

    // Add invoice_note if available (must be before action)
    if (notes && notes.trim()) {
      taxAuthorityData.invoice_note = notes.trim();
    }

    taxAuthorityData.action = 0;
    
    // Build items array in exact field order
    taxAuthorityData.items = normalizedItems.map((item, idx) => {
      const quantity = item.quantity || 1;
      const pricePerUnit = item.price;
      const totalAmount = Math.round(quantity * pricePerUnit * 100) / 100;
      const vatRate = Math.round(VAT_RATE * 100); // e.g. 18 for 18%
      const itemVatAmount = Math.round(totalAmount * VAT_RATE * 100) / 100;
      
      // Category must be 5-digit code: 00001-00014 or 99999 (miscellaneous)
      // Default to 99999 (שונות - miscellaneous) for general items
      const categoryCode = item.category || 1;
      
      return {
        index: idx + 1,
        category: categoryCode, // 5-digit code: 00001-00014 specific categories, 99999 = miscellaneous
        description: item.description,
        measure_unit_description: "יח'", // Units
        quantity: quantity,
        price_per_unit: pricePerUnit,
        discount: 0,
        total_amount: totalAmount,
        vat_rate: vatRate,
        vat_amount: itemVatAmount
      };
    });

    // Validate Tax Authority data
    const requiredFields = [
      'invoice_id', 'invoice_type', 'vat_number', 'invoice_reference_number',
      'invoice_date', 'invoice_issuance_date',
      'amount_before_discount', 'payment_amount', 'vat_amount',
      'payment_amount_including_vat'
    ];

    for (const field of requiredFields) {
      if (taxAuthorityData[field] === undefined || taxAuthorityData[field] === null) {
        throw new HttpsError('invalid-argument', `Missing required field for Tax Authority: ${field}`);
      }
    }

    logger.info('Submitting invoice to Tax Authority', {
      companyId,
      documentId,
      invoiceId: taxAuthorityData.invoice_id,
      itemCount: taxAuthorityData.items.length,
      totalAmount: taxAuthorityData.payment_amount_including_vat
    });

    // Make the API request to Tax Authority (axios-retry handles retries automatically)
    const apiStartTime = Date.now();
    
    let response;
    try {
      response = await axios.post(
        TAX_AUTHORITY_CONFIG.approvalUrl,
        taxAuthorityData, // JSON body - axios automatically stringifies
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'content-type': 'application/json',
            'accept': 'application/json'
          },
          timeout: 30000, // 30 second timeout
          validateStatus: (status) => status < 500, // Don't throw on 4xx errors - handle them below
          // Uses global retry config (exponential backoff, 5xx and network errors only)
        }
      );
    } catch (error) {
      const totalTime = Date.now() - startTime;
      
      logger.error('Tax Authority API request failed after retries', {
        error: error.message,
        code: error.code,
        status: error.response?.status,
        responseKeys: error.response?.data ? Object.keys(error.response.data) : [],
        totalTime
      });
      
      throw new HttpsError(
        'internal',
        `Failed to submit invoice after retries: ${error.message}`,
        {
          status: error.response?.status
        }
      );
    }

    const apiTime = Date.now() - apiStartTime;
    const totalTime = Date.now() - startTime;

    logger.info('Tax Authority API response', {
      status: response.status,
      statusText: response.statusText,
      apiTime,
      totalTime,
      responseKeys: response.data ? Object.keys(response.data) : []
    });

    // Handle 400, 406, and 422 errors with error message from response
    if (response.status === 400 || response.status === 406 || response.status === 422) {
      const errorMessage = response.data?.message || 
                          response.data?.error || 
                          response.data?.error_description ||
                          (response.status === 400 ? 'Invalid request data' : 
                           response.status === 422 ? 'Tax Authority validation failed - please check invoice data' : 
                           'Request not acceptable');
      
      logger.warn('Tax Authority rejected invoice with validation error', {
        status: response.status,
        errorMessage,
        invoiceId: documentId
      });
      await setTaxInvoiceReservationState(reservationRef, 'rejected_validation', {
        finalizedAt: admin.firestore.FieldValue.serverTimestamp(),
        taxAuthorityStatus: response.status,
        taxAuthorityMessage: errorMessage,
      });
      
      throw new HttpsError(
        'failed-precondition',
        `${errorMessage} (Status: ${response.status})${response.data?.errors ? '\nErrors: ' + JSON.stringify(response.data.errors) : ''}`,
        {
          status: response.status,
          invoice_id: documentId
        }
      );
    }

    // Handle other non-2xx responses
    if (response.status < 200 || response.status >= 300) {
      const errorMessage = response.data?.message || 
                          response.data?.error || 
                          'Unexpected response from Tax Authority';
      
      logger.error('Tax Authority returned error status', {
        status: response.status,
        errorMessage,
        responseKeys: response.data ? Object.keys(response.data) : []
      });
      await setTaxInvoiceReservationState(reservationRef, 'submission_failed', {
        taxAuthorityStatus: response.status,
        taxAuthorityMessage: errorMessage,
      });
      
      throw new HttpsError(
        'internal',
        `Tax Authority error (${response.status}): ${errorMessage}`,
        {
          status: response.status,
          responseData: response.data
        }
      );
    }

    // Check if approved - handle various response formats
    const isApproved = response.data?.approved === true || 
                       response.data?.status === 'approved' ||
                       response.data?.approval_status === 'approved';
    const confirmationNumber = response.data?.confirmation_number || 
                              response.data?.confirmationNumber ||
                              response.data?.approval_number;

    // CRITICAL: Only save to Firestore if Tax Authority APPROVED
    if (!isApproved) {
      logger.warn('Tax Authority rejected invoice - NOT saving to Firestore', {
        documentId,
        documentNumber,
        hasClientName: Boolean(client.name),
        status: response.status,
        responseDataKeys: response.data ? Object.keys(response.data) : [],
        checkedFields: {
          approved: response.data?.approved,
          status: response.data?.status,
          approval_status: response.data?.approval_status
        }
      });

      const rejectionMessage = response.data?.message || 
                              response.data?.error || 
                              response.data?.error_description ||
                              'Tax Authority did not approve the invoice. Please check invoice details and try again.';
      await setTaxInvoiceReservationState(reservationRef, 'rejected', {
        finalizedAt: admin.firestore.FieldValue.serverTimestamp(),
        taxAuthorityStatus: response.status,
        taxAuthorityMessage: rejectionMessage,
      });

      throw new HttpsError(
        'failed-precondition',
        rejectionMessage,
        {
          approved: false,
          status: response.status,
        responseData: sanitizeExternalErrorData(response.data),
          documentNumber: documentNumber,
          clientName: client.name
        }
      );
    }

    // Tax Authority APPROVED - Now save document to Firestore with confirmation number
    logger.info('Tax Authority approved! Saving document to Firestore', {
      documentId,
      confirmationNumber,
      documentNumber
    });

    const documentRef = admin.firestore().doc(`companies/${companyId}/documents/${toDocumentDocId(documentId)}`);
    const submittedAt = new Date().toISOString();
    const documentData = buildStoredTaxInvoiceDocument({
      uid,
      documentId,
      documentNumber,
      client,
      items: normalizedItems,
      language,
      date: invoiceDate,
      notes,
      jobsData: linkedJobIds.map((jobId) => ({ jobId })),
      priceProposalId: normalizedPriceProposalId || null,
      totalBeforeVat,
      vatAmount,
      totalWithVat,
      confirmationNumber,
      responseData: response.data,
      submittedAt,
    });
    try {
      const batch = admin.firestore().batch();
      batch.create(documentRef, documentData);

      // CRITICAL: Update job documents to mark them as having a tax invoice (isCert = true)
      const allJobRefs = linkedJobIds;

      const cacheUpdates = {
        documentsVersion: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      for (const jobId of allJobRefs) {
        const cleanJobId = toBaseDocumentId(jobId);
        const jobRef = admin.firestore().doc(`companies/${companyId}/jobs/${cleanJobId}`);
        batch.update(jobRef, {
          isCert: true,
          documentId,
          documentCreatedAt: submittedAt,
        });
        cacheUpdates.jobsVersion = admin.firestore.FieldValue.increment(1);
      }

      if (normalizedPriceProposalId) {
        const proposalRef = admin.firestore().doc(`companies/${companyId}/documents/${normalizedPriceProposalId}`);
        batch.update(proposalRef, {
          isUsed: true,
          usedByDocumentId: documentId,
          usedAt: submittedAt,
        });
      }

      const cacheRef = admin.firestore().doc(`companies/${companyId}/data/cache`);
      batch.set(cacheRef, cacheUpdates, { merge: true });
      batch.set(reservationRef, {
        status: 'approved',
        finalizedAt: admin.firestore.FieldValue.serverTimestamp(),
        confirmationNumber: confirmationNumber || null,
        taxAuthorityStatus: response.status,
      }, { merge: true });
      batch.set(idempotencyRef, {
        status: 'approved',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      await batch.commit();
      logger.info('Approved tax invoice finalized atomically', {
        documentId,
        path: `companies/${companyId}/documents/${toDocumentDocId(documentId)}`,
        confirmationNumber,
        jobCount: allJobRefs.length,
        priceProposalMarked: !!normalizedPriceProposalId,
      });

    } catch (firestoreError) {
      await setTaxInvoiceReservationState(reservationRef, 'approval_received_needs_reconcile', {
        finalizedAt: admin.firestore.FieldValue.serverTimestamp(),
        confirmationNumber: confirmationNumber || null,
        taxAuthorityStatus: response.status,
        finalizationError: firestoreError.message,
      });
      logger.error('Failed to save approved document to Firestore', {
        error: firestoreError.message,
        documentId,
        confirmationNumber
      });
      throw new HttpsError('internal', 'Invoice approved but failed to save');
    }

    // Document counter was already atomically incremented in the transaction above.
    // Company cache was already bumped in the batch above — no additional increment needed.
    logger.info('Tax invoice counter already incremented transactionally', {
      documentNumber,
    });

    // Save audit log for Tax Authority submission
    await saveAuditLog(
      companyId,
      'submitInvoiceToTaxAuthority',
      request.auth.uid,
      documentId,
      DOC_TYPE.TAX_INVOICE
    );

    // ============================================================================
    // STEP 2: Publish PDF generation task to Pub/Sub (instead of generating inline)
    // This allows Cloud Run workers to handle PDF generation asynchronously
    // Uses shared helper function for consistency with publishGenerateTask
    // ============================================================================
    logger.info('Publishing PDF generation task to Pub/Sub for approved tax invoice', { documentId });
    
    let pdfTaskPublished = false;
    let taskId = null;
    
    try {
      // Build company data from business info for the PDF generation task
      const companyData = {
        name: businessInfo.he_name || businessInfo.en_name || businessInfo.business_name || companyId,
        nameHe: businessInfo.he_name || '',
        nameEn: businessInfo.en_name || '',
        email: businessInfo.business_email || businessInfo.email || '',
        phone: businessInfo.business_phone || businessInfo.phone || '',
        fax: businessInfo.business_fax || '',
        address: businessInfo.address || '',
        city: businessInfo.city || '',
        vatNumber: businessInfo.vat_number || '',
        businessType: businessInfo.business_type || '',
      };

      // Build client data for PDF
      const clientDataForPDF = {
        ...normalizedClient,
        name: normalizedClient.name,
        email: normalizedClient.email || '',
        phone: normalizedClient.phone || '',
        address: normalizedClient.address || '',
        city: normalizedClient.city || '',
        id: normalizedClient.id || '',
        clientId: normalizedClient.clientId || '',
      };

      // Prepare complete document data
      const completeDocumentData = {
        type: DOC_TYPE.TAX_INVOICE, // Store numeric type (305)
        client: clientDataForPDF,
        items: normalizedItems,
        company: companyData,
        language: language || 'he',
        documentNumber: documentNumber,
        date: invoiceDate,
        notes: notes,
        jobsData: linkedJobIds.map((jobId) => ({ jobId })),
        priceProposalId: normalizedPriceProposalId || null,
        taxAuthorityConfirmationNumber: confirmationNumber,
        totals: {
          totalBeforeVat: Math.round(totalBeforeVat * 100) / 100,
          vatAmount: Math.round(vatAmount * 100) / 100,
          totalWithVat: Math.round(totalWithVat * 100) / 100,
        },
      };

      // Use shared helper to publish task
      const result = await publishGenerateTaskHelper({
        documentType: DOC_TYPE.TAX_INVOICE,
        documentId: documentId,
        documentNumber: documentNumber,
        completeDocumentData: completeDocumentData,
        uid: uid,
        companyId: companyId,
        createdByUid: request.auth.uid,
        userRole: role,
      });

      pdfTaskPublished = true;
      taskId = result.taskId;
      
      logger.info('PDF generation task published to Pub/Sub via helper', { 
        taskId, 
        messageId: result.messageId, 
        documentId,
        companyId 
      });

    } catch (pubsubError) {
      logger.error('Failed to publish PDF generation task to Pub/Sub', {
        error: pubsubError.message,
        documentId,
        confirmationNumber
      });
      
      // PDF task publishing failed, but document is saved and approved
      // This is non-critical - PDF can be regenerated later
      pdfTaskPublished = false;
    }

    const finalTotalTime = Date.now() - startTime;

    const finalResult = {
      success: true,
      documentId: documentId,
      documentNumber,
      savedPath: `companies/${companyId}/documents/${toDocumentDocId(documentId)}`,
      status: response.status,
      message: response.data?.message || 'Invoice approved and saved successfully',
      confirmationNumber,
      approved: true,
      responseData: response.data,
      // PDF generation is now async via Pub/Sub
      pdfGenerated: false, // PDF not generated yet - will be done async
      pdfTaskPublished: pdfTaskPublished,
      pdfTaskId: taskId,
      downloadURL: null, // Will be populated when PDF generation completes
      metadata: {
        submittedAt: new Date().toISOString(),
        apiTime,
        totalTime: finalTotalTime,
        documentNumber,
        clientName: client.name,
        totalWithVat: Math.round(totalWithVat * 100) / 100
      }
    };
    await idempotencyRef.set({
      status: 'approved',
      result: finalResult,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      finalizedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return finalResult;

  } catch (error) {
    const totalTime = Date.now() - startTime;
    
    async function markIdempotencyFailed(message, status = 'failed') {
      if (!idempotencyRef) return;
      try {
        await idempotencyRef.set({
          status,
          errorMessage: String(message || '').slice(0, 500),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      } catch (idempotencyError) {
        logger.error('Failed to update tax invoice idempotency state', {
          idempotencyError: idempotencyError.message,
          duration: totalTime,
        });
      }
    }

    // Handle axios errors
    if (error.response) {
      // API returned an error response
      logger.error('Tax Authority API error response', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: sanitizeExternalErrorData(error.response.data),
        duration: totalTime
      });
      await markIdempotencyFailed(error.response.data?.message || error.response.statusText, 'submission_failed');
      if (reservationRef) {
        try {
          await setTaxInvoiceReservationState(reservationRef, 'submission_failed', {
            taxAuthorityStatus: error.response.status,
            taxAuthorityMessage: error.response.data?.message || error.response.statusText,
          });
        } catch (reservationError) {
          logger.error('Failed to update reservation after API error response', {
            reservationError: reservationError.message,
            duration: totalTime,
          });
        }
      }
      
      throw new HttpsError(
        'failed-precondition',
        `Tax Authority API error: ${error.response.data?.message || error.response.statusText}`,
        {
          status: error.response.status,
          apiError: sanitizeExternalErrorData(error.response.data)
        }
      );
    } else if (error.request) {
      // Request made but no response
      logger.error('Tax Authority API no response', {
        error: error.message,
        duration: totalTime
      });
      await markIdempotencyFailed(error.message, 'submission_failed');
      if (reservationRef) {
        try {
          await setTaxInvoiceReservationState(reservationRef, 'submission_failed', {
            taxAuthorityMessage: error.message,
          });
        } catch (reservationError) {
          logger.error('Failed to update reservation after no-response error', {
            reservationError: reservationError.message,
            duration: totalTime,
          });
        }
      }
      
      throw new HttpsError(
        'unavailable',
        'Tax Authority API did not respond. Please try again later.'
      );
    } else if (error instanceof HttpsError) {
      await markIdempotencyFailed(error.message, 'failed');
      throw error;
    } else {
      // Other errors
      logger.error('Error in getInvoiceApproval', {
        error: error.message,
        stack: error.stack,
        duration: totalTime
      });
      await markIdempotencyFailed(error.message, 'failed');
      if (reservationRef) {
        try {
          await setTaxInvoiceReservationState(reservationRef, 'submission_failed', {
            taxAuthorityMessage: error.message,
          });
        } catch (reservationError) {
          logger.error('Failed to update reservation after internal error', {
            reservationError: reservationError.message,
            duration: totalTime,
          });
        }
      }
      
      throw new HttpsError('internal', 'Failed to submit invoice');
    }
  }
});

module.exports = {
  startTaxAuthorityAuth: exports.startTaxAuthorityAuth,
  taxAuthorityCallback: exports.taxAuthorityCallback,
  getInvoiceApproval: exports.getInvoiceApproval,
};
