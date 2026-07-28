# Pub/Sub dead-letter replay

The database outbox is authoritative. Pub/Sub transports opaque IDs only; a
dead-letter message is not permission to recreate business payloads or edit
workflow tables.

## Triage

1. Pause the affected Scheduler drain or push subscription only if continued
   delivery is worsening the incident. Do not pause unrelated topics.
2. Record the source subscription/topic, dead-letter topic/subscription,
   publication time, delivery attempts, message ID, and wrapped source
   attributes. Never copy customer data or credentials into the incident log.
3. Pull a bounded sample without acknowledgment for inspection. Confirm the
   decoded original body contains only the expected `taskId` or `deliveryId` and
   matches the source subscription.
4. Inspect canonical SQL state, lease expiry, attempt count, and last safe error.
   Resolve the underlying permission, configuration, dependency, or payload
   defect before replay.

## Replay choice

- Prefer running the authenticated document/email outbox Scheduler drain after
  the canonical row is eligible. The drain republishes the correct opaque ID
  and preserves lease/idempotency behavior.
- For a single verified message whose canonical row is still eligible, publish
  only the decoded original opaque-ID JSON to the original topic. Do not
  republish Pub/Sub's dead-letter wrapper.
- Use snapshot/timestamp `seek` only for an approved bulk replay. It changes ack
  state for a range, requires message retention, and resets delivery-attempt
  counters on subscriptions with dead-letter topics. Estimate duplicate volume
  and confirm every affected handler is replay safe first.
- Never bulk replay tax submission messages or email rows in
  `delivery_unknown`. Follow the dedicated reconciliation runbooks.

## Execute and close

Replay a tiny canary, verify the canonical row reaches its expected terminal
state, then continue in bounded batches while watching error rate, leases, DB
pool pressure, and DLQ depth. Acknowledge dead-letter messages only after their
canonical work is complete or explicitly quarantined. Resume the Scheduler and
push subscription, confirm backlog drains, and record counts for replayed,
completed, duplicate-safe, quarantined, and still-failed messages.
