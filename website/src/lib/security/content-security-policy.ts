const SENSITIVE_ROUTE_PREFIXES = [
  "/app",
  "/auth",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/onboarding",
  "/contact",
  "/api/auth",
  "/api/contact",
] as const;

function matchesRoutePrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isSensitiveCspPath(pathname: string): boolean {
  return SENSITIVE_ROUTE_PREFIXES.some((prefix) =>
    matchesRoutePrefix(pathname, prefix),
  );
}

export function buildSensitiveContentSecurityPolicy(
  nonce: string,
  development: boolean,
): string {
  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(development ? ["'unsafe-eval'"] : []),
    "https://apis.google.com",
    "https://www.google.com",
    "https://www.gstatic.com",
    "https://www.recaptcha.net",
  ];

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.googleusercontent.com https://www.gstatic.com https://www.google.com https://www.recaptcha.net",
    "font-src 'self'",
    "connect-src 'self' https://www.google.com https://www.gstatic.com https://www.recaptcha.net",
    "frame-src 'self' https://www.google.com https://www.recaptcha.net",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}
