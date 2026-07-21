# Smart-Job ERP Website

`website/` is the Next.js app for marketing pages, auth entrypoints, onboarding, and protected ERP web workflows.

The current transition build uses React/React DOM 19.2.7. The server-only
Cloud Run transport and opaque-session BFF entrypoints are now available for
new server-rendered slices. Existing ERP client pages still use the temporary
Edge-backed session path until their data calls are converted; do not activate
the opaque-session proxy/login client cutover before those slices can operate
without a browser bearer token.

## Opaque website session foundation

- `src/lib/backend/transport.ts` lazily reads server-only runtime configuration,
  disables caching, enforces the 12-second ceiling, and validates every API
  envelope through `@smart-job/api-contracts`.
- `POST /api/auth/login` delegates credentials to
  `POST /api/v1/auth/web-sessions`. It never returns the API's session or CSRF
  credentials in JSON.
- `GET /api/auth/web-session` resolves the current API session, and
  `POST /api/auth/logout` revokes it through
  `/api/v1/auth/web-sessions/current`.
- Production uses the HttpOnly, Secure, SameSite=Lax, host-only
  `__Host-sj_web_session` cookie. Development uses `sj_web_session` because an
  insecure localhost cookie cannot legally use the `__Host-` prefix.
- The standalone Docker image also uses `sj_web_session` on loopback, but only
  after its non-root entrypoint validates the mounted repository local-platform
  marker. Setting local environment flags without that marker fails startup.
- The readable `sj_csrf` cookie must exactly match `X-SJ-CSRF`, and mutations
  must have an Origin exactly matching `WEBSITE_ORIGIN`.
- `src/lib/dal/session.ts` is the Server Component/DAL entrypoint and uses the
  Next.js 16 asynchronous `cookies()` API. Session data is deduplicated within
  a render request and is never shared across users.
- `/app/select-company`, `/app/c/{companyId}`,
  `/app/c/{companyId}/jobs`, `/app/c/{companyId}/clients`, and
  `/app/c/{companyId}/inventory`, `/app/c/{companyId}/documents`,
  `/app/c/{companyId}/workers`, and
  `/app/c/{companyId}/settings` are opaque-session server-rendered slices. Zero
  memberships continue to onboarding, one is selected automatically, and
  multiple memberships render a workspace picker.
- The tenant overview verifies the requested public company ID against the
  viewer's server-resolved memberships before requesting the lightweight
  bootstrap DTO with `SmartJobSession`. The response is runtime-validated with
  `@smart-job/api-contracts`; no session credential becomes a Client Component
  prop or browser-readable value.
- The tenant jobs page performs the same membership check before one bounded
  direct-API read. Status, search, UTC date range, and opaque composite-cursor
  pagination are URL-driven and SQL-backed. Initial rows render in the Server
  Component response, so the browser neither calls Cloud Run nor refetches the
  first page after hydration.
- The tenant clients page verifies exact membership and the resolved clients
  module entitlement before one bounded direct-API read. Search and opaque
  composite-cursor pagination use native GET navigation and execute in SQL.
  The initial directory is runtime-validated and server-rendered. Focused
  Client Components create, edit, and delete-or-archive through tenant-scoped
  same-origin BFF routes; exact Origin, double-submit CSRF, the opaque session,
  retry-stable idempotency keys, and entity versions are mandatory. The browser
  never receives a Cloud Run URL or session credential.
- The tenant inventory page selects company stock for manager/user/dev roles
  and the authenticated member location for workers. Basic users and disabled
  inventory entitlements render a disabled state before any inventory request;
  filters and opaque cursor navigation stay server-rendered and SQL-backed.
  Manager/dev client islands create, edit, activate/deactivate, archive, and
  adjust company stock through tenant-scoped same-origin BFF routes. Exact
  Origin, double-submit CSRF, the opaque session, retry-stable idempotency keys,
  and the appropriate part or stock entity version are required; user and
  worker views remain read-only on this website route.
