"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import type { Lead } from "@/lib/api/types";
import { useNow } from "@/lib/use-now";
import { cn, timeAgo } from "@/lib/utils";
import { Avatar } from "@/components/ui/misc";
import { LeadStatusTag, RecoveryTag, SourceTag } from "@/components/ui/status";
import { AckClock, ackState } from "./ack-clock";
import { AcknowledgeButton, ReassignMenu } from "./lead-actions";

export function LeadRow({ lead, showReason }: { lead: Lead; showReason?: boolean }) {
  const now = useNow();
  const s = ackState(lead, now);
  const hot = s && (s.expired || s.urgent);
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="group relative bg-paper"
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-0 bottom-0 left-0 w-1 transition-colors",
          lead.status === "ASSIGNED" ? (hot ? "bg-signal" : "bg-teal") : lead.status === "ACKNOWLEDGED" ? "bg-ok" : "bg-surface-3",
        )}
      />
      <div className="grid grid-cols-1 gap-3 py-4 pr-4 pl-5 transition-colors group-hover:bg-surface/60 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto] md:items-center md:gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/leads/${lead.id}`} className="truncate text-[15px] font-semibold text-ink after:absolute after:inset-0 hover:underline">
              {lead.contactName}
            </Link>
            <SourceTag value={lead.source} />
            {showReason ? <RecoveryTag value={lead.recoveryReason} /> : <LeadStatusTag value={lead.status} />}
            {lead.escalationCount > 0 && (
              <span className="text-[12.5px] text-ink-soft">
                passed on {lead.escalationCount}×
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-1 text-sm text-ink-soft">{lead.message}</p>
        </div>
        <div className="flex min-w-0 items-center gap-2.5">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={lead.ownerId ?? "none"}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="flex min-w-0 items-center gap-2.5"
            >
              {lead.ownerName ? <Avatar name={lead.ownerName} size={26} /> : null}
              <span className="min-w-0">
                <span className="block truncate text-sm text-ink">{lead.ownerName ?? "Unassigned"}</span>
                <span className="block text-[12px] text-ink-soft">{timeAgo(lead.createdAt, now)}</span>
              </span>
            </motion.span>
          </AnimatePresence>
        </div>
        <div className="relative z-10 flex items-center justify-between gap-3 md:justify-end">
          <AckClock lead={lead} />
          <div className="flex items-center gap-2">
            <AcknowledgeButton lead={lead} />
            <ReassignMenu lead={lead} />
          </div>
        </div>
      </div>
    </motion.li>
  );
}
