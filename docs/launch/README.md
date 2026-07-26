# Launch evidence register

Repository implementation and production launch approval are deliberately
separate. CI and local checks prove the source tree; they cannot prove DNS
delegation, cloud project configuration, a timed restore, a seven-day soak,
store adoption, assistive-technology behavior on physical devices, or legal
approval.

Copy [`LAUNCH_EVIDENCE_TEMPLATE.md`](./LAUNCH_EVIDENCE_TEMPLATE.md) into the
private change record for each environment. Do not commit credentials, private
customer data, access tokens, database URLs, or unredacted screenshots. Each
gate needs an owner, UTC timestamp, immutable commit/image digest, evidence
location, measured result, and explicit pass/fail decision.

Launch remains blocked while any required row is blank, failed, expired, or
marked not run. Tax submission remains disabled until its separate
certification approval even after the platform launch gates pass.

Production deployment additionally consumes the sanitized JSON shape in
[`launch-evidence.example.json`](./launch-evidence.example.json) from the
protected `PRODUCTION_LAUNCH_EVIDENCE_JSON` GitHub Environment variable. The
preflight validates owners, evidence references, exact release SHA, signed image
digests, RPO/RTO, the seven-day soak, tax-disabled state, and prior rollout
stages. Keep secret values and customer data in the private evidence system;
the JSON stores references only.

Validate a final evidence export locally with:

```powershell
$env:RELEASE_SHA = "<exact 40-character SHA>"
$env:RELEASE_STAGE = "approved"
node scripts/check-launch-evidence.mjs .\path\to\sanitized-evidence.json
```

Manual accessibility evidence uses
[`ACCESSIBILITY_REVIEW.md`](./ACCESSIBILITY_REVIEW.md). Native release evidence
also follows [`../../phone_app/MOBILE_ROLLOUT.md`](../../phone_app/MOBILE_ROLLOUT.md).
