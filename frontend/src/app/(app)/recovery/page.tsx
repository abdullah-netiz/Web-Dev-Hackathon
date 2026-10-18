"use client";

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { RecoveryReason } from "@/lib/api/types";
import { formatDuration } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/controls";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/ui/misc";
import { RECOVERY } from "@/components/ui/status";
import { LeadRow } from "@/components/leads/lead-row";

type Reason = Exclude<RecoveryReason, "NONE">;

export default function RecoveryPage() {
  const q = useQuery({ queryKey: ["recovery"], queryFn: () => api().leads.recovery(), refetchInterval: 15_000 });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api().workspace.settings() });
  const [reason, setReason] = useState<Reason | "ALL">("ALL");
  const counts = useMemo(() => {
    const c: Record<Reason, number> = { OVERDUE: 0, ESCALATED_TWICE: 0, IDLE: 0 };
    for (const l of q.data ?? []) if (l.recoveryReason !== "NONE") c[l.recoveryReason] += 1;
    return c;
  }, [q.data]);
  const rows = (q.data ?? []).filter((l) => reason === "ALL" || l.recoveryReason === reason);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Recovery queue"
        description={
          <>
            Leads that slipped: not acknowledged in time, escalated twice, or untouched for {settings.data ? formatDuration(settings.data.idleSec) : "the idle period"}. Each
            row says why it is here.
          </>
        }
      />
      <dl className="mb-6 grid grid-cols-1 gap-px bg-line sm:grid-cols-3">
        {(Object.keys(RECOVERY) as Reason[]).map((r) => (
          <div key={r} className="bg-paper p-5">
            <dt className="text-sm text-ink-soft">{RECOVERY[r].long}</dt>
            <dd className="tabular mt-2 text-4xl font-semibold tracking-[-0.02em] text-ink">{q.data ? counts[r] : "–"}</dd>
          </div>
        ))}
      </dl>
      <Tabs value={reason} onValueChange={(v) => setReason(v as Reason | "ALL")} className="mb-4">
        <TabsList aria-label="Filter by reason" className="w-fit">
          <TabsTrigger value="ALL">All reasons</TabsTrigger>
          {(Object.keys(RECOVERY) as Reason[]).map((r) => (
            <TabsTrigger key={r} value={r}>
              {RECOVERY[r].label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {q.isPending ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing to recover." body="Every lead has an owner who responded in time. New items appear here automatically." />
      ) : (
        <ul className="flex flex-col gap-px bg-line" aria-label="Leads needing recovery">
          <AnimatePresence initial={false}>
            {rows.map((l) => (
              <LeadRow key={l.id} lead={l} showReason />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
