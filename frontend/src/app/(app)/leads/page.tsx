"use client";

import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import { useDeferredValue, useState } from "react";
import { api } from "@/lib/api";
import { useCan } from "@/lib/session";
import { Input } from "@/components/ui/field";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/controls";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/ui/misc";
import { LeadRow } from "@/components/leads/lead-row";
import { NewLeadDialog } from "@/components/leads/new-lead-dialog";

type Status = "OPEN" | "ASSIGNED" | "ACKNOWLEDGED" | "CLOSED" | "";

export default function LeadsPage() {
  const can = useCan();
  const [scope, setScope] = useState<"mine" | "all">(can("leads.view_all") ? "all" : "mine");
  const [status, setStatus] = useState<Status>("OPEN");
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q);
  const leads = useQuery({
    queryKey: ["leads", scope, status, dq],
    queryFn: () => api().leads.list({ scope, status: status || undefined, q: dq || undefined }),
    placeholderData: keepPreviousData,
  });
  const waiting = leads.data?.filter((l) => l.status === "ASSIGNED").length ?? 0;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Leads"
        description={
          scope === "mine"
            ? "Everything assigned to you. Acknowledge before the clock runs out, or the lead is handed to the next person."
            : "Every lead in the workspace and who holds it right now."
        }
        actions={<NewLeadDialog />}
      />

      <div className="flex flex-col gap-3 pb-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {can("leads.view_all") && (
            <Tabs value={scope} onValueChange={(v) => setScope(v as "mine" | "all")}>
              <TabsList aria-label="Whose leads">
                <TabsTrigger value="mine">Mine</TabsTrigger>
                <TabsTrigger value="all">Everyone</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <Tabs value={status} onValueChange={(v) => setStatus(v as Status)}>
            <TabsList aria-label="Lead status">
              <TabsTrigger value="OPEN">Open</TabsTrigger>
              <TabsTrigger value="ASSIGNED">Waiting</TabsTrigger>
              <TabsTrigger value="ACKNOWLEDGED">Acknowledged</TabsTrigger>
              <TabsTrigger value="CLOSED">Closed</TabsTrigger>
              <TabsTrigger value="">All</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <label className="relative block md:w-72">
          <span className="sr-only">Search leads</span>
          <MagnifyingGlassIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone or message" className="pl-9" />
        </label>
      </div>

      {leads.data && waiting > 0 && (
        <p className="pb-3 text-sm text-ink-soft" aria-live="polite">
          <span className="font-semibold text-ink">{waiting}</span> waiting for acknowledgement, soonest deadline first.
        </p>
      )}

      {leads.isPending ? (
        <ListSkeleton rows={7} />
      ) : leads.isError ? (
        <ErrorState error={leads.error} onRetry={() => leads.refetch()} />
      ) : leads.data.length === 0 ? (
        <EmptyState
          title={status === "OPEN" ? "No open leads." : "Nothing here."}
          body={scope === "mine" ? "New leads appear here the moment they're assigned to you, with their clock running." : "Try another status or clear the search."}
        />
      ) : (
        <ul className={`flex flex-col gap-px bg-line transition-opacity ${q !== dq ? "opacity-70" : ""}`} aria-label="Leads">
          <AnimatePresence initial={false}>
            {leads.data.map((l) => (
              <LeadRow key={l.id} lead={l} />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
