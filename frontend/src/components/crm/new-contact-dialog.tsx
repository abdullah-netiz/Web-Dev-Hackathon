"use client";

import { PlusIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api, describeError } from "@/lib/api";
import type { CustomValues } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { CustomFieldInput } from "./custom-field";

export function NewContactDialog() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const qc = useQueryClient();
  const fields = useQuery({ queryKey: ["fields", "contact"], queryFn: () => api().fields.list("contact"), enabled: open });
  const companies = useQuery({ queryKey: ["companies", "all"], queryFn: () => api().companies.list({ pageSize: 100 }), enabled: open });
  const [v, setV] = useState({ firstName: "", lastName: "", email: "", phone: "", companyId: "" });
  const [custom, setCustom] = useState<CustomValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => api().contacts.create({ ...v, companyId: v.companyId || null, custom }),
    onSuccess: (c) => {
      toast.success(`${c.firstName} ${c.lastName} added`);
      void qc.invalidateQueries({ queryKey: ["contacts"] });
      setOpen(false);
      router.push(`/contacts/${c.id}`);
    },
  });
  const err = m.error ? describeError(m.error) : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!v.firstName.trim()) next.firstName = "Enter a first name.";
    if (v.email && !/^\S+@\S+\.\S+$/.test(v.email)) next.email = "Enter a valid email.";
    if (v.phone && !/^\+?[\d\s()-]{7,20}$/.test(v.phone)) next.phone = "Use an international number, e.g. +1 415 555 0134.";
    setErrors(next);
    if (!Object.keys(next).length) m.mutate();
  }
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon size={16} weight="bold" aria-hidden /> New contact
        </Button>
      </DialogTrigger>
      <DialogContent title="New contact" description="Custom fields your Admin added appear here automatically.">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" error={errors.firstName} required>
              {(p) => <Input {...p} value={v.firstName} onChange={set("firstName")} />}
            </Field>
            <Field label="Last name">{(p) => <Input {...p} value={v.lastName} onChange={set("lastName")} />}</Field>
            <Field label="Email" error={errors.email}>
              {(p) => <Input {...p} type="email" value={v.email} onChange={set("email")} />}
            </Field>
            <Field label="Phone" error={errors.phone}>
              {(p) => <Input {...p} type="tel" value={v.phone} onChange={set("phone")} />}
            </Field>
          </div>
          <Field label="Company">
            {(p) => (
              <Select {...p} value={v.companyId} onChange={set("companyId")}>
                <option value="">No company</option>
                {companies.data?.data.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {fields.data?.map((f) => (
            <CustomFieldInput key={f.id} field={f} value={custom[f.key]} onChange={(val) => setCustom((c) => ({ ...c, [f.key]: val }))} />
          ))}
          {err && (
            <p role="alert" className="rounded-[3px] bg-signal-tint px-3 py-2 text-sm text-signal">
              {err.title} {err.action}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={m.isPending}>
              Add contact
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
