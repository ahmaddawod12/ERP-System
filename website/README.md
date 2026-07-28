# Smart-Job Website

The website is a Next.js 16 App Router application running on Node 22. It is a
server-rendered client of `cloudrun-api`; it does not call business tables,
Firebase, or Cloud Run directly from browser code.

## Runtime architecture

- Firebase Auth calls terminate on the server.
- A successful login exchanges Firebase credentials for one opaque,
  Postgres-backed HttpOnly session cookie (`__Host-sj_web_session` in
  production). Firebase ID and refresh tokens never enter browser storage,
  HTML, readable cookies, or browser JSON.
- All protected routes resolve the session and exact company membership in the
  server-only DAL before issuing bounded Cloud API reads.
- The canonical protected URL shape is `/app/c/{companyId}/...`. Legacy
  `/app/*` entry points are redirects only.
- Initial overview, jobs, clients, inventory, documents, workers, settings, and
  upgrade data is rendered in Server Components. Focused Client Components own
  interaction only.
- Browser mutations call same-origin BFF Route Handlers. They require the exact
  configured `WEBSITE_ORIGIN`, a readable `sj_csrf` cookie matching
  `X-SJ-CSRF`, a stable `Idempotency-Key`, and the current opaque entity version
  where the API contract requires one.

## Security invariants

- Never add `"use client"` to a `page.tsx` file.
- Never expose Firebase credentials, database credentials, a bearer
  token, or a `SmartJobSession` value to browser JavaScript.
- Keep tenant authorization server-side; a company ID in the URL is not proof
  of access.
- Keep list reads cursor bounded. Forward filters and `afterCursor` to the API
  instead of loading a collection and filtering in memory.
- Tax invoice type `305` uses the authoritative tax workflow. Generic document
  preview/generate routes must continue to reject it.
- Store canonical file paths and request short-lived downloads through the BFF;
  do not persist signed URLs.

## Environment

Copy [`.env.example`](./.env.example) to `.env.local` and replace every
placeholder. Public browser configuration is limited to the reCAPTCHA site
key. All Firebase and backend transport settings are server-only.

The repository-owned local platform injects its own container configuration.
Do not manually copy `SMART_JOB_LOCAL_PLATFORM` flags into a host or deployed
environment.

## Commands

Run from the repository root:

```bash
npm --prefix packages/contracts run build
npm --prefix packages/api-contracts run build
npm --prefix website run test
npm --prefix website run typecheck
npm --prefix website run lint
npm --prefix website run build
```

The Playwright suite is self-contained by default: it starts a strict fake API
on port `4100` and Next.js on port `3100`, then exercises login, reload,
logout, unauthenticated redirects, tenant isolation, and absence of browser
credentials.

```bash
npm --prefix website exec playwright install chromium
npm --prefix website run test:e2e
```

Set `PLAYWRIGHT_BASE_URL`, `E2E_TEST_EMAIL`, and `E2E_TEST_PASSWORD` only when
deliberately running the same journeys against a seeded non-production target.

The standalone production image must be built with the repository root as its
Docker context because Next.js traces the shared contracts packages.

## References

- [`../SETUP.md`](../SETUP.md)
- [`../architecture.md`](../architecture.md)
- [`../backend.md`](../backend.md)
- [`../docs/runbooks/README.md`](../docs/runbooks/README.md)
