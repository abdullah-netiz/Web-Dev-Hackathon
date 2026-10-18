"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { api, describeError } from "@/lib/api";
import type { Appointment } from "@/lib/api/types";
import { useCan, useMe } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/controls";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/ui/misc";
import { Tag } from "@/components/ui/status";

function toLocalInput(iso: string) {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function Reschedule({ a, onDone }: { a: Appointment; onDone: () => void }) {
  const qc = useQueryClient();
  const [start, setStart] = useState(toLocalInput(a.startsAt));
  const length = new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime();
  const m = useMutation({
    mutationFn: () => {
      const s = new Date(start);
      return api().appointments.reschedule(a.id, { startsAt: s.toISOString(), endsAt: new Date(s.getTime() + length).toISOString() });
    },
    onSuccess: () => {
      toast.success("Rescheduled", { description: "The Google Calendar event moved too." });
      void qc.invalidateQueries({ queryKey: ["appointments"] });
      onDone();
    },
  });
  const err = m.error ? describeError(m.error) : null;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <Field label="New start (your time)">{(p) => <Input {...p} type="datetime-local" step={900} value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
      {err && (
        <p role="alert" className="rounded-[3px] bg-signal-tint px-3 py-2 text-sm text-signal">
          {err.title} {err.action}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={m.isPending}>
          Move appointment
        </Button>
      </div>
    </form>
  );
}

export default function AppointmentsPage() {
  const me = useMe();
  const can = useCan();
  const qc = useQueryClient();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [scope, setScope] = useState<"upcoming" | "past">("upcoming");
  const [editing, setEditing] = useState<Appointment | null>(null);
  const q = useQuery({ queryKey: ["appointments"], queryFn: () => api().appointments.list() });
  const cancel = useMutation({
    mutationFn: (id: string) => api().appointments.cancel(id),
    onSuccess: (a) => {
      toast.success(`${a.title} with ${a.contactName} cancelled`, { description: "Removed from Google Calendar and noted in the customer's history." });
      void qc.invalidateQueries({ queryKey: ["appointments"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error(describeError(e).title),
  });
  const now = Date.now();
  const rows = (q.data ?? []).filter((a) => (scope === "upcoming" ? new Date(a.endsAt).getTime() >= now : new Date(a.endsAt).getTime() < now));
  if (scope === "past") rows.reverse();
  const groups = new Map<string, Appointment[]>();
  for (const a of rows) {
    const k = new Date(a.startsAt).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  const time = (iso: string, zone: string) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: zone }).format(new Date(iso));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Appointments"
        description={`Booked on employees' Google Calendars. Times shown in your time zone (${tz.replace(/_/g, " ")}).`}
        actions={
          <Tabs value={scope} onValueChange={(v) => setScope(v as "upcoming" | "past")}>
            <TabsList aria-label="When">
              <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
              <TabsTrigger value="past">Past</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />
      {q.isPending ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing booked." body="Book from a contact or an opportunity page." />
      ) : (
        <div className="flex flex-col gap-8">
          {[...groups].map(([day, items]) => (
            <section key={day} aria-label={day}>
              <h2 className="pb-2 text-sm font-semibold text-ink-soft">{day}</h2>
              <ul className="flex flex-col gap-px bg-line">
                {items.map((a) => (
                  <li key={a.id} className={cn("grid gap-3 bg-paper py-4 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-center", a.status === "CANCELLED" && "opacity-60")}>
                    <div>
                      <p className="tabular text-lg font-semibold text-ink">{time(a.startsAt, tz)}</p>
                      {a.timeZone !== tz && <p className="text-[12px] text-ink-soft">{time(a.startsAt, a.timeZone)} {a.timeZone.split("/").pop()?.replace(/_/g, " ")}</p>}
                    </div>
                    <div className="min-w-0">
                      <p className="text-ink">
                        <span className="font-semibold">{a.title}</span> with{" "}
                        <Link href={`/contacts/${a.contactId}`} className="text-teal hover:underline">
                          {a.contactName}
                        </Link>
                      </p>
                      <p className="text-[13px] text-ink-soft">
                        {a.userName}
                        {a.userId === me.user.id && " (you)"} · Google event {a.googleEventId ? "synced" : "pending"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {a.status === "CANCELLED" ? (
                        <Tag tone="off" shape="cross">
                          Cancelled
                        </Tag>
                      ) : (
                        scope === "upcoming" &&
                        can("crm.edit") && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setEditing(a)}>
                              Reschedule
                            </Button>
                            <Button size="sm" variant="ghost" loading={cancel.isPending && cancel.variables === a.id} onClick={() => cancel.mutate(a.id)}>
                              Cancel
                            </Button>
                          </>
                        )
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent title={`Reschedule ${editing?.title ?? ""}`} description={editing ? `With ${editing.contactName} and ${editing.userName}.` : undefined}>
          {editing && <Reschedule a={editing} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
