"use client";

import { ArrowUpRightIcon, SlidersHorizontalIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { Appointment, Availability, DashboardMetrics } from "@/lib/api/types";
import { useMe } from "@/lib/session";
import { cn, formatCompactMoney, formatDateTime, formatDuration, formatMoney } from "@/lib/utils";
import { Checkbox } from "@/components/ui/controls";
import { Menu, MenuContent, MenuLabel, MenuTrigger } from "@/components/ui/menu";
import { Avatar, ErrorState, PageHeader, Skeleton } from "@/components/ui/misc";
import { AVAILABILITY } from "@/components/ui/status";

const FIGURES = [
  { key: "newLeads", label: "New leads today" },
  { key: "response", label: "Average time to first response" },
  { key: "recovery", label: "In the recovery queue" },
  { key: "escalations", label: "Escalations, last 24 hours" },
  { key: "pipeline", label: "Open pipeline by stage" },
  { key: "collected", label: "Collected this month" },
  { key: "availability", label: "Team availability" },
  { key: "appointments", label: "Upcoming appointments" },
] as const;
type FigureKey = (typeof FIGURES)[number]["key"];

const rise = (i: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: 0.05 + i * 0.06, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
});

function Tile({ href, label, value, note, i, className, children }: { href?: string; label: string; value: ReactNode; note?: ReactNode; i: number; className?: string; children?: ReactNode }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-ink-soft">{label}</p>
        {href && <ArrowUpRightIcon size={16} className="text-ink-faint transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-teal" aria-hidden />}
      </div>
      <div className="tabular mt-3 text-[44px] leading-none font-semibold tracking-[-0.03em] text-ink">{value}</div>
      {note && <div className="mt-2 text-[13px] text-ink-soft">{note}</div>}
      {children}
    </>
  );
  return (
    <motion.div {...rise(i)} className={cn("rounded-[3px] bg-surface", className)}>
      {href ? (
        <Link href={href} className="group block h-full p-5 transition-colors hover:bg-surface-2 md:p-6">
          {body}
          <span className="sr-only">, open the list</span>
        </Link>
      ) : (
        <div className="h-full p-5 md:p-6">{body}</div>
      )}
    </motion.div>
  );
}

