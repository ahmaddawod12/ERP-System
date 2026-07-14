"use client";

import {
  InventoryAdjustmentRequestSchema,
  InventoryPartSummarySchema,
  InventoryPartUpdateRequestSchema,
  type InventoryPartSummary,
} from "@smart-job/api-contracts";
import { Archive, Boxes, Pencil, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { InventoryMutationFeedback } from "./inventory-mutation-feedback";
import {
  InventoryMutationError,
  inventoryMutationKey,
  inventoryPartFormErrors,
  inventoryPartFormFromSummary,
  inventoryPartUpdateRequest,
  sendInventoryMutation,
  type InventoryMutationMessage,
  type InventoryPartFormErrors,
  type InventoryPartFormField,
  type InventoryPartFormValues,
  type PendingInventoryMutation,
} from "./inventory-mutation-model";
import { InventoryPartFormFields } from "./inventory-part-form-fields";

function nullable(value: string): string | null {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

export function InventoryRowActions({
  companyId,
  part,
}: {
  companyId: number;
  part: InventoryPartSummary;
}) {
  const router = useRouter();
  const updatePending = useRef<PendingInventoryMutation | null>(null);
  const adjustmentPending = useRef<PendingInventoryMutation | null>(null);
  const archivePending = useRef<PendingInventoryMutation | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [values, setValues] = useState<InventoryPartFormValues>(() => (
    inventoryPartFormFromSummary(part)
  ));
  const [entityVersion, setEntityVersion] = useState(part.entityVersion);
  const [stockEntityVersion, setStockEntityVersion] = useState(part.stockEntityVersion);
  const [currentQuantity, setCurrentQuantity] = useState(part.quantity);
  const [quantityDelta, setQuantityDelta] = useState("");
  const [adjustmentNote, setAdjustmentNote] = useState("");
  const [errors, setErrors] = useState<InventoryPartFormErrors>({});
  const [adjustmentErrors, setAdjustmentErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<InventoryMutationMessage | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const busy = submitting || adjusting || archiving;
  const archived = part.status === "archived";

  function applyLatest(updated: InventoryPartSummary): void {
    setValues(inventoryPartFormFromSummary(updated));
    setEntityVersion(updated.entityVersion);
    setStockEntityVersion(updated.stockEntityVersion);
    setCurrentQuantity(updated.quantity);
  }

  function openEditor(): void {
    applyLatest(part);
    setQuantityDelta("");
    setAdjustmentNote("");
    setErrors({});
    setAdjustmentErrors({});
    setMessage(null);
    setConfirmingArchive(false);
    updatePending.current = null;
    adjustmentPending.current = null;
    archivePending.current = null;
    setOpen(true);
  }

  function close(): void {
    if (busy) return;
    setOpen(false);
    setConfirmingArchive(false);
  }

  function reloadLatest(): void {
    setOpen(false);
    setConfirmingArchive(false);
    router.refresh();
  }

  function change(field: InventoryPartFormField, value: string | boolean): void {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function update(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setMessage(null);
    const parsed = InventoryPartUpdateRequestSchema.safeParse(
      inventoryPartUpdateRequest(values, entityVersion),
    );
    if (!parsed.success) {
      setErrors(inventoryPartFormErrors(parsed.error.flatten().fieldErrors));
      setMessage({ kind: "error", text: "Check the inventory fields and try again." });
      return;
    }

    const fingerprint = JSON.stringify({ partId: part.partId, body: parsed.data });
    const idempotencyKey = inventoryMutationKey(updatePending, fingerprint);
    setSubmitting(true);
    try {
      const updated = await sendInventoryMutation(
        `/api/companies/${companyId}/inventory/parts/${part.partId}`,
        "PATCH",
        parsed.data,
        idempotencyKey,
        InventoryPartSummarySchema,
      );
      updatePending.current = null;
      applyLatest(updated);
      setErrors({});
      setMessage({ kind: "success", text: `Part #${updated.partNo} was updated.` });
      router.refresh();
    } catch (error) {
      const failure = error instanceof InventoryMutationError
        ? error
        : new InventoryMutationError("The inventory part could not be updated.", "UNKNOWN_ERROR");
      setErrors(inventoryPartFormErrors(failure.fieldErrors ?? {}));
      setMessage({
        kind: "error",
        text: failure.message,
        stale: failure.code === "STALE_ENTITY_VERSION",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function adjust(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setMessage(null);
    setAdjustmentErrors({});
    const parsed = InventoryAdjustmentRequestSchema.safeParse({
      stockEntityVersion,
      quantityDelta: Number(quantityDelta),
      note: nullable(adjustmentNote),
    });
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      setAdjustmentErrors({
        quantityDelta: fieldErrors.quantityDelta?.[0] ?? "Enter a non-zero quantity change.",
        note: fieldErrors.note?.[0] ?? "",
      });
      setMessage({ kind: "error", text: "Check the stock adjustment and try again." });
      return;
    }

    const fingerprint = JSON.stringify({ partId: part.partId, body: parsed.data });
    const idempotencyKey = inventoryMutationKey(adjustmentPending, fingerprint);
    setAdjusting(true);
    try {
      const updated = await sendInventoryMutation(
        `/api/companies/${companyId}/inventory/parts/${part.partId}/adjustments`,
        "POST",
        parsed.data,
        idempotencyKey,
        InventoryPartSummarySchema,
      );
      adjustmentPending.current = null;
      applyLatest(updated);
      setQuantityDelta("");
      setAdjustmentNote("");
      setMessage({
        kind: "success",
        text: `Company stock is now ${updated.quantity}${updated.unit ? ` ${updated.unit}` : ""}.`,
      });
      router.refresh();
    } catch (error) {
      const failure = error instanceof InventoryMutationError
        ? error
        : new InventoryMutationError("Company stock could not be adjusted.", "UNKNOWN_ERROR");
      const fieldErrors = failure.fieldErrors ?? {};
      setAdjustmentErrors({
        quantityDelta: fieldErrors.quantityDelta?.[0] ?? "",
        note: fieldErrors.note?.[0] ?? "",
      });
      setMessage({
        kind: "error",
        text: failure.message,
        stale: failure.code === "STALE_ENTITY_VERSION",
      });
    } finally {
      setAdjusting(false);
    }
  }

  async function archive(): Promise<void> {
    const body = { entityVersion };
    const fingerprint = JSON.stringify({ partId: part.partId, body });
    const idempotencyKey = inventoryMutationKey(archivePending, fingerprint);
    setMessage(null);
    setArchiving(true);
    try {
      const updated = await sendInventoryMutation(
        `/api/companies/${companyId}/inventory/parts/${part.partId}`,
        "DELETE",
        body,
        idempotencyKey,
        InventoryPartSummarySchema,
      );
      archivePending.current = null;
      applyLatest(updated);
      setConfirmingArchive(false);
      setMessage({ kind: "success", text: `Part #${updated.partNo} was archived.` });
      router.refresh();
    } catch (error) {
      const failure = error instanceof InventoryMutationError
        ? error
        : new InventoryMutationError("The inventory part could not be archived.", "UNKNOWN_ERROR");
      setMessage({
        kind: "error",
        text: failure.message,
        stale: failure.code === "STALE_ENTITY_VERSION",
      });
    } finally {
      setArchiving(false);
    }
  }

  return (
    <>
      <Button type="button" size="sm" variant="secondary" onClick={openEditor} className="gap-1.5">
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        Manage
      </Button>
      <Modal open={open} title={`Manage part #${part.partNo}`} onClose={close} className="max-w-2xl">
        <div aria-busy={busy} className="space-y-6">
          <form onSubmit={update} className="space-y-4">
            <div>
              <h3 className="font-semibold text-slate-950 dark:text-white">Part details</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Rename the part, change its threshold or unit, or make it inactive.
              </p>
            </div>
            <InventoryPartFormFields
              idPrefix={`inventory-part-${part.partId}`}
              values={values}
              errors={errors}
              disabled={busy || archived}
              create={false}
              onChange={change}
            />
            <div className="flex justify-end">
              <Button type="submit" disabled={busy || archived} className="gap-2">
                <Save className="h-4 w-4" aria-hidden="true" />
                {submitting ? "Saving..." : "Save details"}
              </Button>
            </div>
          </form>

          <form onSubmit={adjust} className="space-y-4 border-t border-slate-200 pt-5 dark:border-slate-800">
            <div>
              <h3 className="font-semibold text-slate-950 dark:text-white">Adjust company stock</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Current quantity: {currentQuantity}{values.unit ? ` ${values.unit}` : ""}. Use a positive value to add stock or a negative value to remove it.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                id={`inventory-part-${part.partId}-delta`}
                label="Quantity change"
                type="number"
                min="-99999999999.999"
                max="99999999999.999"
                step="0.001"
                inputMode="decimal"
                value={quantityDelta}
                onChange={(event) => {
                  setQuantityDelta(event.target.value);
                  setAdjustmentErrors((current) => ({ ...current, quantityDelta: "" }));
                }}
                error={adjustmentErrors.quantityDelta}
                disabled={busy || archived}
                required
              />
              <Input
                id={`inventory-part-${part.partId}-note`}
                label="Adjustment note"
                value={adjustmentNote}
                onChange={(event) => {
                  setAdjustmentNote(event.target.value);
                  setAdjustmentErrors((current) => ({ ...current, note: "" }));
                }}
                maxLength={500}
                error={adjustmentErrors.note}
                disabled={busy || archived}
                placeholder="Optional reason"
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" variant="secondary" disabled={busy || archived} className="gap-2">
                <Boxes className="h-4 w-4" aria-hidden="true" />
                {adjusting ? "Adjusting..." : "Apply adjustment"}
              </Button>
            </div>
          </form>

          <InventoryMutationFeedback message={message} onReload={reloadLatest} />

          {confirmingArchive ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/70 dark:bg-red-950/40">
              <p className="text-sm font-semibold text-red-800 dark:text-red-200">
                Archive {part.name}?
              </p>
              <p className="mt-1 text-sm leading-6 text-red-700 dark:text-red-300">
                The company and all member stock must be zero. Archived parts remain available in filtered history.
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => setConfirmingArchive(false)} disabled={archiving}>
                  Keep part
                </Button>
                <Button type="button" size="sm" variant="danger" onClick={() => { void archive(); }} disabled={archiving || currentQuantity !== 0} className="gap-1.5">
                  <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                  {archiving ? "Archiving..." : "Archive part"}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-5 dark:border-slate-800">
            <Button
              type="button"
              variant="danger"
              onClick={() => setConfirmingArchive(true)}
              disabled={busy || confirmingArchive || archived || currentQuantity !== 0}
              className="gap-2"
              title={currentQuantity !== 0 ? "Set all company and member stock to zero before archiving." : undefined}
            >
              <Archive className="h-4 w-4" aria-hidden="true" />
              {archived ? "Archived" : "Archive"}
            </Button>
            <Button type="button" variant="secondary" onClick={close} disabled={busy}>
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
