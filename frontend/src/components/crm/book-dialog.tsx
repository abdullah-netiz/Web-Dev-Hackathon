"use client";

import { CalendarPlusIcon, WarningIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { api, describeError } from "@/lib/api";
import { useMe } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

const DAY_START = 8;
const DAY_END = 19;

function localDate(d = new Date()) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

export function BookDialog({ contactId, contactName, opportunityId }: { contactId: string; contactName: string; opportunityId?: string }) {
  const me = useMe();
  const qc = useQueryClient();
  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState(me.user.id);
  const [date, setDate] = useState(localDate(new Date(Date.now() + 86_400_000)));
  const [time, setTime] = useState("10:00");
  const [minutes, setMinutes] = useState(45);
  const [title, setTitle] = useState("Site survey");
  const [notes, setNotes] = useState("");

  const members = useQuery({ queryKey: ["members"], queryFn: () => api().members.list(), enabled: open });
  const member = members.data?.find((u) => u.id === userId);
  const dayFrom = new Date(`${date}T00:00:00`).toISOString();
  const dayTo = new Date(`${date}T23:59:59`).toISOString();
  const busy = useQuery({
    queryKey: ["busy", userId, date],
    queryFn: () => api().appointments.busy(userId, dayFrom, dayTo),
    enabled: open && member?.calendarStatus === "CONNECTED",
    retry: false,
  });
  const start = new Date(`${date}T${time}:00`);
  const end = new Date(start.getTime() + minutes * 60_000);
  const clash = useMemo(
    () => (busy.data ?? []).filter((b) => new Date(b.start) < end && new Date(b.end) > start),
    [busy.data, start, end],
  );
  const inPast = start.getTime() < Date.now();

  const book = useMutation({
    mutationFn: () =>
      api().appointments.book({ title, contactId, opportunityId: opportunityId ?? null, userId, startsAt: start.toISOString(), endsAt: end.toISOString(), timeZone: viewerTz, notes: notes || undefined }),
    onSuccess: (a) => {
      toast.success(`${a.title} booked with ${a.userName}`, { description: "It's on their Google Calendar and in the customer's history." });
      for (const k of ["contact", "appointments", "dashboard", "opportunity", "leads"]) void qc.invalidateQueries({ queryKey: [k] });
      setOpen(false);
    },
    onError: (e) => {
      const d = describeError(e);
      toast.error(d.title, { description: d.action });
      void busy.refetch();
    },
  });

  const fmt = (d: Date, tz: string) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz, timeZoneName: "short" }).format(d);
  const pct = (d: Date) => {
    const h = d.getHours() + d.getMinutes() / 60;
    return Math.max(0, Math.min(100, ((h - DAY_START) / (DAY_END - DAY_START)) * 100));
  };
  const unbookable = member && member.calendarStatus !== "CONNECTED";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <CalendarPlusIcon size={16} aria-hidden /> Book appointment
        </Button>
      </DialogTrigger>
      <DialogContent title={`Book with ${contactName}`} description="Booked on the employee's own Google Calendar.">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            book.mutate();
          }}
          className="flex flex-col gap-4"
        >
          <Field label="What">{(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} required />}</Field>
          <Field
            label="With"
            error={unbookable ? (member!.calendarStatus === "NEEDS_RECONNECT" ? `${member!.name}'s Google connection expired. They need to reconnect it in Settings → Profile.` : `${member!.name} hasn't connected a Google Calendar, so they can't be booked.`) : undefined}
          >
            {(p) => (
              <Select {...p} value={userId} onChange={(e) => setUserId(e.target.value)}>
                {members.data
                  ?.filter((u) => u.active)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                      {u.calendarStatus === "CONNECTED" ? "" : u.calendarStatus === "NEEDS_RECONNECT" ? " (calendar needs reconnecting)" : " (no calendar)"}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Date">{(p) => <Input {...p} type="date" value={date} min={localDate()} onChange={(e) => setDate(e.target.value)} />}</Field>
            <Field label="Start">{(p) => <Input {...p} type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />}</Field>
            <Field label="Length">
              {(p) => (
                <Select {...p} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                  {[30, 45, 60, 90].map((m) => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          {!unbookable && (
            <div>
              <p className="text-[13px] font-medium text-ink">{member?.name ?? "Their"} day, {DAY_START}:00–{DAY_END}:00 your time</p>
              <div className="relative mt-2 h-9 bg-surface" aria-hidden>
                {(busy.data ?? []).map((b, i) => (
                  <span key={i} className="absolute inset-y-0 bg-[repeating-linear-gradient(135deg,var(--surface-3)_0_4px,transparent_4px_8px)]" style={{ left: `${pct(new Date(b.start))}%`, width: `${pct(new Date(b.end)) - pct(new Date(b.start))}%` }} />
                ))}
                <span className={cn("absolute inset-y-1 rounded-[2px]", clash.length ? "bg-signal" : "bg-teal")} style={{ left: `${pct(start)}%`, width: `${Math.max(1, pct(end) - pct(start))}%` }} />
              </div>
              <p className="mt-1.5 text-[12.5px] text-ink-soft">{busy.isFetching ? "Reading their calendar…" : "Hatched blocks are busy. The solid block is your slot."}</p>
            </div>
          )}

          {clash.length > 0 && (
            <p role="alert" className="flex gap-2 rounded-[3px] bg-signal-tint px-3 py-2.5 text-sm text-signal">
              <WarningIcon size={18} weight="fill" className="shrink-0" aria-hidden />
              <span>
                <span className="font-semibold">{member?.name} is busy then</span> ({clash.map((c) => `${fmt(new Date(c.start), viewerTz)}–${fmt(new Date(c.end), viewerTz)}`).join(", ")}). Pick another time.
              </span>
            </p>
          )}
          {!clash.length && !unbookable && (
            <p className="rounded-[3px] bg-surface px-3 py-2.5 text-[13px] text-ink">
              {fmt(start, viewerTz)} for you
              {member && member.timeZone !== viewerTz && <> · {fmt(start, member.timeZone)} for {member.name.split(" ")[0]}</>}
            </p>
          )}
          <Field label="Notes for the visit">{(p) => <Textarea {...p} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={book.isPending} disabled={!!unbookable || clash.length > 0 || inPast || !title.trim()}>
              {inPast ? "Pick a future time" : "Book it"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
