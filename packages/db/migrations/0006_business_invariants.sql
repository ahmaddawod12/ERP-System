ALTER TABLE job_part_usages
  ADD CONSTRAINT job_part_usages_quantity_non_negative_check
  CHECK (quantity >= 0) NOT VALID;

ALTER TABLE inventory_parts
  ADD CONSTRAINT inventory_parts_low_threshold_non_negative_check
  CHECK (low_threshold >= 0) NOT VALID;

ALTER TABLE inventory_balances
  ADD CONSTRAINT inventory_balances_quantity_on_hand_non_negative_check
  CHECK (quantity_on_hand >= 0) NOT VALID;

ALTER TABLE inventory_movements
  ADD CONSTRAINT inventory_movements_quantity_positive_check
  CHECK (quantity > 0) NOT VALID;

ALTER TABLE documents
  ADD CONSTRAINT documents_total_before_vat_non_negative_check
  CHECK (total_before_vat >= 0) NOT VALID;

ALTER TABLE documents
  ADD CONSTRAINT documents_vat_amount_non_negative_check
  CHECK (vat_amount >= 0) NOT VALID;

ALTER TABLE documents
  ADD CONSTRAINT documents_total_with_vat_non_negative_check
  CHECK (total_with_vat >= 0) NOT VALID;

ALTER TABLE documents
  ADD CONSTRAINT documents_total_consistency_check
  CHECK (total_before_vat + vat_amount = total_with_vat) NOT VALID;

ALTER TABLE document_items
  ADD CONSTRAINT document_items_quantity_positive_check
  CHECK (quantity > 0) NOT VALID;

ALTER TABLE document_items
  ADD CONSTRAINT document_items_unit_price_non_negative_check
  CHECK (unit_price >= 0) NOT VALID;

ALTER TABLE document_items
  ADD CONSTRAINT document_items_line_total_non_negative_check
  CHECK (line_total >= 0) NOT VALID;
