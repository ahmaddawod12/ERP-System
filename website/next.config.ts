import type { NextConfig } from "next";
import { dirname } from "path";
import { fileURLToPath } from "url";

const rootDir = dirname(fileURLToPath(import.meta.url));
const monorepoRoot = dirname(rootDir);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ["@smart-job/contracts", "@smart-job/api-contracts"],
  turbopack: {
    root: monorepoRoot,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // 'unsafe-inline' is currently required for Next.js hydration scripts.
              // 'unsafe-eval' is only enabled in development for hot reload.
              // Keep CSP restrictions synchronized with middleware and app runtime capabilities.
              process.env.NODE_ENV === 'development'
                ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://www.google.com https://www.gstatic.com https://www.recaptcha.net"
                : "script-src 'self' 'unsafe-inline' https://apis.google.com https://www.google.com https://www.gstatic.com https://www.recaptcha.net",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://*.googleapis.com https://*.googleusercontent.com https://www.gstatic.com https://www.google.com https://www.recaptcha.net",
              "font-src 'self'",
              "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.supabase.co https://www.google.com https://www.gstatic.com https://www.recaptcha.net wss://*.firebaseio.com",
              "frame-src 'self' https://*.firebaseapp.com https://www.google.com https://www.recaptcha.net",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
