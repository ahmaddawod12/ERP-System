"use client";

import { Input } from "@/components/ui/Input";
import type {
  InventoryPartFormErrors,
  InventoryPartFormField,
  InventoryPartFormValues,
} from "./inventory-mutation-model";

export function InventoryPartFormFields({
  idPrefix,
  values,
  errors,
  disabled,
  create,
  onChange,
}: {
  idPrefix: string;
  values: InventoryPartFormValues;
  errors: InventoryPartFormErrors;
  disabled: boolean;
  create: boolean;
  onChange: (field: InventoryPartFormField, value: string | boolean) => void;
}) {
  return (
    <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
      <Input
        id={`${idPrefix}-name`}
        label="Part name"
        value={values.name}
        onChange={(event) => onChange("name", event.target.value)}
        maxLength={240}
        error={errors.name}
        required
      />
      <Input
        id={`${idPrefix}-unit`}
        label="Unit"
        value={values.unit}
        onChange={(event) => onChange("unit", event.target.value)}
        maxLength={40}
        placeholder="piece, meter, liter..."
        error={errors.unit}
      />
      {create ? (
        <Input
          id={`${idPrefix}-quantity`}
          label="Initial company quantity"
          type="number"
          min="0"
          max="99999999999.999"
          step="0.001"
          inputMode="decimal"
          value={values.quantity}
          onChange={(event) => onChange("quantity", event.target.value)}
          error={errors.quantity}
          required
        />
      ) : null}
      <Input
        id={`${idPrefix}-low-threshold`}
        label="Low-stock threshold"
        type="number"
        min="0"
        max="99999999999.999"
        step="0.001"
        inputMode="decimal"
        value={values.lowThreshold}
        onChange={(event) => onChange("lowThreshold", event.target.value)}
        error={errors.lowThreshold}
        required
      />
      {!create ? (
        <label className="flex items-center gap-3 rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700">
          <input
            type="checkbox"
            checked={values.active}
            onChange={(event) => onChange("active", event.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          <span>
            <span className="block text-sm font-medium text-slate-700 dark:text-slate-200">Active part</span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">Inactive parts stay visible in filtered history.</span>
          </span>
        </label>
      ) : null}
    </fieldset>
  );
}