function Sparkline({ data }: { data: DashboardMetrics["responseTrend"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = data.map((d, i) => ({ ...d, i })).filter((d) => d.avgSec != null);
  if (pts.length < 2) return <p className="mt-4 text-[13px] text-ink-soft">Not enough responses yet to show a trend.</p>;
  const W = 280;
  const H = 56;
  const max = Math.max(...pts.map((p) => p.avgSec!)) * 1.1;
  const x = (i: number) => (i / (data.length - 1)) * W;
  const y = (v: number) => H - (v / max) * H;
  const path = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.avgSec!).toFixed(1)}`).join(" ");
  const h = hover != null ? data[hover] : null;
  return (
    <div className="relative mt-5">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-14 w-full overflow-visible" preserveAspectRatio="none" role="img" aria-label="Average first response per day over the last 14 days">
        <path d={path} fill="none" stroke="var(--teal)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {h && h.avgSec != null && <circle cx={x(hover!)} cy={y(h.avgSec)} r={4} fill="var(--teal)" stroke="var(--paper)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
        {data.map((_, i) => (
          <rect key={i} x={x(i) - W / data.length / 2} y={0} width={W / data.length} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>
      {h && (
        <div className="pointer-events-none absolute -top-12 rounded-[3px] bg-ink px-2.5 py-1.5 text-[12px] whitespace-nowrap text-paper" style={{ left: `clamp(0px, calc(${(hover! / (data.length - 1)) * 100}% - 60px), calc(100% - 140px))` }}>
          {new Date(h.day).toLocaleDateString(undefined, { month: "short", day: "numeric" })}: {h.avgSec != null ? formatDuration(h.avgSec) : "no responses"} · {h.leads} leads
        </div>
      )}
      <div className="mt-1 flex justify-between text-[12px] text-ink-faint">
        <span>14 days ago</span>
        <span>Today</span>
      </div>
      <table className="sr-only">
        <caption>Average first response by day</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <th>{d.day}</th>
              <td>{d.avgSec != null ? formatDuration(d.avgSec) : "none"}</td>
              <td>{d.leads} leads</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PipelineBars({ m }: { m: DashboardMetrics }) {
  const [hover, setHover] = useState<string | null>(null);
  const rows = m.openPipelineByStage ?? [];
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <div>
      <p className="tabular text-[44px] leading-none font-semibold tracking-[-0.03em] text-ink">{formatCompactMoney(total, m.currency)}</p>
      <p className="mt-2 text-[13px] text-ink-soft">Value of opportunities not yet won or lost. Click a stage to see them.</p>
      <ul className="mt-6 flex flex-col gap-2">
        {rows.map((r, i) => (
          <li key={r.stageId}>
            {(i === 0 || rows[i - 1]!.pipelineName !== r.pipelineName) && (
              <p className={cn("pb-1 text-[13px] font-semibold text-ink-soft", i > 0 && "pt-4")}>{r.pipelineName}</p>
            )}
            <Link
              href={`/opportunities?stage=${r.stageId}`}
              className="group grid grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)_5.5rem] items-center gap-3 rounded-[3px] py-1 hover:bg-surface/70"
              onMouseEnter={() => setHover(r.stageId)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(r.stageId)}
              onBlur={() => setHover(null)}
            >
              <span className="truncate text-sm text-ink">{r.stageName}</span>
              <span className="relative h-5">
                <motion.span
                  className={cn("absolute inset-y-0 left-0 rounded-r-[4px] bg-teal transition-opacity", hover && hover !== r.stageId && "opacity-40")}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(1, (r.value / max) * 100)}%` }}
                  transition={{ delay: 0.2 + i * 0.05, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                />
              </span>
              <span className="tabular text-right text-sm text-ink">
                {formatCompactMoney(r.value, m.currency)}
                <span className="block text-[12px] text-ink-soft">{r.count} open</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AvailabilityBar({ m }: { m: DashboardMetrics }) {
  const order: Availability[] = ["AVAILABLE", "BUSY", "ON_LEAVE", "OFFLINE"];
  const total = order.reduce((s, k) => s + m.availability[k], 0) || 1;
  const fill: Record<Availability, string> = { AVAILABLE: "bg-ok", BUSY: "bg-warn", ON_LEAVE: "bg-off", OFFLINE: "bg-surface-3" };
  return (
    <div>
      <div className="tabular text-[44px] leading-none font-semibold tracking-[-0.03em] text-ink">
        {m.availability.AVAILABLE}
        <span className="text-xl font-medium text-ink-soft"> of {total} can take leads</span>
      </div>
      <div className="mt-5 flex h-3 w-full gap-[2px]" aria-hidden>
        {order.map((k) =>
          m.availability[k] ? <motion.span key={k} className={cn("h-full first:rounded-l-[4px] last:rounded-r-[4px]", fill[k])} initial={{ flexGrow: 0 }} animate={{ flexGrow: m.availability[k] }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }} /> : null,
        )}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
        {order.map((k) => (
          <li key={k} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-ink">
              <span className={cn("h-2.5 w-2.5 rounded-full", fill[k])} aria-hidden />
              {AVAILABILITY[k].label}
            </span>
            <span className="tabular font-semibold text-ink">{m.availability[k]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function dayLabel(iso: string, tz: string) {
  const fmt = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const day = fmt(new Date(iso));
  if (day === fmt(new Date())) return "Today";
  if (day === fmt(new Date(Date.now() + 86_400_000))) return "Tomorrow";
  return new Intl.DateTimeFormat(undefined, { weekday: "long", timeZone: tz }).format(new Date(iso));
}

function AppointmentCard({ a, tz }: { a: Appointment; tz: string }) {
  const d = new Date(a.startsAt);
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, { ...o, timeZone: tz }).format(d);
  const mins = Math.round((new Date(a.endsAt).getTime() - d.getTime()) / 60_000);
  const label = dayLabel(a.startsAt, tz);
  return (
    <Link href={`/contacts/${a.contactId}`} className="group flex h-full flex-col rounded-[3px] bg-paper p-4 transition-colors hover:bg-surface-2">
      <div className="flex items-start gap-3">
        <div className={cn("flex w-12 shrink-0 flex-col items-center rounded-[3px] py-1.5", label === "Today" ? "bg-teal text-on-teal" : "bg-surface-2 text-ink")}>
          <span className="text-[11px] font-semibold uppercase">{part({ month: "short" })}</span>
          <span className="tabular text-xl leading-none font-semibold">{part({ day: "numeric" })}</span>
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink-soft">{label}</p>
          <p className="tabular text-lg leading-tight font-semibold text-ink">{part({ hour: "numeric", minute: "2-digit" })}</p>
          <p className="text-[12px] text-ink-soft">{mins} min</p>
        </div>
      </div>
      <p className="mt-4 truncate text-[15px] font-semibold text-ink group-hover:underline">{a.title}</p>
      <p className="truncate text-sm text-ink-soft">{a.contactName}</p>
      <div className="mt-auto flex items-center gap-2 pt-4">
        <Avatar name={a.userName} size={22} />
        <span className="truncate text-[13px] text-ink">{a.userName}</span>
      </div>
    </Link>
  );
}

function Dashboard() {
  const me = useMe();
  const qc = useQueryClient();
  const params = useSearchParams();
  const metrics = useQuery({ queryKey: ["dashboard", "metrics"], queryFn: () => api().dashboard.metrics(), refetchInterval: 20_000 });
  const prefs = useQuery({ queryKey: ["dashboard", "prefs"], queryFn: () => api().dashboard.prefs() });
  const save = useMutation({
    mutationFn: (hidden: string[]) => api().dashboard.savePrefs(hidden),
    onMutate: (hidden) => qc.setQueryData(["dashboard", "prefs"], { hidden }),
  });
  const hidden = new Set(prefs.data?.hidden ?? []);
  const show = (k: FigureKey) => !hidden.has(k);
  const toggle = (k: FigureKey) => {
    const next = new Set(hidden);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    save.mutate([...next]);
  };
  const first = me.user.name.split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const m = metrics.data;
  let i = 0;
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={`${greeting}, ${first}.`}
        description={
          params.get("welcome")
            ? "Your workspace is ready. Invite your team and set the response window in Settings, then share your lead form."
            : m?.scope === "PERSONAL"
              ? "Your own figures: your leads, your response time, your payments."
              : "Company-wide figures, live. Every number opens the records behind it."
        }
        actions={
          <Menu>
            <MenuTrigger asChild>
              <button className="inline-flex h-10 items-center gap-2 rounded-[3px] px-4 text-sm font-medium text-ink ring-1 ring-line ring-inset hover:bg-surface">
                <SlidersHorizontalIcon size={16} aria-hidden /> Customize
              </button>
            </MenuTrigger>
            <MenuContent className="w-72">
              <MenuLabel>Show on your dashboard</MenuLabel>
              {FIGURES.map((f) => (
                <label key={f.key} className="flex cursor-pointer items-center gap-2.5 rounded-[3px] px-2.5 py-2 text-sm hover:bg-surface">
                  <Checkbox checked={show(f.key)} onCheckedChange={() => toggle(f.key)} />
                  {f.label}
                </label>
              ))}
            </MenuContent>
          </Menu>
        }
      />

      {metrics.isPending ? (
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }, (_, k) => (
            <div key={k} className="rounded-[3px] bg-surface p-6">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-4 h-10 w-24" />
            </div>
          ))}
        </div>
      ) : metrics.isError ? (
        <ErrorState error={metrics.error} onRetry={() => metrics.refetch()} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {show("newLeads") && <Tile i={i++} href="/leads" label="New leads today" value={m!.newLeadsToday} note="Web form, WhatsApp and manual entries since midnight" />}
            {show("response") && (
              <Tile
                i={i++}
                label="Average time to first response"
                value={m!.avgTimeToFirstResponseSec != null ? formatDuration(m!.avgTimeToFirstResponseSec) : "—"}
                note="From first assignment to first acknowledgement"
              >
                <Sparkline data={m!.responseTrend} />
              </Tile>
            )}
            {show("recovery") && (
              <Tile
                i={i++}
                href="/recovery"
                label="In the recovery queue"
                value={<span className={m!.recoveryCount ? "text-signal" : undefined}>{m!.recoveryCount}</span>}
                note={m!.recoveryCount ? "Overdue, escalated twice, or idle" : "Nothing has slipped"}
              />
            )}
            {show("escalations") && <Tile i={i++} href="/audit?action=LEAD_ESCALATED" label="Escalations, last 24 hours" value={m!.escalations24h} note="Automatic hand-offs after a missed window" />}
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            {show("pipeline") && (
              <motion.section {...rise(i++)} className="rounded-[3px] bg-surface p-5 md:p-6" aria-labelledby="pipe-h">
                <h2 id="pipe-h" className="text-sm text-ink-soft">
                  Open pipeline by stage
                </h2>
                <div className="mt-3">
                  {m!.openPipelineByStage ? (
                    <PipelineBars m={m!} />
                  ) : (
                    <p className="max-w-sm py-6 text-sm text-ink-soft">Opportunity values are hidden for your role. Ask an Owner or Admin if you need to see them.</p>
                  )}
                </div>
              </motion.section>
            )}
            <div className="grid gap-3">
              {show("collected") && (
                <Tile
                  i={i++}
                  href="/payments?status=PAID"
                  label="Collected this month"
                  value={formatMoney(m!.collectedThisMonth, m!.currency)}
                  note={
                    <>
                      {m!.paymentsThisMonthCount} payments confirmed by Stripe, minus refunds.
                      {m!.projectedRevenue != null && (
                        <span className="mt-1 block">
                          Projected, not yet collected: <span className="tabular font-semibold text-ink">{formatCompactMoney(m!.projectedRevenue, m!.currency)}</span>
                        </span>
                      )}
                    </>
                  }
                />
              )}
              {show("availability") && (
                <motion.section {...rise(i++)} className="rounded-[3px] bg-surface" aria-labelledby="avail-h">
                  <Link href="/team" className="group block p-5 hover:bg-surface-2 md:p-6">
                    <h2 id="avail-h" className="flex items-center justify-between text-sm text-ink-soft">
                      Team availability <ArrowUpRightIcon size={16} className="text-ink-faint group-hover:text-teal" aria-hidden />
                    </h2>
                    <div className="mt-3">
                      <AvailabilityBar m={m!} />
                    </div>
                  </Link>
                </motion.section>
              )}
            </div>
          </div>

          {show("appointments") && (
            <motion.section {...rise(i++)} className="rounded-[3px] bg-surface p-5 md:p-6" aria-labelledby="appt-h">
              <div className="flex items-center justify-between">
                <h2 id="appt-h" className="text-sm text-ink-soft">
                  Upcoming appointments
                </h2>
                <Link href="/appointments" className="text-sm font-medium text-teal hover:underline">
                  All appointments
                </Link>
              </div>
              {m!.upcomingAppointments.length ? (
                <ul className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  {m!.upcomingAppointments.map((a, k) => (
                    <motion.li key={a.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + k * 0.06, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
                      <AppointmentCard a={a} tz={me.user.timeZone} />
                    </motion.li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-ink-soft">No appointments booked ahead.</p>
              )}
            </motion.section>
          )}
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  );
}
