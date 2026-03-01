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
  toDocumentDocId,
  toBaseDocumentId,
  saveAuditLog,
  clearCompanyBusyFlag,
  acquireCompanyBusyFlag,
  publishGenerateTaskHelper,
} = require('./shared');

// =============================================================================
// ISRAELI TAX AUTHORITY OAuth2 TOKEN MANAGEMENT
// =============================================================================

// OAuth2 Configuration for Israeli Tax Authority
const TAX_AUTHORITY_CONFIG = {
  authUrl: process.env.TAX_AUTH_URL || 'https://openapi.taxes.gov.il/shaam/tsandbox/longtimetoken/oauth2/authorize',
  tokenUrl: process.env.TAX_TOKEN_URL || 'https://openapi.taxes.gov.il/shaam/tsandbox/longtimetoken/oauth2/token',
  approvalUrl: process.env.TAX_APPROVAL_URL || 'https://openapi.taxes.gov.il/shaam/tsandbox/Invoices/v2/Approval',
  clientId: process.env.TAX_CLIENT_ID || '',
  clientSecret: process.env.TAX_CLIENT_SECRET || '',
  scope: process.env.TAX_SCOPE || 'scope',
  callbackUrl: process.env.TAX_CALLBACK_URL || '',
  appScheme: process.env.APP_SCHEME || 'erpsystem',
};

function encodeBase64Url(input) {
  return Buffer.from(String(input), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(input) {
  const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLength);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function escapeHtml(input) {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildAuthCallbackDeepLink(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      query.set(key, String(value));
    }
  });
  return `${TAX_AUTHORITY_CONFIG.appScheme}://auth-callback?${query.toString()}`;
}

