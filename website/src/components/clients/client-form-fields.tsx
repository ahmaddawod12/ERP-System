"use client";

import { Input } from "@/components/ui/Input";
import type {
  ClientFormErrors,
  ClientFormField,
  ClientFormValues,
} from "./client-mutation-model";

export function ClientFormFields({
  idPrefix,
  values,
  errors,
  disabled,
  onChange,
}: {
  idPrefix: string;
  values: ClientFormValues;
  errors: ClientFormErrors;
  disabled: boolean;
  onChange: (field: ClientFormField, value: string) => void;
}) {
  return (
    <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
      <Input
        id={`${idPrefix}-name`}
        label="Client name"
        value={values.name}
        onChange={(event) => onChange("name", event.target.value)}
        maxLength={240}
        autoComplete="organization"
        error={errors.name}
        required
      />
      <Input
        id={`${idPrefix}-phone`}
        label="Phone"
        type="tel"
        value={values.phone}
        onChange={(event) => onChange("phone", event.target.value)}
        maxLength={40}
        autoComplete="tel"
        error={errors.phone}
      />
      <Input
        id={`${idPrefix}-email`}
        label="Email"
        type="email"
        value={values.email}
        onChange={(event) => onChange("email", event.target.value)}
        maxLength={320}
        autoComplete="email"
        error={errors.email}
      />
      <Input
        id={`${idPrefix}-vat-number`}
        label="VAT number"
        value={values.vatNumber}
        onChange={(event) => onChange("vatNumber", event.target.value)}
        maxLength={32}
        error={errors.vatNumber}
      />
      <Input
        id={`${idPrefix}-address`}
        label="Address"
        value={values.address}
        onChange={(event) => onChange("address", event.target.value)}
        maxLength={500}
        autoComplete="street-address"
        error={errors.address}
      />
      <Input
        id={`${idPrefix}-city`}
        label="City"
        value={values.city}
        onChange={(event) => onChange("city", event.target.value)}
        maxLength={120}
        autoComplete="address-level2"
        error={errors.city}
      />
      <label className="flex flex-col gap-1.5 sm:col-span-2" htmlFor={`${idPrefix}-notes`}>
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Notes</span>
        <textarea
          id={`${idPrefix}-notes`}
          value={values.notes}
          onChange={(event) => onChange("notes", event.target.value)}
          maxLength={2_000}
          rows={4}
          className="min-h-24 resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          aria-invalid={Boolean(errors.notes)}
          aria-describedby={errors.notes ? `${idPrefix}-notes-error` : undefined}
        />
        {errors.notes ? (
          <span id={`${idPrefix}-notes-error`} className="text-xs text-red-600">
            {errors.notes}
          </span>
        ) : null}
      </label>
    </fieldset>
  );
}
