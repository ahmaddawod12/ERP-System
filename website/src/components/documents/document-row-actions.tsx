"use client";

import {
  DocumentDeleteRequestSchema,
  DocumentDeleteResultSchema,
  type DocumentSummary,
} from "@smart-job/api-contracts";
import { RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { DOC_TYPE } from "@/lib/document-types";
import {
  DocumentMutationError,
  documentMutationKey,
  sendDocumentMutation,
  type PendingDocumentMutation,
} from "./document-mutation-model";

function deletionBlockedReason(document: DocumentSummary): string | null {
  if (document.documentType === DOC_TYPE.TAX_INVOICE) {
    return "Tax documents remain under the dedicated tax-authority workflow.";
  }
  if (document.hasFile) {
    return "Generated PDF files require the protected cleanup workflow.";
  }
  if (["pending", "queued", "processing"].includes(document.generationStatus)) {
    return "Wait for active document processing to finish before deleting.";
  }
  return null;
}

export function DocumentRowActions({
  companyId,
  document,
}: {
  companyId: number;
  document: DocumentSummary;
}) {
  const router = useRouter();
  const pending = useRef<PendingDocumentMutation | null>(null);
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [message, setMessage] = useState<{
    kind: "error" | "success";
    text: string;
    stale: boolean;
  } | null>(null);
  const blockedReason = deletionBlockedReason(document);

  function close(): void {
    if (!removing) setOpen(false);
  }

  function reload(): void {
    setOpen(false);
    router.refresh();
  }

  async function remove(): Promise<void> {
    const body = DocumentDeleteRequestSchema.parse({ entityVersion: document.entityVersion });
    const fingerprint = JSON.stringify({ documentId: document.documentId, body });
    const idempotencyKey = documentMutationKey(pending, fingerprint);
    setMessage(null);
    setRemoving(true);
    try {
      const removed = await sendDocumentMutation(
        `/api/companies/${companyId}/documents/${document.documentId}`,
        "DELETE",
        body,
        idempotencyKey,
        DocumentDeleteResultSchema,
      );
      pending.current = null;
      setMessage({ kind: "success", text: `${removed.documentCode} was deleted.`, stale: false });
      router.refresh();
    } catch (error) {
      const failure = error instanceof DocumentMutationError
        ? error
        : new DocumentMutationError("The document could not be deleted.", "UNKNOWN_ERROR");
      setMessage({
        kind: "error",
        text: failure.message,
        stale: failure.code === "STALE_ENTITY_VERSION",
      });
    } finally {
      setRemoving(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="danger"
        onClick={() => setOpen(true)}
        disabled={blockedReason !== null}
        title={blockedReason ?? undefined}
        className="gap-1.5"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        Delete
      </Button>
      <Modal open={open} title={`Delete ${document.documentCode}?`} onClose={close}>
        <div className="space-y-4">
          <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
            This permanently deletes the ungenerated document record. Generated files and tax documents cannot use this action.
          </p>
          <div aria-live="polite" className="min-h-5">
            {message ? (
              <div role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error"
                ? "rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300"
                : "rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-200"}
              >
                <p>{message.text}</p>
                {message.stale ? (
                  <button type="button" onClick={reload} className="mt-2 inline-flex items-center gap-1.5 font-semibold underline underline-offset-4">
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    Reload latest document
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close} disabled={removing}>
              Keep document
            </Button>
            <Button type="button" variant="danger" onClick={() => { void remove(); }} disabled={removing} className="gap-2">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {removing ? "Deleting..." : "Delete permanently"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
