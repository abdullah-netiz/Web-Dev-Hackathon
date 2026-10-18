"use client";

import { LockSimpleIcon } from "@phosphor-icons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Fragment, Suspense, useState } from "react";
import { api } from "@/lib/api";
import type { AuditAction } from "@/lib/api/types";
import { useCan } from "@/lib/session";
import { formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/ui/misc";

const ACTIONS: Record<AuditAction, string> = {
  LEAD_ASSIGNED: "Lead assigned",
  LEAD_ACKNOWLEDGED: "Lead acknowledged",
  LEAD_ESCALATED: "Lead escalated",
  LEAD_REASSIGNED: "Lead reassigned",
  ALERT_SENT: "Alert sent",
  ROLE_CHANGED: "Role created or deleted",
  PERMISSION_CHANGED: "Permissions changed",
  MEMBER_INVITED: "Member invited",
  MEMBER_LEVEL_CHANGED: "Member level or role changed",
  FIELD_CONFIG_CHANGED: "Field changed",
  PIPELINE_CHANGED: "Pipeline changed",
  INTEGRATION_CHANGED: "Integration changed",
  SETTINGS_CHANGED: "Settings changed",
  RECORD_DELETED: "Record deleted",
};

function Value({ v }: { v: unknown }) {
  if (v == null) return <span className="text-ink-faint">—</span>;
  if (typeof v !== "object") return <span>{String(v)}</span>;
  return (
    <dl className="flex flex-col gap-0.5">
      {Object.entries(v as Record<string, unknown>).map(([k, x]) => (
        <div key={k} className="flex flex-wrap gap-1">
          <dt className="text-ink-soft">{k}:</dt>
          <dd className="break-all text-ink">{Array.isArray(x) ? x.join(", ") || "none" : typeof x === "object" && x ? JSON.stringify(x) : String(x ?? "—")}</dd>
        </div>
      ))}
    </dl>
  );
}

function Audit() {
  const can = useCan();
  const params = useSearchParams();
  const [action, setAction] = useState<AuditAction | "">((params.get("action") as AuditAction) ?? "");
  const [actorId, setActorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const members = useQuery({ queryKey: ["members"], queryFn: () => api().members.list() });
  const q = useQuery({
    queryKey: ["audit", action, actorId, from, to, page],
    queryFn: () =>
      api().audit.list({
        action: action || undefined,
        actorId: actorId || undefined,
        from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
        to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
        page,
      }),
    placeholderData: keepPreviousData,
    enabled: can("audit.view"),
  });

  if (!can("audit.view"))
    return (
      <div className="mx-auto max-w-xl pt-10">
        <EmptyState title="The audit history is restricted." body="Only people with the audit permission can open it. Ask an Owner or Admin if you need access." />
      </div>
    );
  const pages = Math.max(1, Math.ceil((q.data?.meta.total ?? 0) / 30));
  const reset = <T,>(fn: (v: T) => void) => (v: T) => (fn(v), setPage(1));

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Audit history"
        description={
          <span className="inline-flex items-start gap-2">
            <LockSimpleIcon size={16} className="mt-1 shrink-0" aria-hidden />
            Append-only. Entries can be read and filtered, never edited or deleted, by anyone.
          </span>
        }
      />
      <section aria-label="Filters" className="mb-5 grid gap-3 rounded-[3px] bg-surface p-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Event">
          {(p) => (
            <Select {...p} value={action} onChange={(e) => reset(setAction)(e.target.value as AuditAction | "")}>
              <option value="">All events</option>
              {Object.entries(ACTIONS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Who">
          {(p) => (
            <Select {...p} value={actorId} onChange={(e) => reset(setActorId)(e.target.value)}>
              <option value="">Anyone</option>
              <option value="system">System (automatic)</option>
              {members.data?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="From">{(p) => <Input {...p} type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} />}</Field>
        <Field label="To">{(p) => <Input {...p} type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} />}</Field>
      </section>
      {q.isPending ? (
        <ListSkeleton rows={10} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.data.length === 0 ? (
        <EmptyState title="No entries match these filters." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[13px] text-ink-soft">
                <th scope="col" className="py-2.5 pr-4 font-medium">When</th>
                <th scope="col" className="py-2.5 pr-4 font-medium">Event</th>
                <th scope="col" className="py-2.5 pr-4 font-medium">Target</th>
                <th scope="col" className="py-2.5 pr-4 font-medium">By</th>
                <th scope="col" className="py-2.5 font-medium">
                  <span className="sr-only">Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {q.data.data.map((a) => (
                <Fragment key={a.id}>
                  <tr className="border-b border-line/70">
                    <td className="tabular py-3 pr-4 whitespace-nowrap text-ink-soft">{formatDateTime(a.at)}</td>
                    <td className="py-3 pr-4 font-medium text-ink">{ACTIONS[a.action]}</td>
                    <td className="py-3 pr-4 text-ink">
                      {a.targetLabel}
                      <span className="block text-[12.5px] text-ink-soft">{a.targetType}</span>
                    </td>
                    <td className="py-3 pr-4 text-ink">{a.actorId ? a.actorName : <span className="text-ink-soft">System</span>}</td>
                    <td className="py-3 text-right">
                      <Button size="sm" variant="ghost" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)}>
                        {open === a.id ? "Hide" : "Before / after"}
                      </Button>
                    </td>
                  </tr>
                  {open === a.id && (
                    <tr className="border-b border-line/70 bg-surface/60">
                      <td colSpan={5} className="px-4 py-3">
                        <div className="grid gap-4 text-[13px] sm:grid-cols-2">
                          <div>
                            <p className="mb-1 font-semibold text-ink">Before</p>
                            <Value v={a.before} />
                          </div>
                          <div>
                            <p className="mb-1 font-semibold text-ink">After</p>
                            <Value v={a.after} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.data && pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Newer
          </Button>
          <span className="tabular text-sm text-ink-soft">
            Page {page} of {pages} · {q.data.meta.total} entries
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Older
          </Button>
        </nav>
      )}
    </div>
  );
}

export default function AuditPage() {
  return (
    <Suspense>
      <Audit />
    </Suspense>
  );
}
