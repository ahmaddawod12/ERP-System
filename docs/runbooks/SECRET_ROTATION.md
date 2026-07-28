# Secret rotation

Rotate one credential family at a time and retain a tested rollback version
until every consumer is healthy. Secret values must be generated and entered
through an approved secret channel, never a command pasted into a ticket or
committed `.env` file.

## Standard sequence

1. Inventory every producer and consumer, the current numbered Secret Manager
   version, external-system credential, service revision, and rollback owner.
2. Create the replacement in the upstream system without invalidating the old
   credential when overlap is supported.
3. Add a new immutable Secret Manager version. Bind a numbered version for the
   rollout; do not rely on a moving `latest` alias for a controlled production
   release.
4. Deploy the smallest consumer set, verify readiness and representative calls,
   then roll out gradually. Watch authentication errors and provider rejects.
5. Move all consumers, wait through the approved observation window, disable
   the old version, and verify again.
6. Revoke the upstream credential and destroy the old secret version only after
   rollback is no longer needed. Record completion and the next review date.

## Credential-specific notes

- **Database roles:** rotate each runtime role independently. Test connection,
  request context, timeouts, and narrow RPC permissions before revoking the old
  password. The migration credential is never mounted into a runtime service.
- **Firebase web API keys:** restrict each key to the intended Firebase/Identity
  Toolkit APIs and approved application surfaces. Roll server consumers first,
  then ship native configuration changes through new signed mobile builds.
- **Website session encryption:** the API currently decrypts only the configured
  `WEB_SESSION_ENCRYPTION_KEY_VERSION`. Rotating it intentionally invalidates
  existing opaque sessions; schedule a controlled re-login window. Never reuse
  a version label for different key bytes.
- **Website recovery/contact secrets:** rotate with the website revision and
  expect outstanding signed recovery/contact challenges to expire.
- **Tax credentials/HMAC:** keep tax submission disabled during rotation. Test
  sandbox token, approval, callback signature, correlation binding, and main API
  identity before any certification-controlled enablement.
- **AWS SES:** verify the exact sender identity, region, least-privilege policy,
  and a non-customer test delivery. Do not automatically replay
  `delivery_unknown` rows after rotation. For federation cutover, apply the
  separate AWS stack, validate Google token issuer/audience/subject plus STS
  expiry in staging, then enable `email_ses_federation`. Confirm the Cloud Run
  revision no longer mounts `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY`
  before disabling the old IAM key and setting
  `enable_static_ses_credentials=false`. Federated mode has no static fallback.
- **GitHub WIF and deploy identity:** prefer short-lived federation. Rotate the
  provider/service account binding without introducing static GCP keys, then
  verify a non-production keyless signature and deployment.
- **Firebase native configuration:** rotate through EAS/build secrets and ship a
  new native binary when native files change; never commit them. Store Android
  and iOS files as `GOOGLE_SERVICES_JSON` and `GOOGLE_SERVICE_INFO_PLIST` file
  variables in each matching EAS environment. Restrict keys to the exact mobile
  app identity and rotate any key whose console restrictions cannot be proven.
