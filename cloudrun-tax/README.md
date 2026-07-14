# Smart-Job tax gateway

`cloudrun-tax` is the stateless Node 22/Fastify boundary for future Israeli
tax-authority traffic. It is intentionally limited to service probes until the
tax integration, callback authentication, and deployment configuration pass
their implementation approval gates.

The service has no database connection and is not an application data writer.
Future tax operations must be initiated by the main API using Cloud Run service
identity. Future public callbacks must validate their authority signature or
OIDC identity and then call a protected internal main-API endpoint.

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
| `MAIN_API_URL` | unset | Reserved main-API internal endpoint placeholder. |
| `MAIN_API_AUDIENCE` | unset | Reserved Cloud Run ID-token audience placeholder. |

The two main-API placeholders must be supplied together. They are optional
until the gated tax/deployment stage and are not used by a public route yet.

## HTTP surface

- `GET /healthz` reports process health.
- `GET /readyz` reports readiness. There are currently no upstream dependencies
  to probe.
- Every response uses the shared Smart-Job API envelope and includes the
  propagated or generated `x-request-id`.

Request bodies, authorization/cookie headers, credential fields, and query
strings are excluded from structured request logs. No tax credentials or
invoice payloads may be added to log context. Malformed JSON, oversized bodies,
and unsupported media types remain non-retryable 4xx responses rather than
being converted into retryable service failures.
