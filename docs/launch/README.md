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

Manual accessibility evidence uses
[`ACCESSIBILITY_REVIEW.md`](./ACCESSIBILITY_REVIEW.md). Native release evidence
also follows [`../../phone_app/MOBILE_ROLLOUT.md`](../../phone_app/MOBILE_ROLLOUT.md).

