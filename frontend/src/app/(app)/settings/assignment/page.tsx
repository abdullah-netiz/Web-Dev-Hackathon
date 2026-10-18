"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, describeError } from "@/lib/api";
import type { WorkspaceSettings } from "@/lib/api/types";
import { formatDuration } from "@/lib/utils";
import { SettingsSection } from "@/components/app/section";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/misc";

const LEVELS = ["Next available teammate", "Their designated backup", "A manager", "A manager"];

export default function AssignmentPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["settings"], queryFn: () => api().workspace.settings() });
  const [v, setV] = useState<WorkspaceSettings | null>(null);
  useEffect(() => {
    if (q.data) setV(q.data);
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api().workspace.updateSettings(v!),
    onSuccess: () => {
      toast.success("Assignment rules saved", { description: "New assignments use them straight away." });
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => toast.error(describeError(e).title, { description: describeError(e).action }),
  });
  if (!v) return <Skeleton className="h-96" />;
  const num = (k: keyof WorkspaceSettings) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value === "" ? 0 : Number(e.target.value) });
  const bad = (n: number) => !Number.isFinite(n) || n < 1;
  const dirty = JSON.stringify(v) !== JSON.stringify(q.data);
  const steps = [{ who: "First owner, by round-robin", sec: v.ackWindowSec }, ...LEVELS.slice(0, v.escalationLevels).map((who) => ({ who, sec: v.levelWindowSec }))];
  const total = steps.reduce((s, x) => s + x.sec, 0);

  return (
    <form
      className="flex flex-col gap-10"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <SettingsSection title="Who gets a new lead" description="Round-robin among people who are Available and below their open-lead limit. Busy, On leave and Offline people never receive leads.">
        <div className="grid max-w-xl gap-4 sm:grid-cols-2">
          <Field label="Max open leads per person" hint="People can have their own limit in Members." error={bad(v.maxOpenLeadsDefault) ? "Use 1 or more." : undefined}>
            {(p) => <Input {...p} type="number" min={1} value={v.maxOpenLeadsDefault || ""} onChange={num("maxOpenLeadsDefault")} />}
          </Field>
        </div>
      </SettingsSection>

      <SettingsSection title="The response clock and escalation" description="Times are in seconds so you can watch a full escalation during a demo. Acknowledging, or any recorded action (a note, a message, a stage change, an appointment), stops the clock.">
        <div className="grid max-w-2xl gap-4 sm:grid-cols-3">
          <Field label="First window (seconds)" hint={formatDuration(v.ackWindowSec)} error={bad(v.ackWindowSec) ? "Use 1 or more." : undefined}>
            {(p) => <Input {...p} type="number" min={1} value={v.ackWindowSec || ""} onChange={num("ackWindowSec")} />}
          </Field>
          <Field label="Escalation levels">
            {(p) => (
              <Select {...p} value={v.escalationLevels} onChange={(e) => setV({ ...v, escalationLevels: Number(e.target.value) })}>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Window per level (seconds)" hint={formatDuration(v.levelWindowSec)} error={bad(v.levelWindowSec) ? "Use 1 or more." : undefined}>
            {(p) => <Input {...p} type="number" min={1} value={v.levelWindowSec || ""} onChange={num("levelWindowSec")} />}
          </Field>
        </div>

        <figure className="mt-8" aria-label="Escalation chain preview">
          <div className="flex h-16 w-full gap-[3px]">
            {steps.map((s, i) => (
              <motion.div
                key={i}
                layout
                className={i === 0 ? "bg-teal text-on-teal" : i === steps.length - 1 && i > 0 ? "bg-ink text-paper" : "bg-[#2f737d] text-white"}
                style={{ flexGrow: Math.max(s.sec, total * 0.08), flexBasis: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 34 }}
              >
                <span className="block p-2 text-[13px] font-semibold">{formatDuration(s.sec)}</span>
              </motion.div>
            ))}
          </div>
          <ol className="mt-3 flex w-full gap-[3px]">
            {steps.map((s, i) => (
              <li key={i} className="min-w-0 text-[12.5px] text-ink" style={{ flexGrow: Math.max(s.sec, total * 0.08), flexBasis: 0 }}>
                <span className="block truncate">{s.who}</span>
              </li>
            ))}
          </ol>
          <figcaption className="mt-4 text-sm text-ink-soft">
            If nobody responds, a lead reaches the last level after <span className="font-semibold text-ink">{formatDuration(total)}</span>. Each hand-off alerts the new owner in Telegram.
            After the last level it stays with the manager and enters the recovery queue.
          </figcaption>
        </figure>
      </SettingsSection>

      <SettingsSection title="Recovery and absence">
        <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <Field label="Idle after (seconds)" hint={`An acknowledged lead with no action for ${formatDuration(v.idleSec)} enters the recovery queue.`} error={bad(v.idleSec) ? "Use 1 or more." : undefined}>
            {(p) => <Input {...p} type="number" min={1} value={v.idleSec || ""} onChange={num("idleSec")} />}
          </Field>
          <Field label="Acknowledged leads when someone goes on leave" hint="Unacknowledged leads always move immediately. This rule is shown to everyone on the Availability page.">
            {(p) => (
              <Select {...p} value={v.acknowledgedOnAbsence} onChange={(e) => setV({ ...v, acknowledgedOnAbsence: e.target.value as WorkspaceSettings["acknowledgedOnAbsence"] })}>
                <option value="KEEP">Stay with them</option>
                <option value="REASSIGN">Move to someone available</option>
              </Select>
            )}
          </Field>
        </div>
      </SettingsSection>

      <div className="sticky bottom-4 flex items-center justify-end gap-3">
        {dirty && <span className="text-sm text-ink-soft">Unsaved changes</span>}
        <Button type="button" variant="ghost" disabled={!dirty} onClick={() => setV(q.data!)}>
          Discard
        </Button>
        <Button type="submit" loading={save.isPending} disabled={!dirty || [v.ackWindowSec, v.levelWindowSec, v.idleSec, v.maxOpenLeadsDefault].some(bad)}>
          Save rules
        </Button>
      </div>
    </form>
  );
}
