# SES workload federation

This separate AWS state creates a Google OIDC provider and one least-privilege
SES role. Its trust policy requires all three Google token bindings:

- `aud`/authorized party: the immutable numeric Cloud Run email service-account
  unique ID
- `oaud`: the dedicated Smart-Job email audience
- `sub`: the same immutable service-account unique ID

The role can call only `ses:SendEmail` for the configured verified identity and
`ses:GetAccountSendingEnabled` for readiness. Terraform contains no AWS keys.

Apply this stack in its own protected backend, validate federation in staging,
then configure the GCP runtime with `AWS_SES_CREDENTIAL_MODE=federated` and the
three outputs. After successful send, readiness, credential-expiry, failover,
and rotation tests, set the GCP foundation's
`enable_static_ses_credentials=false` and remove both legacy secret values.
There is no static-key fallback in federated mode.

Google service-account identity tokens are Google-signed, have a one-hour
lifetime, and expose the immutable service-account unique ID as `sub` and
`azp`. The worker fetches them directly from the Cloud Run metadata server,
validates issuer/audience/subject locally, exchanges them with AWS STS, and
caches only the returned temporary credentials in memory.
