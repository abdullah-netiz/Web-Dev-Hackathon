"use client";

import { PlusIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { api, describeError } from "@/lib/api";
import type { CustomField, CustomFieldEntity, CustomFieldType } from "@/lib/api/types";
import { SettingsSection } from "@/components/app/section";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ListSkeleton } from "@/components/ui/misc";
import { Tag } from "@/components/ui/status";

const TYPES: Record<CustomFieldType, string> = { TEXT: "Text", NUMBER: "Number", DATE: "Date", SELECT: "Dropdown", BOOLEAN: "Checkbox" };
const ENTITY: Record<CustomFieldEntity, string> = { contact: "Contacts", opportunity: "Opportunities", company: "Companies" };

export default function FieldsPage() {
  const qc = useQueryClient();
  const fields = useQuery({ queryKey: ["fields", "all"], queryFn: () => api().fields.list() });
  const pipelines = useQuery({ queryKey: ["pipelines"], queryFn: () => api().pipelines.list() });
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ entity: "opportunity" as CustomFieldEntity, label: "", type: "TEXT" as CustomFieldType, options: "", pipelineId: "" });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["fields"] });
  const create = useMutation({
    mutationFn: () =>
      api().fields.create({ entity: v.entity, label: v.label, type: v.type, options: v.type === "SELECT" ? v.options.split("\n") : [], pipelineId: v.entity === "opportunity" ? v.pipelineId || null : null }),
    onSuccess: (f) => {
      toast.success(`"${f.label}" added`, { description: "It's on the forms and record pages now." });
      invalidate();
      setOpen(false);
      setV({ ...v, label: "", options: "" });
    },
  });
  const archive = useMutation({
    mutationFn: (f: CustomField) => api().fields.archive(f.id),
    onSuccess: () => (toast.success("Field removed", { description: "Existing values are kept in history." }), invalidate()),
    onError: (e) => toast.error(describeError(e).title, { description: describeError(e).action }),
  });
  const err = create.error ? describeError(create.error) : null;
  const pipeName = (id: string | null) => (id ? (pipelines.data?.find((p) => p.id === id)?.name ?? "") : null);

  return (
    <SettingsSection
      title="Custom fields"
      description="Add the fields your team actually uses. They appear on forms and record pages immediately. Opportunity fields can belong to one pipeline."
      aside={
        <Button onClick={() => setOpen(true)}>
          <PlusIcon size={16} aria-hidden /> New field
        </Button>
      }
    >
      {fields.isPending ? (
        <ListSkeleton />
      ) : (
        <div className="flex flex-col gap-8">
          {(Object.keys(ENTITY) as CustomFieldEntity[]).map((e) => {
            const rows = (fields.data ?? []).filter((f) => f.entity === e);
            return (
              <div key={e}>
                <h3 className="pb-2 text-sm font-semibold text-ink">{ENTITY[e]}</h3>
                {rows.length ? (
                  <ul className="flex flex-col gap-px bg-line">
                    {rows.map((f) => (
                      <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 bg-paper py-3">
                        <span className="min-w-0">
                          <span className="block font-medium text-ink">{f.label}</span>
                          <span className="block text-[13px] text-ink-soft">
                            {TYPES[f.type]}
                            {f.options.length > 0 && `: ${f.options.join(", ")}`}
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          {pipeName(f.pipelineId) ? <Tag tone="teal">{pipeName(f.pipelineId)} only</Tag> : e === "opportunity" && <Tag>All pipelines</Tag>}
                          <Button size="sm" variant="ghost" loading={archive.isPending && archive.variables?.id === f.id} onClick={() => archive.mutate(f)}>
                            Remove
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-soft">No custom fields yet.</p>
                )}
              </div>
            );
          })}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="New custom field" description="No code needed. You can rename it later; removing it keeps past values in history.">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="On">
                {(p) => (
                  <Select {...p} value={v.entity} onChange={(e) => setV({ ...v, entity: e.target.value as CustomFieldEntity })}>
                    {(Object.keys(ENTITY) as CustomFieldEntity[]).map((k) => (
                      <option key={k} value={k}>
                        {ENTITY[k]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Type">
                {(p) => (
                  <Select {...p} value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as CustomFieldType })}>
                    {(Object.keys(TYPES) as CustomFieldType[]).map((k) => (
                      <option key={k} value={k}>
                        {TYPES[k]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <Field label="Name" required>{(p) => <Input {...p} value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} placeholder="Roof age (years)" autoFocus />}</Field>
            {v.type === "SELECT" && (
              <Field label="Options" hint="One per line." required>
                {(p) => <Textarea {...p} rows={4} value={v.options} onChange={(e) => setV({ ...v, options: e.target.value })} />}
              </Field>
            )}
            {v.entity === "opportunity" && (
              <Field label="Pipeline" hint="Show this field only on deals in one pipeline.">
                {(p) => (
                  <Select {...p} value={v.pipelineId} onChange={(e) => setV({ ...v, pipelineId: e.target.value })}>
                    <option value="">All pipelines</option>
                    {pipelines.data?.map((pl) => (
                      <option key={pl.id} value={pl.id}>
                        {pl.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            {err && (
              <p role="alert" className="rounded-[3px] bg-signal-tint px-3 py-2 text-sm text-signal">
                {err.title} {err.action}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={create.isPending} disabled={!v.label.trim()}>
                Add field
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
