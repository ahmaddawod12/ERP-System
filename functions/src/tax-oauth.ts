import { HttpsError } from 'firebase-functions/v2/https';

const TAX_AUTHORITY_CONFIG = {
  authUrl: process.env.TAX_AUTH_URL || '',
  tokenUrl: process.env.TAX_TOKEN_URL || '',
  approvalUrl: process.env.TAX_APPROVAL_URL || '',
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

function buildAuthCallbackDeepLink(params: any = {}) {
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
  if (
    !TAX_AUTHORITY_CONFIG.authUrl ||
    !TAX_AUTHORITY_CONFIG.tokenUrl ||
    !TAX_AUTHORITY_CONFIG.approvalUrl ||
    !TAX_AUTHORITY_CONFIG.clientId ||
    !TAX_AUTHORITY_CONFIG.clientSecret ||
    !TAX_AUTHORITY_CONFIG.callbackUrl
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Tax Authority OAuth is not fully configured on the server.'
    );
  }
}

export { TAX_AUTHORITY_CONFIG, encodeBase64Url, decodeBase64Url, buildAuthCallbackDeepLink, generateSuccessHTML, ensureTaxAuthorityConfigForCallable };
