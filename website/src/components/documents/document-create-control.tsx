"use client";

import {
  DocumentGenerateRequestSchema,
  DocumentPreviewRequestSchema,
  DocumentTaskAcceptedSchema,
  type DocumentTask,
  type DocumentTaskAccepted,
} from "@smart-job/api-contracts";
import { Eye, FilePlus2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { DOC_TYPE, DOCUMENT_TYPES } from "@/lib/document-types";
import { getNextDocumentTaskPollIntervalMs } from "@/lib/document-task-poll";
import { buildDocumentDownloadHref } from "@/lib/dal/documents-query";
import {
  clearPersistedDocumentMutation,
  DocumentMutationError,
  documentMutationKey,
  documentRequestFromComposer,
  persistDocumentMutation,
  readPersistedDocumentMutation,
  type DocumentTaskAction,
  readWebsiteDocumentTask,
  sendDocumentMutation,
  type PendingDocumentMutation,
} from "./document-mutation-model";

const NON_TAX_DOCUMENT_TYPES = DOCUMENT_TYPES.filter(
  (documentType) => documentType.code !== DOC_TYPE.TAX_INVOICE,
);
const TASK_TIMEOUT_MS = 5 * 60 * 1_000;

interface ComposerFormValues {
  documentType: number;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  clientAddress: string;
  clientCity: string;
  clientVatNumber: string;
  language: "he" | "ar" | "en";
  date: string;
  notes: string;
  items: Array<{ description: string; quantity: number; price: number }>;
}

interface ActiveTask {
  readonly type: "preview" | "generate";
  readonly accepted: DocumentTaskAccepted;
}

function defaultValues(initialDate: string): ComposerFormValues {
  return {
    documentType: DOC_TYPE.PRICE_PROPOSAL,
    clientName: "",
    clientEmail: "",
    clientPhone: "",
    clientAddress: "",
    clientCity: "",
    clientVatNumber: "",
    language: "he",
    date: initialDate,
    notes: "",
    items: [{ description: "", quantity: 1, price: 0 }],
  };
}

export function DocumentCreateControl({
  companyId,
  initialDate,
}: {
  companyId: number;
  initialDate: string;
}) {
  const router = useRouter();
  const previewPending = useRef<PendingDocumentMutation | null>(null);
  const generatePending = useRef<PendingDocumentMutation | null>(null);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState<"preview" | "generate" | null>(null);
  const [tracking, setTracking] = useState(false);
  const [active, setActive] = useState<ActiveTask | null>(null);
  const [task, setTask] = useState<DocumentTask | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const {
    control,
    getValues,
    register,
    reset,
  } = useForm<ComposerFormValues>({ defaultValues: defaultValues(initialDate) });
  const items = useFieldArray({ control, name: "items" });

  const activeTaskId = active?.accepted.taskId ?? null;
  const activeTaskType = active?.type ?? null;
  const activeDocumentId = active?.accepted.documentId ?? null;
  const busy = submitting !== null || tracking;

  const pendingRef = useCallback((action: DocumentTaskAction) => {
    return action === "preview" ? previewPending : generatePending;
  }, []);

  const clearAttempt = useCallback((action: DocumentTaskAction, expectedTaskId?: string): void => {
    const pending = pendingRef(action);
    if (expectedTaskId && pending.current?.accepted?.taskId !== expectedTaskId) return;
    pending.current = null;
    clearPersistedDocumentMutation(window.sessionStorage, companyId, action);
  }, [companyId, pendingRef]);

  useEffect(() => {
    previewPending.current = null;
    generatePending.current = null;
    setActive(null);
    setTask(null);
    setTracking(false);

    const restored = (["preview", "generate"] as const)
      .map((action) => readPersistedDocumentMutation(window.sessionStorage, companyId, action))
      .filter((record) => record !== null);
    for (const record of restored) {
      pendingRef(record.action).current = {
        fingerprint: record.fingerprint,
        key: record.idempotencyKey,
        ...(record.accepted ? { accepted: record.accepted } : {}),
      };
    }
    const latestAccepted = restored
      .filter((record) => record.accepted !== null)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    if (latestAccepted?.accepted) {
      setActive({ type: latestAccepted.action, accepted: latestAccepted.accepted });
      setTracking(true);
      setMessage({
        kind: "success",
        text: "Resuming the previously accepted document task.",
      });
    }
  }, [companyId, pendingRef]);

  useEffect(() => {
    if (!tracking || !activeTaskId || !activeTaskType) return;
    const controller = new AbortController();
    const startedAt = Date.now();
    let pollCount = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async (): Promise<void> => {
      try {
        const nextTask = await readWebsiteDocumentTask(companyId, activeTaskId, controller.signal);
        if (controller.signal.aborted) return;
        setTask(nextTask);
        if (nextTask.status === "completed") {
          setTracking(false);
          clearAttempt(activeTaskType, activeTaskId);
          if (activeTaskType === "preview" && !nextTask.previewURL) {
            setMessage({ kind: "error", text: "The preview completed without an available file." });
            return;
          }
          setMessage({
            kind: "success",
            text: activeTaskType === "preview"
              ? "The preview is ready."
              : "The document was generated successfully.",
          });
          if (activeTaskType === "generate") router.refresh();
          return;
        }
        if (nextTask.status === "failed") {
          setTracking(false);
          clearAttempt(activeTaskType, activeTaskId);
          setMessage({ kind: "error", text: nextTask.error ?? "Document processing failed." });
          return;
        }
        if (Date.now() - startedAt >= TASK_TIMEOUT_MS) {
          setTracking(false);
          setMessage({
            kind: "error",
            text: "Document processing is still pending. Select the same action to resume this task; no new task will be created.",
          });
          return;
        }
        pollCount += 1;
        timer = setTimeout(() => {
          void poll();
        }, getNextDocumentTaskPollIntervalMs(pollCount));
      } catch (error) {
        if (controller.signal.aborted) return;
        const failure = error instanceof DocumentMutationError
          ? error.message
          : "The document task could not be checked.";
        setMessage({ kind: "error", text: failure });
        setTracking(false);
      }
    };

    void poll();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [activeTaskId, activeTaskType, clearAttempt, companyId, router, tracking]);

  function close(): void {
    if (submitting) return;
    setOpen(false);
  }

  function resetComposer(): void {
    if (busy) return;
    reset(defaultValues(initialDate));
    setActive(null);
    setTask(null);
    setTracking(false);
    setMessage(null);
    clearAttempt("preview");
    clearAttempt("generate");
  }

  async function startTask(type: "preview" | "generate"): Promise<void> {
    setMessage(null);
    const candidate = documentRequestFromComposer(getValues());
    if (candidate.documentType === DOC_TYPE.TAX_INVOICE) {
      setMessage({
        kind: "error",
        text: "Tax invoice submission is unavailable pending Tax Authority certification.",
      });
      return;
    }
    const schema = type === "preview"
      ? DocumentPreviewRequestSchema
      : DocumentGenerateRequestSchema;
    const parsed = schema.safeParse(candidate);
    if (!parsed.success) {
      setMessage({
        kind: "error",
        text: parsed.error.issues[0]?.message ?? "Check the document details and try again.",
      });
      return;
    }

    const pending = pendingRef(type);
    const fingerprint = JSON.stringify({ type, body: parsed.data });
    if (pending.current && pending.current.fingerprint !== fingerprint) {
      setMessage({
        kind: "error",
        text: "Another document action is awaiting reconciliation. Resume it or use Reset to discard it before changing the request.",
      });
      return;
    }
    const idempotencyKey = documentMutationKey(pending, fingerprint);
    setSubmitting(type);
    try {
      persistDocumentMutation(window.sessionStorage, companyId, type, pending.current!);
      if (pending.current?.accepted) {
        setTask(null);
        setActive({ type, accepted: pending.current.accepted });
        setTracking(true);
        setMessage({ kind: "success", text: "Resuming the previously accepted document task." });
        return;
      }
      const accepted = await sendDocumentMutation(
        `/api/companies/${companyId}/document-tasks/${type}`,
        "POST",
        parsed.data,
        idempotencyKey,
        DocumentTaskAcceptedSchema,
      );
      pending.current = { fingerprint, key: idempotencyKey, accepted };
      persistDocumentMutation(window.sessionStorage, companyId, type, pending.current);
      setTask(null);
      setActive({ type, accepted });
      setTracking(true);
      setMessage({
        kind: "success",
        text: type === "preview"
          ? "Preview accepted; waiting for the private PDF."
          : `Document ${accepted.documentCode ?? ""} accepted; waiting for the PDF.`,
      });
    } catch (error) {
      const failure = error instanceof DocumentMutationError
        ? error
        : new DocumentMutationError("The document action failed.", "UNKNOWN_ERROR");
      setMessage({ kind: "error", text: failure.message });
    } finally {
      setSubmitting(null);
    }
  }

  function submitGenerate(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void startTask("generate");
  }

  return (
    <Card>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-slate-950 dark:text-white">Create a non-tax document</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
            Preview or generate proposals, delivery notes, returns, refunds, and receipts through the versioned API.
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Tax invoice submission is unavailable pending Tax Authority certification.
          </p>
        </div>
        <Button type="button" onClick={() => setOpen(true)} className="gap-2">
          <FilePlus2 className="h-4 w-4" aria-hidden="true" />
          New document
        </Button>
      </div>

      <Modal open={open} title="Create non-tax document" onClose={close} className="max-w-4xl">
        <form onSubmit={submitGenerate} className="max-h-[76vh] space-y-5 overflow-y-auto pr-1" aria-busy={busy}>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Document type</span>
              <select
                {...register("documentType", { valueAsNumber: true })}
                className="dashboard-field h-10"
                disabled={busy}
              >
                {NON_TAX_DOCUMENT_TYPES.map((documentType) => (
                  <option key={documentType.code} value={documentType.code}>{documentType.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Language</span>
              <select {...register("language")} className="dashboard-field h-10" disabled={busy}>
                <option value="he">Hebrew</option>
                <option value="ar">Arabic</option>
                <option value="en">English</option>
              </select>
            </label>
            <Input label="Document date" type="date" {...register("date")} disabled={busy} required />
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-950 dark:text-white">Client</h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Input label="Client name" {...register("clientName")} disabled={busy} maxLength={240} required />
              <Input label="Email" type="email" {...register("clientEmail")} disabled={busy} maxLength={320} />
              <Input label="Phone" {...register("clientPhone")} disabled={busy} maxLength={40} />
              <Input label="Address" {...register("clientAddress")} disabled={busy} maxLength={500} />
              <Input label="City" {...register("clientCity")} disabled={busy} maxLength={120} />
              <Input label="VAT number" {...register("clientVatNumber")} disabled={busy} maxLength={32} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-950 dark:text-white">Line items</h3>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => items.append({ description: "", quantity: 1, price: 0 })}
                disabled={busy || items.fields.length >= 100}
                className="gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Add item
              </Button>
            </div>
            <div className="mt-3 space-y-3">
              {items.fields.map((field, index) => (
                <div key={field.id} className="grid gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800 sm:grid-cols-[1fr_8rem_9rem_auto] sm:items-end">
                  <Input
                    label={`Description ${index + 1}`}
                    {...register(`items.${index}.description`)}
                    disabled={busy}
                    maxLength={240}
                    required
                  />
                  <Input
                    label="Quantity"
                    type="number"
                    min="0.001"
                    step="0.001"
                    {...register(`items.${index}.quantity`, { valueAsNumber: true })}
                    disabled={busy}
                    required
                  />
                  <Input
                    label="Unit price"
                    type="number"
                    min="0"
                    step="0.01"
                    {...register(`items.${index}.price`, { valueAsNumber: true })}
                    disabled={busy}
                    required
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => items.remove(index)}
                    disabled={busy || items.fields.length === 1}
                    aria-label={`Remove line item ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Notes</span>
            <textarea
              {...register("notes")}
              maxLength={4_000}
              disabled={busy}
              className="dashboard-field min-h-24 resize-y"
            />
          </label>

          <div aria-live="polite" className="min-h-5">
            {message ? (
              <div
                role={message.kind === "error" ? "alert" : "status"}
                className={message.kind === "error"
                  ? "rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300"
                  : "rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-200"}
              >
                <p>{message.text}</p>
                {task?.status === "completed" && task.previewURL ? (
                  <a href={task.previewURL} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex font-semibold underline underline-offset-4">
                    Open private preview
                  </a>
                ) : null}
                {task?.status === "completed" && activeTaskType === "generate" && activeDocumentId ? (
                  <a
                    href={buildDocumentDownloadHref(companyId, activeDocumentId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex font-semibold underline underline-offset-4"
                  >
                    Open generated PDF
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
            <Button type="button" variant="ghost" onClick={resetComposer} disabled={busy}>
              Reset
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={close} disabled={submitting !== null}>
                Close
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => { void startTask("preview"); }}
                disabled={busy}
                className="gap-2"
              >
                <Eye className="h-4 w-4" aria-hidden="true" />
                {submitting === "preview" ? "Submitting..." : "Preview"}
              </Button>
              <Button type="submit" disabled={busy} className="gap-2">
                <FilePlus2 className="h-4 w-4" aria-hidden="true" />
                {submitting === "generate" ? "Submitting..." : "Generate"}
              </Button>
            </div>
          </div>
        </form>
      </Modal>
    </Card>
  );
}
