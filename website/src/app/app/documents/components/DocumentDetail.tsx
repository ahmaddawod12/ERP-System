import { CheckCircle2 } from "lucide-react";
import { getDocumentTypeLabel, VAT_RATE_PERCENT } from "@/lib/document-types";
import type { DocumentRecord } from "@/lib/types";

export function DocumentDetail({
  documentRecord,
  onOpenPdf,
  isOpening,
}: {
  documentRecord: DocumentRecord;
  onOpenPdf: () => void;
  isOpening: boolean;
}) {
  return (
    <div className="space-y-4 text-sm">
      {/* Document Info */}
      <div className="grid grid-cols-2 gap-2 rounded-[1.2rem] bg-slate-50 p-4 dark:bg-slate-800/50">
        {documentRecord.documentType != null && (
          <div>
            <span className="text-xs text-slate-500">Type</span>
            <p className="font-medium">{getDocumentTypeLabel(documentRecord.documentType)}</p>
          </div>
        )}
        {(documentRecord.documentNumber ?? documentRecord.documentId) && (
          <div>
            <span className="text-xs text-slate-500">Document #</span>
            <p className="font-medium">
              {documentRecord.documentNumber ?? documentRecord.documentId}
            </p>
          </div>
        )}
        {documentRecord.confirmationNumber && (
          <div>
            <span className="text-xs text-slate-500">Confirmation #</span>
            <p className="font-medium">{documentRecord.confirmationNumber}</p>
          </div>
        )}
        {documentRecord.date && (
          <div>
            <span className="text-xs text-slate-500">Date</span>
            <p className="font-medium">{documentRecord.date}</p>
          </div>
        )}
        {documentRecord.language && (
          <div>
            <span className="text-xs text-slate-500">Language</span>
            <p className="font-medium">
              {documentRecord.language === "he"
                ? "Hebrew"
                : documentRecord.language === "en"
                  ? "English"
                  : documentRecord.language === "ar"
                    ? "Arabic"
                    : documentRecord.language}
            </p>
          </div>
        )}
        <div>
          <span className="text-xs text-slate-500">Created</span>
          <p className="font-medium">
            {documentRecord.createdAt
              ? new Date(documentRecord.createdAt).toLocaleString()
              : "—"}
          </p>
        </div>
      </div>

      {/* Client Info */}
      {documentRecord.cname && (
        <div className="rounded-[1.2rem] border border-slate-200 p-4 dark:border-slate-700">
          <h4 className="mb-2 font-semibold text-slate-900 dark:text-slate-100">
            Client
          </h4>
          <div className="grid grid-cols-2 gap-1">
            <p>
              <span className="text-slate-500">Name: </span>
              {documentRecord.cname}
            </p>
            {documentRecord.cphone && (
              <p>
                <span className="text-slate-500">Phone: </span>
                {documentRecord.cphone}
              </p>
            )}
            {documentRecord.clientCity && (
              <p>
                <span className="text-slate-500">City: </span>
                {documentRecord.clientCity}
              </p>
            )}
            {documentRecord.clientVatNumber && (
              <p>
                <span className="text-slate-500">VAT: </span>
                {documentRecord.clientVatNumber}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Items */}
      {documentRecord.items && documentRecord.items.length > 0 && (
        <div className="rounded-[1.2rem] border border-slate-200 p-4 dark:border-slate-700">
          <h4 className="mb-2 font-semibold text-slate-900 dark:text-slate-100">
            Items
          </h4>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-xs text-slate-500">
                <th className="pb-1">Description</th>
                <th className="pb-1 text-right">Price</th>
                <th className="pb-1 text-right">Qty</th>
                <th className="pb-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {documentRecord.items.map((item, i) => (
                <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-1">{item.description}</td>
                  <td className="py-1 text-right">₪{Number(item.price).toFixed(2)}</td>
                  <td className="py-1 text-right">{item.quantity}</td>
                  <td className="py-1 text-right">
                    ₪{(Number(item.price) * Number(item.quantity)).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Totals */}
      {documentRecord.totalWithVat != null && (
        <div className="rounded-[1.2rem] bg-slate-50 p-4 dark:bg-slate-800/50">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>₪{Number(documentRecord.totalBeforeVat ?? 0).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>VAT ({VAT_RATE_PERCENT}%)</span>
            <span>₪{Number(documentRecord.vatAmount ?? 0).toFixed(2)}</span>
          </div>
          <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
            <span>Total</span>
            <span>₪{Number(documentRecord.totalWithVat).toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Payment (receipt) */}
      {documentRecord.paymentMethod && (
        <div className="rounded-[1.2rem] border border-slate-200 p-4 dark:border-slate-700">
          <h4 className="mb-1 font-semibold">Payment</h4>
          <p>
            <span className="text-slate-500">Method: </span>
            {documentRecord.paymentMethod}
          </p>
          {typeof documentRecord.paymentInfo === "string" &&
            documentRecord.paymentInfo.trim() && (
              <p>
                <span className="text-slate-500">Info: </span>
                {documentRecord.paymentInfo}
              </p>
            )}
          {documentRecord.paymentInfo &&
            typeof documentRecord.paymentInfo === "object" &&
            Object.entries(documentRecord.paymentInfo).map(([k, v]) => (
              <p key={k}>
                <span className="text-slate-500">{k}: </span>
                {String(v)}
              </p>
            ))}
        </div>
      )}

      {/* Notes */}
      {documentRecord.notes && (
        <div>
          <h4 className="mb-1 font-semibold text-slate-900 dark:text-slate-100">
            Notes
          </h4>
          <p className="text-slate-600 dark:text-slate-400">{documentRecord.notes}</p>
        </div>
      )}

      {/* PDF link */}
      {(documentRecord.storagePath || documentRecord.documentId || documentRecord.id) && (
        <button
          type="button"
          onClick={onOpenPdf}
          disabled={isOpening}
          className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
        >
          <CheckCircle2 className="h-4 w-4" />
          {isOpening ? "Opening..." : "Open PDF"}
        </button>
      )}
    </div>
  );
}
