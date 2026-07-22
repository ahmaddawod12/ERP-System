# Tax submission reconciliation

`submission_unknown` means the authority might have accepted a request even
though Smart-Job did not receive a definitive response. Blind retry can create a
duplicate fiscal submission and is forbidden.

## Procedure

1. Keep `TAX_SUBMISSION_MODE=disabled` during platform launch and during any
   tax incident. Pause the protected tax outbox Scheduler before investigating
   a systemic issue.
2. Record the document ID, reservation, stable correlation/OAuth session ID,
   submission attempt, UTC timestamps, payload hash, and current document/tax
   states. Do not copy credentials or full customer payloads into tickets.
3. Query the Tax Authority through its approved operator/support channel using
   the stable correlation reference. Determine whether the submission is:
   approved with confirmation, explicitly rejected/not accepted, still pending,
   or unverifiable.
4. For an authoritative result, redeliver the provider callback through
   `cloudrun-tax` so HMAC validation, callback replay protection, payload-hash
   conflict detection, and the main API transaction all run normally. Never
   update the document, reservation, callback, or outbox tables by hand.
5. A callback replay with the same payload hash is safe. A different hash for an
   existing callback event is a security/data-integrity incident and must remain
   blocked for review.
6. Only `approved` plus a confirmation number may enqueue the final PDF. Verify
   reserved/submitted/rejected/failed/unknown states do not expose approval or a
   final tax PDF.
7. If the authority cannot prove absence or acceptance, leave the row
   `submission_unknown` and escalate to finance/compliance. Do not convert
   uncertainty into a retry.

After reconciliation, run one bounded document outbox drain if an approved PDF
task remains pending, verify document/version advancement and audit evidence,
then re-enable the tax Scheduler only under the certification-approved mode.