function generateSuccessHTML(deepLink, tokenExchangeSuccess, tokenExchangeError) {
  const safeDeepLink = escapeHtml(deepLink);
  const safeError = escapeHtml(tokenExchangeError || '');
  const statusText = tokenExchangeSuccess ? 'Authorization completed' : 'Authorization completed with warnings';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Authorization Complete</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
      .wrap { max-width: 640px; margin: 0 auto; }
      .ok { color: #166534; font-weight: 700; }
      .warn { color: #b45309; font-weight: 700; }
      a { color: #1d4ed8; }
      code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h2>${tokenExchangeSuccess ? '<span class="ok">Success</span>' : '<span class="warn">Completed</span>'}</h2>
      <p>${escapeHtml(statusText)}</p>
      ${safeError ? `<p><strong>Details:</strong> ${safeError}</p>` : ''}
      <p><a href="${safeDeepLink}">Return to app</a></p>
      <p>If the app does not open automatically, use this link:</p>
      <p><code>${safeDeepLink}</code></p>
      <script>
        setTimeout(function () { window.location.href = ${JSON.stringify(deepLink)}; }, 300);
      </script>
    </div>
  </body>
</html>`;
}

function ensureTaxAuthorityConfigForCallable() {
  if (!TAX_AUTHORITY_CONFIG.clientId || !TAX_AUTHORITY_CONFIG.clientSecret || !TAX_AUTHORITY_CONFIG.callbackUrl) {
    throw new HttpsError(
      'failed-precondition',
      'Tax Authority OAuth is not configured on the server.'
    );
  }
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

    // Verify user is a manager
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
    
    throw new HttpsError('internal', `Failed to start authorization: ${error.message}`);
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
    if (!TAX_AUTHORITY_CONFIG.clientId || !TAX_AUTHORITY_CONFIG.clientSecret || !TAX_AUTHORITY_CONFIG.callbackUrl) {
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
    const pendingAuthSnap = await pendingAuthRef.get();
    if (!pendingAuthSnap.exists) {
      const deepLink = buildAuthCallbackDeepLink({
        success: false,
        error: 'Authorization session not found or expired'
      });
      return res.send(generateSuccessHTML(deepLink, false, 'Authorization session not found or expired'));
    }

    const pendingAuthData = pendingAuthSnap.data() || {};
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

    const callbackRecordRef = admin.firestore().doc(`taxAuthCallbacks/${authId}`);
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

    const receivedAtMillis = Date.now();
    await callbackRecordRef.set({
      authId,
      companyId: pendingAuthData.companyId || null,
      uid: pendingAuthData.uid || null,
      state,
      code: code,
      receivedAt: admin.firestore.FieldValue.serverTimestamp(),
      receivedAtMillis,
      used: false,
      codeLength: code.length,
    }, { merge: true });

    // IMMEDIATELY exchange the code for tokens while it's fresh
    let tokenExchangeSuccess = false;
    let tokenExchangeError = null;
    const companyId = pendingAuthData.companyId || null;

    try {
      await pendingAuthRef.update({
        status: 'used',
        usedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

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
      type, client, items, company, companyId,
      language, date, notes, jobsData, priceProposalId
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
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new HttpsError('invalid-argument', 'At least one item is required');
    }
    if (items.length > MAX_ITEMS_PER_DOCUMENT) {
      throw new HttpsError('invalid-argument', `Too many items (max ${MAX_ITEMS_PER_DOCUMENT})`);
    }
    if (!company || !company.name) {
      throw new HttpsError('invalid-argument', 'Company ID is required');
    }

    // Always fetch business info from Firestore (never trust frontend cache for security)
    let businessInfo;
    const businessRegRef = admin.firestore().doc(`companies/${companyId}/data/business_info`);

    // CRITICAL FIX: Use transaction to atomically read + increment document number
    // This prevents two concurrent requests from getting the same invoice number
    const { documentNumber, documentId, businessInfoData } = await admin.firestore().runTransaction(async (tx) => {
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
      
      return { documentNumber: docNum, documentId: docId, businessInfoData: bizData };
    });
    
    businessInfo = businessInfoData;
    const todayDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

    logger.info('Preparing Tax Authority submission', {
      documentId,
      companyId,
      itemCount: items.length,
      clientName: client.name,
      documentNumber,
    });

    // Calculate totals for Tax Authority
    let totalBeforeVat = 0;
    items.forEach(item => {
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

    const tokenData = tokenDoc.data();
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

      try {
        // Refresh access token using axios (axios-retry handles retries automatically)
        logger.info('Sending token refresh request...');
        const tokenRefreshStartTime = Date.now();
        
        const tokenResponse = await axios.post(
          TAX_AUTHORITY_CONFIG.tokenUrl,
          new URLSearchParams({
            client_id: TAX_AUTHORITY_CONFIG.clientId,
            scope: TAX_AUTHORITY_CONFIG.scope,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
            client_secret: TAX_AUTHORITY_CONFIG.clientSecret,
          }).toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
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

        // Calculate new expiration timestamp
        const now = Date.now();
        accessTokenExpiresAt = now + (newTokenData.expires_in * 1000);
        accessToken = newTokenData.access_token;

        // Update tokens in Firestore using a transaction to prevent race conditions
        // when two concurrent calls both detect token expiration simultaneously
        const updateData = {
          accessToken: newTokenData.access_token,
          accessTokenExpiresAt: accessTokenExpiresAt,
          lastRefreshedBy: request.auth.uid,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          autoRefreshedDuringInvoiceSubmission: true,
        };

        // If a new refresh token is provided, update it with actual expiration time
        if (newTokenData.refresh_token) {
          updateData.refreshToken = newTokenData.refresh_token;
          updateData.refreshTokenExpiresAt = newTokenData.refresh_token_expires_in
            ? now + (newTokenData.refresh_token_expires_in * 1000)
            : now + (90 * 24 * 60 * 60 * 1000); // Fallback to 90 days
        }

        await tokenRef.update(updateData);

        logger.info('Tokens updated in Firestore after auto-refresh', { 
          companyId,
          newExpiresAt: new Date(accessTokenExpiresAt).toISOString()
        });

        // Save audit log for auto-refresh
        await saveAuditLog(companyId, 'taxAuthorityTokenAutoRefreshed', request.auth.uid);

      } catch (refreshError) {
        logger.error('Failed to auto-refresh access token', {
          error: refreshError.message,
          status: refreshError.response?.status,
          responseData: refreshError.response?.data
        });

        // Handle refresh token errors
        if (refreshError.response) {
          const status = refreshError.response.status;
          const errorData = refreshError.response.data;
          
          // If refresh token is invalid, clear the stored tokens
          if (status === 400 || status === 401) {
            logger.warn('Refresh token invalid, clearing stored tokens', { companyId });
            await tokenRef.update({
              accessToken: admin.firestore.FieldValue.delete(),
              refreshToken: admin.firestore.FieldValue.delete(),
              accessTokenExpiresAt: admin.firestore.FieldValue.delete(),
              refreshTokenExpiresAt: admin.firestore.FieldValue.delete(),
              tokenInvalidatedAt: admin.firestore.FieldValue.serverTimestamp(),
              tokenInvalidatedReason: 'refresh_failed_during_auto_refresh',
            });
            
            throw new HttpsError(
              'failed-precondition',
              'Refresh token is invalid or expired. Please re-authorize with Tax Authority.',
              { originalError: errorData?.error_description || errorData?.error }
            );
          }
          
          throw new HttpsError(
            'internal',
            `Failed to auto-refresh token: ${errorData?.error_description || errorData?.error || 'Unknown error'}`,
            { status, errorData }
          );
        }
        
        throw new HttpsError(
          'internal',
          `Failed to auto-refresh access token: ${refreshError.message}`
        );
      }
    } else {
      logger.info('Access token is valid, proceeding with invoice submission', {
        companyId,
        expiresAt: new Date(accessTokenExpiresAt).toISOString(),
        timeUntilExpiry: Math.round((accessTokenExpiresAt - Date.now()) / 1000 / 60) + ' minutes'
      });
    }

    // Generate timestamp for accounting software fields
    const timestamp = Date.now();
    
    const accountingSoftwareNumber = parseInt(timestamp.toString().substring(0, 9)); // First 9 digits as integer
    const clientSoftwareKey = timestamp.toString().substring(0, 5); // First 5 digits as string
    
    logger.info('Building Tax Authority request', {
      businessVatNumber: businessInfo.vat_number,
      documentId,
      accountingSoftwareNumber,
      clientSoftwareKey,
      todayDate
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
    if (client.clientVatNumber) {
      // Customer is a business - include both customer_vat_number and customer_name
      const customerVatNumber = parseInt(client.clientVatNumber);
      if (!isNaN(customerVatNumber)) {
        taxAuthorityData.customer_vat_number = customerVatNumber;
        taxAuthorityData.customer_name = client.customerName || client.name;
      }
      else{
        // Israel Tax Authority generic/walk-in customer VAT number — used when the
        // provided customer VAT number is not a valid integer.  This is the standard
        // "unregistered consumer" placeholder recognised by the Tax Authority.
        taxAuthorityData.customer_vat_number = 777777715;
        taxAuthorityData.customer_name = client.customerName || client.name;
      }
    }
    // For normal customers, customer_name and customer_vat_number are NOT included

    // Continue building in exact order
    taxAuthorityData.invoice_date = todayDate;
    taxAuthorityData.invoice_issuance_date = todayDate;
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
    taxAuthorityData.items = items.map((item, idx) => {
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
        clientName: client.name,
        status: response.status,
        responseData: response.data,
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

      throw new HttpsError(
        'failed-precondition',
        rejectionMessage,
        {
          approved: false,
          status: response.status,
          responseData: response.data,
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
    const documentData = {
      type: DOC_TYPE.TAX_INVOICE, // Store numeric type (305)
      documentNumber: documentNumber, // Use the date-number-type format
      clientName: client.name,
      clientEmail: client.email || null,
      clientPhone: client.phone || null,
      clientAddress: client.address || null,
      clientId: client.id || null,
      clientVatNumber: client.clientVatNumber || null, // Store customer VAT if business customer
      date: date || todayDate,
      items: items,
      language: language || 'he',
      notes: notes || null,
      createdBy: uid,
      createdAt: new Date().toISOString(),
      jobsData: jobsData || null, // Multi-job references
      priceProposalId: priceProposalId || null, // Price proposal used
      itemCount: items.length,
      totalBeforeVat: Math.round(totalBeforeVat * 100) / 100,
      vatAmount: Math.round(vatAmount * 100) / 100,
      totalWithVat: Math.round(totalWithVat * 100) / 100,
      // Tax Authority approval data
      taxAuthoritySubmittedAt: new Date().toISOString(),
      taxAuthorityResponseData: response.data,
    };
    try {
      await documentRef.set(documentData);
      logger.info('Document saved to Firestore with approval', {
        documentId,
        path: `companies/${companyId}/documents/${toDocumentDocId(documentId)}`,
        confirmationNumber
      });

      // CRITICAL: Update job documents to mark them as having a tax invoice (isCert = true)
      const allJobRefs = Array.isArray(jobsData)
        ? jobsData
            .map((jobRef) => jobRef?.jobId)
            .filter(Boolean)
        : [];
      
      if (allJobRefs.length > 0) {
        // Use batched write to update all jobs + price proposal + cache in one go
        const batch = admin.firestore().batch();
        const cacheUpdates = {};
        for (const jobId of allJobRefs) {
          const cleanJobId = toBaseDocumentId(jobId);
          const jobPath = `companies/${companyId}/jobs/${cleanJobId}`;
          try {
            const jobRef = admin.firestore().doc(jobPath);
            batch.update(jobRef, {
              isCert: true,
              documentId: documentId,
              documentCreatedAt: new Date().toISOString()
            });
            logger.info('Queued job update isCert=true', { jobId: cleanJobId, documentId });
            cacheUpdates.jobsVersion = admin.firestore.FieldValue.increment(1);
          } catch (jobUpdateError) {
            logger.error('Failed to queue job update', {
              error: jobUpdateError.message,
              jobId: cleanJobId
            });
          }
        }
        
        // Mark price proposal as used if provided
        if (priceProposalId) {
          try {
            const proposalRef = admin.firestore().doc(`companies/${companyId}/documents/${toDocumentDocId(priceProposalId)}`);
            batch.update(proposalRef, {
              isUsed: true,
              usedByDocumentId: documentId,
              usedAt: new Date().toISOString()
            });
            logger.info('Queued price proposal update isUsed=true', { priceProposalId, documentId });
          } catch (proposalError) {
            logger.error('Failed to queue price proposal update', {
              error: proposalError.message,
              priceProposalId
            });
          }
        }
        
        // Always update company cache with version bumps
        const cachePath = `companies/${companyId}/data/cache`;
        const cacheRef = admin.firestore().doc(cachePath);
        cacheUpdates.documentsVersion = admin.firestore.FieldValue.increment(1);
        cacheUpdates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        batch.update(cacheRef, cacheUpdates);
        logger.info('Queued cache update', { cachePath, cacheUpdates });
        
        // Commit all updates in one batch
        try {
          await batch.commit();
          logger.info('Batch committed: jobs isCert, proposal isUsed, cache increments', {
            jobCount: allJobRefs.length,
            priceProposalMarked: !!priceProposalId,
            documentId
          });
        } catch (batchError) {
          logger.error('Batch commit failed', {
            error: batchError.message,
            jobIds: allJobRefs,
            priceProposalId
          });
        }
      }

    } catch (firestoreError) {
      logger.error('Failed to save approved document to Firestore', {
        error: firestoreError.message,
        documentId,
        confirmationNumber
      });
      throw new HttpsError('internal', `Invoice approved but failed to save: ${firestoreError.message}`);
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
        name: client.name,
        email: client.email || '',
        phone: client.phone || '',
        address: client.address || '',
        id: client.id || ''
      };

      // Prepare complete document data
      const completeDocumentData = {
        type: DOC_TYPE.TAX_INVOICE, // Store numeric type (305)
        client: clientDataForPDF,
        items: items,
        company: companyData,
        language: language || 'he',
        documentNumber: documentNumber,
        date: date || todayDate,
        notes: notes,
        jobsData: jobsData || null, // Multi-job references
        priceProposalId: priceProposalId || null,
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

    return {
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

  } catch (error) {
    const totalTime = Date.now() - startTime;
    
    // Handle axios errors
    if (error.response) {
      // API returned an error response
      logger.error('Tax Authority API error response', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
        duration: totalTime
      });
      
      throw new HttpsError(
        'failed-precondition',
        `Tax Authority API error: ${error.response.data?.message || error.response.statusText}`,
        {
          status: error.response.status,
          apiError: error.response.data
        }
      );
    } else if (error.request) {
      // Request made but no response
      logger.error('Tax Authority API no response', {
        error: error.message,
        duration: totalTime
      });
      
      throw new HttpsError(
        'unavailable',
        'Tax Authority API did not respond. Please try again later.'
      );
    } else if (error instanceof HttpsError) {
      // Re-throw HttpsError
      throw error;
    } else {
      // Other errors
      logger.error('Error in getInvoiceApproval', {
        error: error.message,
        stack: error.stack,
        duration: totalTime
      });
      
      throw new HttpsError('internal', `Failed to submit invoice: ${error.message}`);
    }
  }
});

module.exports = {
  startTaxAuthorityAuth: exports.startTaxAuthorityAuth,
  taxAuthorityCallback: exports.taxAuthorityCallback,
  getInvoiceApproval: exports.getInvoiceApproval,
};