- The tenant documents page checks exact membership, document-module
  entitlement, and role before one bounded API read. Search, generation
  status, document type, UTC date range, and composite-cursor navigation run in
  SQL. File links call a same-origin opaque-session Route Handler that requests
  a fresh short-lived signed URL server-to-server and returns only a no-store
  redirect; the browser never calls Cloud Run or receives its session token.
  A focused client composer submits non-tax preview/generate tasks through
  exact-Origin, double-submit-CSRF BFF routes with retry-stable idempotency
  keys, then polls task status through an opaque-session same-origin read BFF.
  Tax type `305` is excluded from and rejected by these generic routes so it
  remains on the existing tax-authority workflow. Manager/dev deletion is
  limited to ungenerated, inactive non-tax documents and sends the current
  opaque entity version; stale writes surface as HTTP `409` conflicts.
- The tenant Team page pre-gates exact membership, Team entitlement, and the
  manager/dev role before one bounded worker-directory read. Search, role,
  status, and cursor navigation are SQL-backed. Invitation creation uses only
  `POST /api/workers/invitation`, which requires exact Origin, double-submit
  CSRF, the opaque HttpOnly session, and a stable idempotency key; the browser
  never receives the Cloud Run credential.
- The tenant settings page checks exact membership before concurrently reading
  the authenticated and company profiles. Both DTOs are runtime-validated and
  rendered on the server. Personal and manager/dev company updates cross
  same-origin CSRF-protected BFFs with stable idempotency keys; company writes
  carry an opaque entity version, surface HTTP 409 conflicts, and never offer
  or send the immutable VAT number.
- `POST /api/onboarding/business-registration` is the same-origin BFF for the
  hardened first-workspace API. It requires exact Origin, double-submit CSRF,
  an opaque HttpOnly session, and an idempotency key; role, tier, modules,
  company number, and identity are derived by the backend/SQL rather than the
  browser payload. The legacy onboarding client is not cut over yet.
- The legacy `/app/*` client pages remain on their existing shell during the
  incremental migration. Only the explicit `/app/c/*` and selection routes
  bypass it, so this slice does not activate the login or data-path cutover.

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
- Edge function caller URLs use flattened dash names for nested paths (e.g., `contact-request`, `invites-create`) to match Supabase deploy names.
- Client list workflows drain paginated read-model pages through `src/lib/services/backend-service.ts`.
- Tax invoice creation delegates to backend draft-document reservation and async PDF scheduling.
- Explicit-tenant document downloads use the same-origin BFF and backend-issued
  short-lived URLs; protected storage paths and backend credentials are never
  returned in browser JSON.
- Registration sends a verification email and does not sign the user in. Email
  confirmation and recovery credentials terminate in server Route Handlers so
  Supabase recovery/access tokens never enter browser JavaScript.
- Contact request spam/challenge validation failures return stable `400` API errors (`spam_rejected`, `invalid_challenge`) instead of ambiguous server failures.

## Required Patterns

- Keep API routes thin: parse, validate, auth-check, proxy.
- Keep `page.tsx` as a Server Component. Add a focused Client Component only
  when browser-only interaction is required; never move initial ERP reads into
  a client shell.
- Keep protected writes backend-only.
- Keep React Hook Form + Zod for form handling.

## Environment Variables

- `SUPABASE_URL` (server-only Auth origin)
- `SUPABASE_PUBLISHABLE_KEY`
- `WEBSITE_SESSION_SECRET`
- `CONTACT_CHALLENGE_SECRET` (optional; falls back to the website secret)
- `BACKEND_API_BASE_URL` (server only; HTTPS, except loopback development)
- `BACKEND_API_TIMEOUT_MS` (optional; defaults to and cannot exceed `12000`)
- `WEBSITE_ORIGIN` (exact website origin used for mutation checks)

See `.env.local.example`. Local container-only variables are injected by the
repository lifecycle script and must not be copied into deployed environments.

## Commands

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm run test
npm run build
```

The production-shaped local image is built from the repository root because
standalone tracing includes both shared contracts packages:

```powershell
.\scripts\local-platform.ps1 start
```

## References

- `../SETUP.md`
- `../backend.md`
- `../architecture.md`
