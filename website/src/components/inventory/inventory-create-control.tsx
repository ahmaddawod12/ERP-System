"use client";

import {
  InventoryPartCreateRequestSchema,
  InventoryPartSummarySchema,
} from "@smart-job/api-contracts";
import { PackagePlus, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { InventoryMutationFeedback } from "./inventory-mutation-feedback";
import {
  EMPTY_INVENTORY_PART_FORM,
  InventoryMutationError,
  inventoryMutationKey,
  inventoryPartCreateRequest,
  inventoryPartFormErrors,
  sendInventoryMutation,
  type InventoryMutationMessage,
  type InventoryPartFormErrors,
  type InventoryPartFormField,
  type InventoryPartFormValues,
  type PendingInventoryMutation,
} from "./inventory-mutation-model";
import { InventoryPartFormFields } from "./inventory-part-form-fields";

export function InventoryCreateControl({ companyId }: { companyId: number }) {
  const router = useRouter();
  const pending = useRef<PendingInventoryMutation | null>(null);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<InventoryPartFormValues>(EMPTY_INVENTORY_PART_FORM);
  const [errors, setErrors] = useState<InventoryPartFormErrors>({});
  const [message, setMessage] = useState<InventoryMutationMessage | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function close(): void {
    if (submitting) return;
    setOpen(false);
    setErrors({});
  }

  function change(field: InventoryPartFormField, value: string | boolean): void {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setMessage(null);
    const parsed = InventoryPartCreateRequestSchema.safeParse(
      inventoryPartCreateRequest(values),
    );
    if (!parsed.success) {
      setErrors(inventoryPartFormErrors(parsed.error.flatten().fieldErrors));
      setMessage({ kind: "error", text: "Check the inventory fields and try again." });
      return;
    }

    const fingerprint = JSON.stringify(parsed.data);
    const idempotencyKey = inventoryMutationKey(pending, fingerprint);
    setSubmitting(true);
    try {
      const created = await sendInventoryMutation(
        `/api/companies/${companyId}/inventory/parts`,
        "POST",
        parsed.data,
        idempotencyKey,
        InventoryPartSummarySchema,
      );
      pending.current = null;
      setValues(EMPTY_INVENTORY_PART_FORM);
      setErrors({});
      setOpen(false);
      setMessage({ kind: "success", text: `Part #${created.partNo} was created.` });
      router.refresh();
    } catch (error) {
      const failure = error instanceof InventoryMutationError
        ? error
        : new InventoryMutationError("The inventory part could not be created.", "UNKNOWN_ERROR");
      setErrors(inventoryPartFormErrors(failure.fieldErrors ?? {}));
      setMessage({ kind: "error", text: failure.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-w-48 flex-col items-end gap-2">
      <Button
        type="button"
        onClick={() => { setMessage(null); setOpen(true); }}
        className="gap-2"
      >
        <PackagePlus className="h-4 w-4" aria-hidden="true" />
        New part
      </Button>
      {!open ? <InventoryMutationFeedback message={message} /> : null}
      <Modal open={open} title="Add inventory part" onClose={close} className="max-w-2xl">
        <form onSubmit={submit} aria-busy={submitting} className="space-y-5">
          <InventoryPartFormFields
            idPrefix="create-inventory-part"
            values={values}
            errors={errors}
            disabled={submitting}
            create
            onChange={change}
          />
          <InventoryMutationFeedback message={message} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="gap-2">
              <Save className="h-4 w-4" aria-hidden="true" />
              {submitting ? "Creating..." : "Create part"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
