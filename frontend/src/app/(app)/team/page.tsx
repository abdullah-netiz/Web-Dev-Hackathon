"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { api } from "@/lib/api";
import type { Availability, User } from "@/lib/api/types";
import { useCan, useMe } from "@/lib/session";
import { cn } from "@/lib/utils";
import { useSetAvailability } from "@/components/app/availability-switch";
import { Avatar, ErrorState, ListSkeleton, PageHeader } from "@/components/ui/misc";
import { AVAILABILITY, Tag } from "@/components/ui/status";
import { Tooltip } from "@/components/ui/controls";

const ORDER: Availability[] = ["AVAILABLE", "BUSY", "ON_LEAVE", "OFFLINE"];

function StatusPicker({ user, editable }: { user: User; editable: boolean }) {
  const m = useSetAvailability();
  return (
    <div role="radiogroup" aria-label={`${user.name}'s availability`} className="inline-flex flex-wrap gap-1 rounded-[3px] bg-surface p-1">
      {ORDER.map((a) => {
        const on = user.availability === a;
        return (
          <button
            key={a}
            role="radio"
            aria-checked={on}
            disabled={!editable || m.isPending}
            onClick={() => !on && m.mutate({ user, value: a })}
            className={cn(
              "relative h-8 rounded-[3px] px-2.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed",
              on ? "text-ink" : "text-ink-soft enabled:hover:text-ink",
              !editable && !on && "opacity-50",
            )}
          >
            {on && (
              <motion.span layoutId={`pick-${user.id}`} className="absolute inset-0 rounded-[3px] bg-paper" transition={{ type: "spring", stiffness: 500, damping: 38 }} />
            )}
            <span className="relative">{AVAILABILITY[a].label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function TeamPage() {
  const me = useMe();
  const can = useCan();
  const members = useQuery({ queryKey: ["members"], queryFn: () => api().members.list() });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api().workspace.settings() });
  const limitDefault = settings.data?.maxOpenLeadsDefault ?? 8;
  const byId = new Map((members.data ?? []).map((u) => [u.id, u]));
  const active = (members.data ?? []).filter((u) => u.active).sort((a, b) => ORDER.indexOf(a.availability) - ORDER.indexOf(b.availability) || a.name.localeCompare(b.name));

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Team availability"
        description="Leads go only to people who are Available and under their open-lead limit, in round-robin order."
      />
      <div className="mb-8 grid gap-px bg-line md:grid-cols-2">
        <div className="bg-surface p-5">
          <p className="text-sm font-semibold text-ink">When someone goes On leave or Offline</p>
          <p className="mt-1 text-sm text-ink-soft">Their leads that are still waiting for acknowledgement move to an available teammate immediately, and the move is recorded.</p>
        </div>
        <div className="bg-surface p-5">
          <p className="text-sm font-semibold text-ink">Leads they already acknowledged</p>
          <p className="mt-1 text-sm text-ink-soft">
            {settings.data?.acknowledgedOnAbsence === "REASSIGN"
              ? "Also move to an available teammate, who must acknowledge them again."
              : "Stay with them. They appear in the recovery queue if nothing happens for the idle period, so a manager can step in."}
          </p>
        </div>
      </div>

      {members.isPending ? (
        <ListSkeleton rows={8} />
      ) : members.isError ? (
        <ErrorState error={members.error} onRetry={() => members.refetch()} />
      ) : (
        <ul className="flex flex-col gap-px bg-line" aria-label="Team members">
          {active.map((u, i) => {
            const limit = u.maxOpenLeads ?? limitDefault;
            const full = u.openLeadCount >= limit;
            const editable = u.id === me.user.id || can("members.manage");
            const backup = u.backupUserId ? byId.get(u.backupUserId) : null;
            return (
              <motion.li
                key={u.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="grid grid-cols-1 gap-4 bg-paper p-4 md:grid-cols-[minmax(0,1.2fr)_auto_minmax(0,0.9fr)_minmax(0,1fr)] md:items-center md:gap-6 md:px-5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={u.name} size={36} />
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">
                      {u.name}
                      {u.id === me.user.id && <span className="font-normal text-ink-soft"> (you)</span>}
                    </p>
                    <p className="text-[13px] text-ink-soft">
                      {u.baseLevel === "OWNER" ? "Owner" : u.baseLevel === "ADMIN" ? "Admin" : u.roleName}
                      {u.isManager && " · manager in escalations"}
                    </p>
                  </div>
                </div>
                <StatusPicker user={u} editable={editable} />
                <div>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-ink-soft">Open leads</span>
                    <span className={cn("tabular font-semibold", full ? "text-signal" : "text-ink")}>
                      {u.openLeadCount} / {limit}
                      {full && <span className="ml-1 font-medium">· at limit</span>}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 bg-surface-2">
                    <motion.div
                      className={cn("h-full", full ? "bg-signal" : "bg-teal")}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, (u.openLeadCount / limit) * 100)}%` }}
                      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </div>
                  <p className="mt-1.5 text-[12.5px] text-ink-soft">Backup: {backup?.name ?? "none set"}</p>
                </div>
                <div className="flex flex-wrap gap-1.5 md:justify-end">
                  <Tooltip content={u.calendarStatus === "CONNECTED" ? "Can be booked for appointments" : u.calendarStatus === "NEEDS_RECONNECT" ? "Google connection expired; can't be booked until reconnected" : "No calendar connected; can't be booked"}>
                    <span tabIndex={0}>
                      <Tag tone={u.calendarStatus === "CONNECTED" ? "ok" : u.calendarStatus === "NEEDS_RECONNECT" ? "signal" : "off"} shape={u.calendarStatus === "CONNECTED" ? "check" : u.calendarStatus === "NEEDS_RECONNECT" ? "cross" : "ring"}>
                        Calendar{u.calendarStatus === "NEEDS_RECONNECT" ? ": reconnect" : u.calendarStatus === "NOT_CONNECTED" ? ": none" : ""}
                      </Tag>
                    </span>
                  </Tooltip>
                  <Tooltip content={u.telegramLinked ? "Gets escalation alerts in Telegram" : "Won't get escalation alerts until they link Telegram"}>
                    <span tabIndex={0}>
                      <Tag tone={u.telegramLinked ? "ok" : "off"} shape={u.telegramLinked ? "check" : "ring"}>
                        Telegram{u.telegramLinked ? "" : ": not linked"}
                      </Tag>
                    </span>
                  </Tooltip>
                </div>
              </motion.li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
