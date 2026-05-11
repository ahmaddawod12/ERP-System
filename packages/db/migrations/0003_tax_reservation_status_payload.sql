ALTER TYPE tax_invoice_reservation_status ADD VALUE IF NOT EXISTS 'rejected';
ALTER TYPE tax_invoice_reservation_status ADD VALUE IF NOT EXISTS 'validation_failed';
ALTER TYPE tax_invoice_reservation_status ADD VALUE IF NOT EXISTS 'submission_failed';
ALTER TYPE tax_invoice_reservation_status ADD VALUE IF NOT EXISTS 'approval_received_needs_reconcile';

ALTER TABLE tax_invoice_reservations
  ADD COLUMN IF NOT EXISTS status_payload JSONB NOT NULL DEFAULT '{}'::jsonb;