# Mobile rollout

The shipped client uses the Cloud Run API exclusively for ERP data. Supabase
Edge, Firebase Auth/Functions/Firestore/Storage, and the old rollback endpoint
are not present in the repository; rollback therefore depends on API backward
compatibility and a previously healthy native build, not a legacy data path.

## Release prerequisites

1. Build `packages/contracts` and `packages/api-contracts`, then run:

   ```bash
   npm --prefix phone_app run test
   npm --prefix phone_app run typecheck
   npm --prefix phone_app run doctor
   node scripts/check-maestro-flows.mjs
   ```

2. Produce fresh Android and iOS binaries. NotifyKit, Messaging, Crashlytics,
   SecureStore, SQLCipher/SQLite, and other native dependencies cannot be added
   or changed by an Expo OTA update.
3. Inject `.env.example` values through the EAS environment and inject
   `google-services.json` / `GoogleService-Info.plist` through build secrets.
   Confirm the API origin is stable HTTPS and matches the release environment.
4. Confirm the API and worker image digests, database migrations, Supabase
   Storage, FCM/APNs, Crashlytics, Pub/Sub, email, archive, and tax-disabled
   paths are healthy before building the production binary.
5. Run the mandatory Maestro Cloud flows against a seeded non-production
   environment. CI requires:

   - secret `MAESTRO_CLOUD_API_KEY`
   - variable `MAESTRO_CLOUD_PROJECT_ID`
   - variable `MAESTRO_CLOUD_APP_BINARY_ID`
   - variable `MAESTRO_APP_ID`
   - secret `MAESTRO_TEST_EMAIL`
   - secret `MAESTRO_TEST_PASSWORD`
   - variable `MAESTRO_TEST_WORKSPACE`
   - variable `MAESTRO_TEST_JOB_TITLE`

   The seeded user must have multiple workspaces and one job with the configured
   title. Offline mode is Android-only in Maestro and verifies that Pending Work
   remains safe while airplane mode is enabled.

## Acceptance matrix

Validate login/recovery, tenant selection/switching, role-specific dashboards,
bounded pagination, job create/update/accept/delete/completion, attachment
upload/download, document preview/generate/detail/download, invitations,
clients, inventory, workers, upgrades, archive reads, notification open/display,
and tax-disabled behavior.

For offline v1, separately verify `job.create_finished` and
`job.complete_assigned` across app restart, foreground, network restoration,
logout/re-login by the same uid, conflict, retry, and explicit discard. Confirm
another uid cannot open the prior uid's SQLCipher outbox or staged files.

## Staged promotion

1. Internal/test channel: complete the acceptance matrix and keep the build for
   at least one normal work cycle.
2. Promote to 10% of eligible installations for at least 24 hours.
3. Promote to 50% for at least 48 additional hours.
4. Promote to 100% only while release gates remain healthy.

At each stage record version code/build number, active adoption, crash-free
sessions, API latency/error budget, auth refresh failures, attachment errors,
outbox age/conflicts, Pub/Sub/DLQ depth, PDF/email outcomes, and notification
delivery. Use explicit environment thresholds; absence of telemetry is a failed
gate, not a reason to continue.

## Pause and rollback

Pause promotion on an SLO breach, tenant/auth anomaly, data-integrity issue,
outbox loss, crash regression, or unexpected tax behavior. Keep compatible API
routes deployed, stop store rollout and OTA promotion, and release the last
healthy compatible native build. Installed binaries cannot be remotely
recalled, so do not remove an API contract until supported active versions no
longer use it.

Close the rollout only after 99% of active installations are on the release (or
newer), the observation window is complete, and incident/support queues show no
release-linked regression.
