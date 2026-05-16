# Smart-Job ERP Website

`website/` is the Next.js app for marketing pages, auth entrypoints, onboarding, and protected ERP web workflows.

## Runtime Role

- Uses Supabase Auth for sign-in flows.
- Exchanges bearer tokens for HttpOnly session cookies.
- Protects `/app/*` through middleware.
- Revalidates session users server-side before accepting a session cookie.
- Proxies protected operations to backend gateways instead of writing directly to protected data stores.
- Uses short-lived browser auth transport state and avoids persisting refresh tokens in `localStorage`.
- The website uses split HttpOnly cookies: signed metadata in `__session`, current bearer token in `__session_access` for `/api/callable` and `/api/read-model` proxy auth before client auth rehydrates.
- Protected session validation requires both `__session` and `__session_access`; signed metadata without the bearer cookie is treated as unauthenticated.
- Polls SQL-backed `document_tasks` through `/api/read-model` for preview/generate progress.
- Reads clients and inventory through `/api/read-model`; backend SQL RPCs perform pagination/search while website callers keep the existing response shapes.

## Key Responsibilities

- Public pages and product content
- `/login`, `/register`, `/forgot-password`, `/onboarding`
- Protected app routes under `/app/*`
- API proxy routes (`/api/callable`, `/api/read-model`, `/api/contact/request`)
- Client list workflows drain paginated read-model pages through `src/lib/services/backend-service.ts`.
- Tax invoice creation delegates to backend draft-document reservation and async PDF scheduling.
- Website document and job-file access rely on backend-issued short-lived URLs; protected storage paths are not read directly by the browser.
- Registration signs the user in immediately before redirecting into onboarding so the cookie-backed session survives the handoff.
- Contact request spam/challenge validation failures return stable `400` API errors (`spam_rejected`, `invalid_challenge`) instead of ambiguous server failures.

## Required Patterns

- Keep API routes thin: parse, validate, auth-check, proxy.
- Keep page wrapper pattern: `page.tsx` server wrapper, `page-client.tsx` interactive shell.
- Keep protected writes backend-only.
- Keep React Hook Form + Zod for form handling.

## Environment Variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SESSION_COOKIE_SECRET`
- `WEBSITE_SESSION_SECRET`
- `BACKEND_EDGE_FUNCTIONS_BASE_URL` (optional)
- `CLOUDRUN_PDF_URL`

If `BACKEND_EDGE_FUNCTIONS_BASE_URL` is unset, functions base URL falls back to `${SUPABASE_URL || NEXT_PUBLIC_SUPABASE_URL}/functions/v1`.

## Commands

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm run test
npm run build
```

## References

- `../SETUP.md`
- `../backend.md`
- `../architecture.md`
