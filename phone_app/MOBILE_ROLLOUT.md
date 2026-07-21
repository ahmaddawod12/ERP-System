# Mobile Cloud API Rollout

This runbook gates the Batch 4 mobile cutover. The release keeps the legacy
Edge deployment available only as rollback compatibility; the new binary does
not call it or contain `EXPO_PUBLIC_EDGE_FUNCTIONS_BASE_URL`.

## Release prerequisites

- Build `packages/contracts` and `packages/api-contracts`, then run the mobile
  tests, typecheck, and Expo Doctor.
- Create fresh Android and iOS native builds. Crashlytics is a new native
  module, so this release cannot be delivered as an Expo OTA update.
- Validate login, tenant switching, job create/edit/accept/delete/completion,
  attachment upload/download, document preview/detail/download, tax-disabled
  behavior, invitations, upgrades, archives, FCM, and encrypted pending work in
  staging.
- Confirm production has the Cloud API, Supabase Storage, FCM, and Crashlytics
  configuration for the same release environment. Keep tax submission
  disabled until its separate certification gate passes.

## Staged promotion

1. Release to 10% of eligible installations for at least 24 hours.
2. Promote to 50% for at least 48 additional hours.
3. Promote to 100% only while crash-free sessions and the Cloud API error
   budget remain healthy.

At each step, record the Android version code and iOS build number, active
installation adoption, Crashlytics crash-free sessions, Cloud API 4xx/5xx and
latency, attachment failures, outbox backlog, document-task failures, and any
requests reaching legacy business endpoints. Pause promotion when a metric
breaches the environment's release threshold. Roll back store availability to
the last healthy native build while leaving backwards-compatible API routes
deployed.

## Edge retirement gate

Do not remove the compatibility Edge deployment until both conditions are
continuously true:

- At least 99% of active installations are on this Cloud-API-only version or a
  newer version.
- Legacy business endpoint traffic is exactly zero for 30 consecutive days.

The 30-day window restarts after any legacy business request. Authentication
health checks and explicitly identified non-business probes must be reported
separately rather than silently excluded.

After the gate is approved, remove the legacy Edge code, deployment secrets,
and environment configuration in a dedicated reversible release. Re-run the
mobile source guard to prove that `EXPO_PUBLIC_EDGE_FUNCTIONS_BASE_URL`, Edge
callables, and Firebase Storage have not returned.
