"use client";

import type { CustomField, CustomValues } from "@/lib/api/types";
import { formatDate } from "@/lib/utils";
import { Switch } from "@/components/ui/controls";
import { Field, Input, Select } from "@/components/ui/field";

export function CustomFieldInput({
  field,
  value,
  onChange,
  error,
  required,
}: {
  field: CustomField;
  value: CustomValues[string] | undefined;
  onChange: (v: CustomValues[string]) => void;
  error?: string;
  required?: boolean;
}) {
  if (field.type === "BOOLEAN") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-[3px] bg-surface px-3 py-2.5">
        <span className="text-[13px] font-medium text-ink" id={`lbl-${field.id}`}>
          {field.label}
        </span>
        <Switch aria-labelledby={`lbl-${field.id}`} checked={value === true} onCheckedChange={(c) => onChange(c)} />
      </div>
    );
  }
  return (
    <Field label={field.label} error={error} required={required}>
      {(p) =>
        field.type === "SELECT" ? (
          <Select {...p} value={value == null ? "" : String(value)} onChange={(e) => onChange(e.target.value || null)}>
            <option value="">Not set</option>
            {field.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            {...p}
            type={field.type === "NUMBER" ? "number" : field.type === "DATE" ? "date" : "text"}
            inputMode={field.type === "NUMBER" ? "decimal" : undefined}
            value={value == null ? "" : String(value)}
            onChange={(e) => {
              const raw = e.target.value;
              onChange(raw === "" ? null : field.type === "NUMBER" ? Number(raw) : raw);
            }}
          />
        )
      }
    </Field>
  );
}

export function formatCustom(field: CustomField, v: CustomValues[string] | undefined) {
  if (v == null || v === "") return null;
  if (field.type === "BOOLEAN") return v ? "Yes" : "No";
  if (field.type === "DATE") return formatDate(String(v));
  if (field.type === "NUMBER") return new Intl.NumberFormat().format(Number(v));
  return String(v);
}

export function CustomFieldList({ fields, values }: { fields: CustomField[]; values: CustomValues }) {
  if (!fields.length) return null;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {fields.map((f) => {
        const shown = formatCustom(f, values[f.key]);
        return (
          <div key={f.id}>
            <dt className="text-[13px] text-ink-soft">{f.label}</dt>
            <dd className={shown ? "text-sm text-ink" : "text-sm text-ink-faint"}>{shown ?? "Not set"}</dd>
          </div>
        );
      })}
    </dl>
  );
}
