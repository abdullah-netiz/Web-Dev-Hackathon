"use client";

import { ArrowSquareOutIcon, CopyIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { api, describeError } from "@/lib/api";
import { useCan, useMe } from "@/lib/session";
import { SettingsSection } from "@/components/app/section";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";

const ZONES = ["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "Europe/London", "Europe/Berlin", "Asia/Karachi", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney", "UTC"];

export default function WorkspaceSettings() {
  const me = useMe();
  const can = useCan();
  const qc = useQueryClient();
  const [name, setName] = useState(me.workspace.name);
  const [tz, setTz] = useState(me.workspace.timeZone);
  const [currency, setCurrency] = useState(me.workspace.currency);
  const formUrl = typeof window !== "undefined" ? `${window.location.origin}/f/${me.workspace.slug}` : `/f/${me.workspace.slug}`;
  const save = useMutation({
    mutationFn: () => api().workspace.update({ name, timeZone: tz, currency }),
    onSuccess: () => {
      toast.success("Workspace saved");
      void qc.invalidateQueries({ queryKey: ["session"] });
    },
    onError: (e) => toast.error(describeError(e).title, { description: describeError(e).action }),
  });
  const editable = can("roles.manage");
  return (
    <div className="flex flex-col gap-10">
      <SettingsSection title="Public lead form" description="Share this link or put it behind the contact button on your website. Every submission becomes a lead with an owner and a running clock.">
        <div className="flex flex-col gap-3 bg-surface p-5 sm:flex-row sm:items-center">
          <p className="tabular min-w-0 flex-1 truncate text-[15px] font-medium text-ink">{formUrl}</p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(formUrl);
                toast.success("Form link copied");
              }}
            >
              <CopyIcon size={16} aria-hidden /> Copy
            </Button>
            <Button asChild>
              <a href={`/f/${me.workspace.slug}`} target="_blank" rel="noopener">
                Open form <ArrowSquareOutIcon size={16} aria-hidden />
              </a>
            </Button>
          </div>
        </div>
      </SettingsSection>
      <SettingsSection title="Workspace" description={editable ? "Your company's name and defaults." : "Only Owners and Admins can change these."}>
        <form
          className="grid max-w-xl gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Company name">{(p) => <Input {...p} value={name} disabled={!editable} onChange={(e) => setName(e.target.value)} />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Time zone" hint="Used for 'today' on the dashboard.">
              {(p) => (
                <Select {...p} value={tz} disabled={!editable} onChange={(e) => setTz(e.target.value)}>
                  {[...new Set([tz, ...ZONES])].map((z) => (
                    <option key={z} value={z}>
                      {z.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Default currency">
              {(p) => (
                <Select {...p} value={currency} disabled={!editable} onChange={(e) => setCurrency(e.target.value)}>
                  {["USD", "EUR", "GBP", "CAD", "AUD", "PKR"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          {editable && (
            <div>
              <Button type="submit" loading={save.isPending}>
                Save workspace
              </Button>
            </div>
          )}
        </form>
      </SettingsSection>
    </div>
  );
}
