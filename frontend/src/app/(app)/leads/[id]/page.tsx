"use client";

import { ArrowLeftIcon, EnvelopeSimpleIcon, PhoneIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import Link from "next/link";
import { use } from "react";
import { api } from "@/lib/api";
import type { Assignment } from "@/lib/api/types";
import { cn, formatDateTime, formatDuration } from "@/lib/utils";
import { NoteForm } from "@/components/activity/note-form";
import { Timeline } from "@/components/activity/timeline";
import { AckClock } from "@/components/leads/ack-clock";
import { AcknowledgeButton, CloseLeadButton, ReassignMenu } from "@/components/leads/lead-actions";
import { Avatar, ErrorState, Skeleton } from "@/components/ui/misc";
import { LeadStatusTag, RECOVERY, SourceTag, Tag } from "@/components/ui/status";

const LEVEL = ["First owner", "Next teammate", "Backup", "Manager", "Manager"];
const REASON: Record<Assignment["reason"], string> = {
  ROUND_ROBIN: "round-robin",
  ESCALATION: "escalated",
  ABSENCE: "owner became unavailable",
  MANUAL: "reassigned by hand",
};

function HandoffLanes({ items }: { items: Assignment[] }) {
  return (
    <ol className="flex flex-col" aria-label="Hand-off history">
      {items.map((a, i) => {
        const held = a.resolvedAt ? (new Date(a.resolvedAt).getTime() - new Date(a.assignedAt).getTime()) / 1000 : null;
        return (
          <motion.li
            key={a.id}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className={cn("relative grid grid-cols-[6px_minmax(0,1fr)_auto] items-center gap-4 py-3", i > 0 && "border-t border-line")}
          >
            <span
              aria-hidden
              className={cn(
                "h-full min-h-10 w-[6px]",
                a.status === "PENDING" ? "bg-teal" : a.status === "ACKNOWLEDGED" ? "bg-ok" : a.status === "EXPIRED" ? "bg-signal" : "bg-surface-3",
              )}
            />
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={a.userName} size={30} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{a.userName}</p>
                <p className="text-[12.5px] text-ink-soft">
                  {LEVEL[a.level] ?? `Level ${a.level}`} · {REASON[a.reason]} · {formatDateTime(a.assignedAt)}
                </p>
              </div>
            </div>
            <div className="text-right">
              {a.status === "PENDING" && <Tag tone="teal" shape="clock">Holding now</Tag>}
              {a.status === "ACKNOWLEDGED" && <Tag tone="ok" shape="check">Acknowledged</Tag>}
              {a.status === "EXPIRED" && <Tag tone="signal" shape="cross">No response</Tag>}
              {a.status === "REASSIGNED" && <Tag tone="neutral" shape="bar">Moved</Tag>}
              {held != null && <p className="tabular mt-1 text-[12px] text-ink-soft">held {formatDuration(held)}</p>}
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}

export default function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ["lead", id], queryFn: () => api().leads.get(id) });

  if (q.isPending)
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (q.isError) return <ErrorState className="mx-auto max-w-5xl" error={q.error} onRetry={() => q.refetch()} />;

  const { lead, assignments, activities } = q.data;
  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/leads" className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
        <ArrowLeftIcon size={14} aria-hidden /> Leads
      </Link>

      <section className="mt-4 grid gap-8 bg-surface p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:p-8">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SourceTag value={lead.source} />
            <LeadStatusTag value={lead.status} />
            {lead.recoveryReason !== "NONE" && (
              <Tag tone={RECOVERY[lead.recoveryReason].tone} shape={RECOVERY[lead.recoveryReason].shape}>
                In recovery: {RECOVERY[lead.recoveryReason].long.toLowerCase()}
              </Tag>
            )}
          </div>
          <h1 className="mt-3 text-[32px] leading-tight font-semibold tracking-[-0.02em] text-ink md:text-[40px]">{lead.contactName}</h1>
          <blockquote className="mt-4 max-w-prose text-[17px] leading-relaxed text-ink">&ldquo;{lead.message}&rdquo;</blockquote>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {lead.contactPhone && (
              <a href={`tel:${lead.contactPhone}`} className="inline-flex items-center gap-1.5 text-teal hover:underline">
                <PhoneIcon size={15} aria-hidden /> {lead.contactPhone}
              </a>
            )}
            {lead.contactEmail && (
              <a href={`mailto:${lead.contactEmail}`} className="inline-flex items-center gap-1.5 text-teal hover:underline">
                <EnvelopeSimpleIcon size={15} aria-hidden /> {lead.contactEmail}
              </a>
            )}
            <Link href={`/contacts/${lead.contactId}`} className="text-teal hover:underline">
              Open customer record
            </Link>
          </div>
        </div>
        <div className="flex flex-col justify-between gap-6 bg-paper p-5">
          <div>
            <p className="text-[13px] text-ink-soft">
              {lead.status === "ASSIGNED" ? `${lead.ownerName} has` : "Owner"}
              {lead.status !== "ASSIGNED" && `: ${lead.ownerName ?? "nobody"}`}
            </p>
            <AckClock lead={lead} size="lg" className="mt-2 items-start" />
          </div>
          <div className="flex flex-wrap gap-2">
            <AcknowledgeButton lead={lead} size="md" />
            <ReassignMenu lead={lead} size="md" />
            <CloseLeadButton lead={lead} />
          </div>
        </div>
      </section>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <section aria-labelledby="handoffs">
          <h2 id="handoffs" className="text-lg font-semibold text-ink">
            Who has held it
          </h2>
          <p className="mt-1 text-sm text-ink-soft">One owner at a time. Each row is one hand-off.</p>
          <div className="mt-4">
            <HandoffLanes items={assignments} />
          </div>
        </section>
        <section aria-labelledby="history">
          <h2 id="history" className="text-lg font-semibold text-ink">
            History
          </h2>
          <div className="mt-4">
            <NoteForm entity={{ type: "lead", id: lead.id }} invalidate={["lead"]} />
          </div>
          <div className="mt-6">
            <Timeline items={activities} />
          </div>
        </section>
      </div>
    </div>
  );
}
