"use client";

import type { Lead } from "@/lib/api/types";
import { useNow } from "@/lib/use-now";
import { cn, formatClock, formatDuration } from "@/lib/utils";

export function ackState(lead: Lead, now: number) {
  const cur = lead.current;
  if (lead.status !== "ASSIGNED" || !cur) return null;
  const start = new Date(cur.assignedAt).getTime();
  const due = new Date(cur.dueAt).getTime();
  const total = Math.max(1, (due - start) / 1000);
  const left = (due - now) / 1000;
  const expired = cur.status === "EXPIRED" || left <= 0;
  return { total, left, expired, ratio: Math.max(0, Math.min(1, left / total)), urgent: !expired && left / total < 0.3 };
}

export function AckClock({ lead, size = "md", className }: { lead: Lead; size?: "md" | "lg"; className?: string }) {
  const now = useNow();
  const s = ackState(lead, now);

  if (lead.status === "ACKNOWLEDGED" || lead.status === "CLOSED") {
    return (
      <div className={cn("text-right", className)}>
        <div className={cn("tabular font-semibold text-ok", size === "lg" ? "text-3xl" : "text-sm")}>
          {lead.timeToFirstResponseSec != null ? formatDuration(lead.timeToFirstResponseSec) : "—"}
        </div>
        <div className="text-[12px] text-ink-soft">first response</div>
      </div>
    );
  }
  if (!s) {
    return (
      <div className={cn("text-right text-[13px] font-medium text-signal", className)}>
        No owner yet
      </div>
    );
  }
  const over = -s.left > 3600 ? formatDuration(-s.left) : formatClock(-s.left);
  const label = s.expired ? `Overdue by ${over}` : `${formatClock(s.left)} left to acknowledge`;
  return (
    <div className={cn("flex flex-col items-end gap-1.5", size === "lg" ? "w-full" : "w-32", className)} role="timer" aria-label={label}>
      <div className="flex items-baseline gap-2">
        {s.expired && (
          <span className={cn("font-semibold text-signal", size === "lg" ? "text-base" : "text-[12px]")}>Overdue</span>
        )}
        {!s.expired && s.urgent && <span className={cn("font-semibold text-signal", size === "lg" ? "text-base" : "text-[12px]")}>Due soon</span>}
        <span
          className={cn(
            "tabular font-semibold",
            s.expired || s.urgent ? "text-signal" : "text-ink",
            size === "lg" ? "text-5xl tracking-[-0.03em] md:text-6xl" : "text-[17px]",
          )}
        >
          {s.expired ? `+${over}` : formatClock(s.left)}
        </span>
      </div>
      <div className={cn("w-full overflow-hidden bg-surface-2", size === "lg" ? "h-2" : "h-1")}>
        <div
          className={cn("h-full origin-left transition-transform duration-1000 ease-linear", s.expired || s.urgent ? "bg-signal" : "bg-teal")}
          style={{ transform: `scaleX(${s.expired ? 1 : s.ratio})` }}
        />
      </div>
    </div>
  );
}
