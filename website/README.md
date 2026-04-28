# Smart-Job ERP Website

`website/` is the Next.js app for marketing pages, auth entrypoints, onboarding, and protected ERP web workflows.

## Runtime Role

- Uses Supabase Auth for sign-in flows.
- Exchanges bearer tokens for HttpOnly `__session` cookies.
- Protects `/app/*` through middleware.
- Revalidates session users server-side before accepting a session cookie.
- Proxies protected operations to backend gateways instead of writing directly to protected data stores.
- Uses short-lived browser auth transport state and avoids persisting refresh tokens in `localStorage`.
- Polls SQL-backed `document_tasks` through `/api/read-model` for preview/generate progress.

## Key Responsibilities

- Public pages and product content
- `/login`, `/register`, `/forgot-password`, `/onboarding`
- Protected app routes under `/app/*`
- API proxy routes (`/api/callable`, `/api/read-model`, `/api/contact/request`)
- Tax invoice creation delegates to backend draft-document reservation and async PDF scheduling.

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
