# Email `delivery_unknown`

`delivery_unknown` means SES may have accepted the message before the worker
lost the response. Automatic resend is forbidden because it could send a
duplicate customer document.

## Procedure

1. Record the delivery ID, document ID, tenant, attempt, recipient domain (not
   the full address in broad incident channels), UTC send window, and worker
   request ID. Do not expose the signed document URL.
2. Check SES event/configuration-set logs, provider message ID, bounce/
   complaint/delivery events, Cloud Run logs, and—where policy permits—confirm
   receipt with the intended customer.
3. If delivery is confirmed, do not retry. Preserve the evidence and escalate
   any missing internal terminal transition as a product defect; do not edit the
   row manually.
4. If SES definitively rejected the message before acceptance, normal bounded
   worker retry rules may apply after the cause is fixed.
5. If non-delivery is confirmed and the customer still needs the document, an
   authorized manager/dev may call
   `POST /api/v1/companies/{companyId}/documents/{documentId}/email-retry` with
   a fresh stable `Idempotency-Key` through an approved authenticated client.
   Reuse that key for transport retries of the same operator decision.
6. If evidence remains ambiguous, leave the row `delivery_unknown`; obtain an
   explicit customer/operations decision before any manual resend.

Verify that a manual retry creates/requeues only the allowed delivery, publishes
an opaque `deliveryId`, respects the manual retry limit, and reaches a terminal
state. Record the operator decision and whether the customer received a
duplicate.
