"use client";

import {
  ClientCreateRequestSchema,
  ClientSummarySchema,
} from "@smart-job/api-contracts";
import { Plus, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ClientFormFields } from "./client-form-fields";
import { ClientMutationFeedback } from "./client-mutation-feedback";
import {
  ClientMutationError,
  EMPTY_CLIENT_FORM,
  clientCreateRequest,
  clientFormErrors,
  clientMutationKey,
  sendClientMutation,
  type ClientFormErrors,
  type ClientFormField,
  type ClientFormValues,
  type ClientMutationMessage,
  type PendingClientMutation,
} from "./client-mutation-model";

export function ClientCreateControl({ companyId }: { companyId: number }) {
  const router = useRouter();
  const pending = useRef<PendingClientMutation | null>(null);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<ClientFormValues>(EMPTY_CLIENT_FORM);
  const [errors, setErrors] = useState<ClientFormErrors>({});
  const [message, setMessage] = useState<ClientMutationMessage | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function close(): void {
    if (submitting) return;
    setOpen(false);
    setErrors({});
  }

  function change(field: ClientFormField, value: string): void {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setMessage(null);
    const parsed = ClientCreateRequestSchema.safeParse(clientCreateRequest(values));
    if (!parsed.success) {
      setErrors(clientFormErrors(parsed.error.flatten().fieldErrors));
      setMessage({ kind: "error", text: "Check the client fields and try again." });
      return;
    }

    const fingerprint = JSON.stringify(parsed.data);
    const idempotencyKey = clientMutationKey(pending, fingerprint);
    setSubmitting(true);
    try {
      const created = await sendClientMutation(
        `/api/companies/${companyId}/clients`,
        "POST",
        parsed.data,
        idempotencyKey,
        ClientSummarySchema,
      );
      pending.current = null;
      setValues(EMPTY_CLIENT_FORM);
      setErrors({});
      setOpen(false);
      setMessage({ kind: "success", text: `Client #${created.clientNo} was created.` });
      router.refresh();
    } catch (error) {
      const failure = error instanceof ClientMutationError
        ? error
        : new ClientMutationError("The client could not be created.", "UNKNOWN_ERROR");
      setErrors(clientFormErrors(failure.fieldErrors ?? {}));
      setMessage({ kind: "error", text: failure.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-w-48 flex-col items-end gap-2">
      <Button type="button" onClick={() => { setMessage(null); setOpen(true); }} className="gap-2">
        <Plus className="h-4 w-4" aria-hidden="true" />
        New client
      </Button>
      {!open ? <ClientMutationFeedback message={message} /> : null}
      <Modal open={open} title="Add client" onClose={close} className="max-w-2xl">
        <form onSubmit={submit} aria-busy={submitting} className="space-y-5">
          <ClientFormFields
            idPrefix="create-client"
            values={values}
            errors={errors}
            disabled={submitting}
            onChange={change}
          />
          <ClientMutationFeedback message={message} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="gap-2">
              <Save className="h-4 w-4" aria-hidden="true" />
              {submitting ? "Creating..." : "Create client"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
