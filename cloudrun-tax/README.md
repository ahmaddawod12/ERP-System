# Smart-Job tax gateway

`cloudrun-tax` is the stateless Node 22/Fastify boundary for Israeli
tax-authority traffic. It terminates public tax-authority callbacks in
`me-west1`, validates their HMAC signature and idempotency, and forwards them
to a protected internal main-API endpoint using Cloud Run service identity.

The service has no database connection and is not an application data writer.
Tax approval operations must be initiated by the main API using Cloud Run
service identity. Public callbacks validate their authority signature and then
call a protected internal main-API endpoint.

## Commands

Build the shared packages before installing or building this independently:

```bash
npm --prefix packages/contracts run build
npm --prefix packages/api-contracts run build
npm --prefix cloudrun-tax install
npm --prefix cloudrun-tax run typecheck
npm --prefix cloudrun-tax run build
npm --prefix cloudrun-tax run test
```

Start the compiled service:

```bash
npm --prefix cloudrun-tax run build
npm --prefix cloudrun-tax start
```

## Configuration

| Variable | Default | Purpose |
|---|---:|---|
| `HOST` | `0.0.0.0` | Listen address. |
| `PORT` | `8080` | Cloud Run HTTP port. |
| `LOG_LEVEL` | `info` | Pino log level. |
| `TAX_SUBMISSION_MODE` | `disabled` | Outbound gate: `disabled`, `sandbox`, or `production`. |
| `TAX_TOKEN_URL` | unset | Tax authority OAuth token endpoint. |
| `TAX_APPROVAL_URL` | unset | Tax authority invoice approval endpoint. |
| `TAX_CLIENT_ID` | unset | OAuth client ID. |
| `TAX_CLIENT_SECRET` | unset | OAuth client secret. |
| `TAX_SCOPE` | unset | Optional OAuth scope. |
| `TAX_CALLBACK_HMAC_SECRET` | unset | HMAC secret for callback authentication (≥ 32 chars). |
| `TAX_CALLBACK_MAX_SKEW_SECONDS` | `300` | Maximum timestamp skew for callback verification. |
| `MAIN_API_URL` | unset | Protected internal main-API callback endpoint URL. |
| `MAIN_API_AUDIENCE` | unset | Cloud Run ID-token audience for the main API. |
| `TAX_GATEWAY_AUDIENCE` | unset | Exact Cloud Run audience for ID tokens presented to this gateway. |
| `TAX_APPROVAL_CALLER_SERVICE_ACCOUNT` | unset | Main API service account allowed to call `/api/v1/tax/approval`. |

The operational variables (`TAX_*` and `MAIN_API_*`) must all be supplied
together when the gateway is operationally configured. Production starts with
submission disabled; enabling it requires the complete operational
configuration. The HMAC callback secret must be at least 32 characters.

## HTTP surface

- `GET /healthz` reports process health.
- `GET /readyz` reports readiness. There are currently no upstream dependencies
  to probe.
- `POST /api/v1/tax/callback` terminates a public tax-authority callback. It
  verifies the HMAC signature (`x-sj-tax-signature`, `x-sj-tax-timestamp`,
  `x-sj-tax-event-id`), parses the Pub/Sub envelope, and forwards the
  normalized callback to the protected main API. Returns 503 when the gateway
  is not operationally configured.
- `POST /api/v1/tax/approval` accepts a tax approval request from the main
  API. It verifies the Cloud Run service identity, binds the request's
  `documentId` and `oauthSessionId` in the main API before any authority call,
  exchanges a
  `client_credentials` OAuth token with the tax authority, submits the
  invoice for approval, and returns the normalized result. Returns 503 without
  contacting the authority when `TAX_SUBMISSION_MODE=disabled`, or when an
  enabled gateway is not operationally configured.
- Every response uses the shared Smart-Job API envelope and includes the
  propagated or generated `x-request-id`.

Request bodies, authorization/cookie headers, credential fields, and query
strings are excluded from structured request logs. No tax credentials or
invoice payloads may be added to log context. Malformed JSON, oversized bodies,
and unsupported media types remain non-retryable 4xx responses rather than
being converted into retryable service failures.

Cloud Run ingress is intentionally configured to allow unauthenticated HTTP
transport because authority callbacks use HMAC and approval calls use an
application-verified Google ID token. The route handlers remain fail-closed;
Cloud Run IAM is not the route-level authentication boundary for this mixed-auth
service.
