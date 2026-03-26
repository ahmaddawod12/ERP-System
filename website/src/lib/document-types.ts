export const DOC_TYPE = Object.freeze({
  PRICE_PROPOSAL: 10,
  DELIVERY_NOTE: 200,
  RETURN_CERTIFICATE: 210,
  TAX_INVOICE: 305,
  REFUND: 330,
  RECEIPT: 400,
});

export const DOC_SUFFIX = Object.freeze({
  [DOC_TYPE.TAX_INVOICE]: "TI",
  [DOC_TYPE.PRICE_PROPOSAL]: "PP",
  [DOC_TYPE.REFUND]: "RD",
  [DOC_TYPE.RETURN_CERTIFICATE]: "RC",
  [DOC_TYPE.DELIVERY_NOTE]: "DN",
  [DOC_TYPE.RECEIPT]: "RT",
});

const DOC_LABELS = Object.freeze({
  [DOC_TYPE.PRICE_PROPOSAL]: "Price Proposal",
  [DOC_TYPE.DELIVERY_NOTE]: "Delivery Note",
  [DOC_TYPE.RETURN_CERTIFICATE]: "Return Certificate",
  [DOC_TYPE.TAX_INVOICE]: "Tax Invoice",
  [DOC_TYPE.REFUND]: "Refund",
  [DOC_TYPE.RECEIPT]: "Receipt",
});

export const VAT_RATE = 0.18;

const DOCUMENT_TYPE_ORDER = [
  DOC_TYPE.PRICE_PROPOSAL,
  DOC_TYPE.DELIVERY_NOTE,
  DOC_TYPE.RETURN_CERTIFICATE,
  DOC_TYPE.TAX_INVOICE,
  DOC_TYPE.REFUND,
  DOC_TYPE.RECEIPT,
] as const;

export type DocumentTypeCode = (typeof DOCUMENT_TYPE_ORDER)[number];

export function getDocumentTypeLabel(code: number) {
  return DOC_LABELS[code as DocumentTypeCode] ?? `Type ${code}`;
}

export const DOCUMENT_TYPES = DOCUMENT_TYPE_ORDER.map((code) => ({
  code,
  label: getDocumentTypeLabel(code),
  suffix: DOC_SUFFIX[code],
})) as readonly {
  code: DocumentTypeCode;
  label: string;
  suffix: string;
}[];

export const VAT_RATE_PERCENT = Math.round(VAT_RATE * 100);
