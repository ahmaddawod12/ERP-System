import test from "node:test";
import assert from "node:assert/strict";
import { DOC_TYPE } from "@smart-job/contracts";
import {
  DOCUMENT_TYPES,
  VAT_RATE_PERCENT,
  getDocumentTypeLabel,
} from "../src/lib/document-types.ts";

test("document type labels are derived from shared contracts", () => {
  assert.equal(getDocumentTypeLabel(DOC_TYPE.TAX_INVOICE), "Tax Invoice");
  assert.equal(getDocumentTypeLabel(DOC_TYPE.PRICE_PROPOSAL), "Price Proposal");
  assert.equal(getDocumentTypeLabel(999), "Type 999");
});

test("document suffixes stay aligned with shared contract codes", () => {
  const receipt = DOCUMENT_TYPES.find((item) => item.code === DOC_TYPE.RECEIPT);
  const refund = DOCUMENT_TYPES.find((item) => item.code === DOC_TYPE.REFUND);

  assert.equal(receipt?.suffix, "RT");
  assert.equal(refund?.suffix, "RD");
  assert.equal(VAT_RATE_PERCENT, 18);
});
