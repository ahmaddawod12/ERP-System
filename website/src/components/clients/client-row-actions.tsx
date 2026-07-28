"use client";

import {
  ClientDeleteResultSchema,
  ClientSummarySchema,
  ClientUpdateRequestSchema,
  type ClientSummary,
} from "@smart-job/api-contracts";
import { Pencil, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ClientFormFields } from "./client-form-fields";
import { ClientMutationFeedback } from "./client-mutation-feedback";
import {
  ClientMutationError,
  clientFormErrors,
  clientFormFromSummary,
  clientMutationKey,
  clientUpdateRequest,
  sendClientMutation,
  type ClientFormErrors,
  type ClientFormField,
  type ClientFormValues,
  type ClientMutationMessage,
  type PendingClientMutation,
} from "./client-mutation-model";

export function ClientRowActions({
  companyId,
  client,
}: {
  companyId: number;
  client: ClientSummary;
}) {
  const router = useRouter();
  const updatePending = useRef<PendingClientMutation | null>(null);
  const removePending = useRef<PendingClientMutation | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [values, setValues] = useState<ClientFormValues>(() => clientFormFromSummary(client));
  const [entityVersion, setEntityVersion] = useState(client.entityVersion);
  const [errors, setErrors] = useState<ClientFormErrors>({});
  const [message, setMessage] = useState<ClientMutationMessage | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [removing, setRemoving] = useState(false);

  function openEditor(): void {
    setValues(clientFormFromSummary(client));
    setEntityVersion(client.entityVersion);
    setErrors({});
    setMessage(null);
    setConfirmingRemoval(false);
    updatePending.current = null;
    removePending.current = null;
    setOpen(true);
  }

  function close(): void {
    if (submitting || removing) return;
    setOpen(false);
    setConfirmingRemoval(false);
  }

  function change(field: ClientFormField, value: string): void {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function reloadLatest(): void {
    setOpen(false);
    setConfirmingRemoval(false);
    router.refresh();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setMessage(null);
    const parsed = ClientUpdateRequestSchema.safeParse(
      clientUpdateRequest(values, entityVersion),
    );
    if (!parsed.success) {
      setErrors(clientFormErrors(parsed.error.flatten().fieldErrors));
      setMessage({ kind: "error", text: "Check the client fields and try again." });
      return;
    }

    const fingerprint = JSON.stringify({ clientId: client.clientId, body: parsed.data });
    const idempotencyKey = clientMutationKey(updatePending, fingerprint);
    setSubmitting(true);
    try {
      const updated = await sendClientMutation(
        `/api/companies/${companyId}/clients/${client.clientId}`,
        "PATCH",
        parsed.data,
        idempotencyKey,
        ClientSummarySchema,
      );
      updatePending.current = null;
      removePending.current = null;
      setValues(clientFormFromSummary(updated));
      setEntityVersion(updated.entityVersion);
      setErrors({});
      setMessage({ kind: "success", text: `Client #${updated.clientNo} was updated.` });
      router.refresh();
    } catch (error) {
      const failure = error instanceof ClientMutationError
        ? error
        : new ClientMutationError("The client could not be updated.", "UNKNOWN_ERROR");
      setErrors(clientFormErrors(failure.fieldErrors ?? {}));
      setMessage({
        kind: "error",
        text: failure.message,
        stale: failure.code === "STALE_ENTITY_VERSION",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(): Promise<void> {
    const body = { entityVersion };
    const fingerprint = JSON.stringify({ clientId: client.clientId, body });
    const idempotencyKey = clientMutationKey(removePending, fingerprint);
    setMessage(null);
    setRemoving(true);
    try {
      const removed = await sendClientMutation(
        `/api/companies/${companyId}/clients/${client.clientId}`,
        "DELETE",
        body,
        idempotencyKey,
        ClientDeleteResultSchema,
      );
      removePending.current = null;
      setConfirmingRemoval(false);
      setMessage({
        kind: "success",
        text: removed.disposition === "archived"
          ? `Client #${removed.clientNo} was archived because it has business history.`
          : `Client #${removed.clientNo} was deleted.`,
      });
      router.refresh();
    } catch (error) {
      const failure = error instanceof ClientMutationError
        ? error
        : new ClientMutationError("The client could not be removed.", "UNKNOWN_ERROR");
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
      <Button type="button" size="sm" variant="secondary" onClick={openEditor} className="gap-1.5">
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        Edit
      </Button>
      <Modal open={open} title={`Edit client #${client.clientNo}`} onClose={close} className="max-w-2xl">
        <form onSubmit={submit} aria-busy={submitting || removing} className="space-y-5">
          <ClientFormFields
            idPrefix={`client-${client.clientId}`}
            values={values}
            errors={errors}
            disabled={submitting || removing}
            onChange={change}
          />
          <ClientMutationFeedback message={message} onReload={reloadLatest} />
          {confirmingRemoval ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/70 dark:bg-red-950/40">
              <p className="text-sm font-semibold text-red-800 dark:text-red-200">
                Remove {client.name}?
              </p>
              <p className="mt-1 text-sm leading-6 text-red-700 dark:text-red-300">
                An unreferenced client is deleted. A client used by jobs or documents is safely archived instead.
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setConfirmingRemoval(false)}
                  disabled={removing}
                >
                  Keep client
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  onClick={() => { void remove(); }}
                  disabled={removing}
                  className="gap-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {removing ? "Removing..." : "Remove client"}
                </Button>
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="danger"
              onClick={() => setConfirmingRemoval(true)}
              disabled={submitting || removing || confirmingRemoval}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Remove
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={close} disabled={submitting || removing}>
                Close
              </Button>
              <Button type="submit" disabled={submitting || removing} className="gap-2">
                <Save className="h-4 w-4" aria-hidden="true" />
                {submitting ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </div>
        </form>
      </Modal>
    </>
  );
}
