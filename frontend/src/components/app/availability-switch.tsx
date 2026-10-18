"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, describeError } from "@/lib/api";
import type { Availability, User } from "@/lib/api/types";
import { Menu, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@/components/ui/menu";
import { AVAILABILITY, AvailabilityTag } from "@/components/ui/status";

const OPTIONS: Availability[] = ["AVAILABLE", "BUSY", "ON_LEAVE", "OFFLINE"];

export function useSetAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ user, value }: { user: User; value: Availability }) => api().members.setAvailability(user.id, value),
    onSuccess: (u, { user }) => {
      void qc.invalidateQueries({ queryKey: ["members"] });
      void qc.invalidateQueries({ queryKey: ["session"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      const away = u.availability === "ON_LEAVE" || u.availability === "OFFLINE";
      toast.success(`${user.name} is now ${AVAILABILITY[u.availability].label.toLowerCase()}`, {
        description: away ? "Their unacknowledged leads were handed to available teammates." : u.availability === "AVAILABLE" ? "New leads can be assigned again." : "No new leads while busy; current leads stay.",
      });
    },
    onError: (e) => {
      const d = describeError(e);
      toast.error(d.title, { description: d.action });
    },
  });
}

export function AvailabilitySwitch({ user, compact }: { user: User; compact?: boolean }) {
  const m = useSetAvailability();
  return (
    <Menu>
      <MenuTrigger
        className="group flex w-full items-center justify-between gap-2 rounded-[3px] px-2 py-1.5 text-left hover:bg-surface-2 disabled:opacity-60"
        disabled={m.isPending}
        aria-label={`Your availability: ${AVAILABILITY[user.availability].label}. Change`}
      >
        {!compact && <span className="text-[13px] text-ink-soft">Status</span>}
        <AvailabilityTag value={user.availability} />
      </MenuTrigger>
      <MenuContent align="start">
        <MenuLabel>Leads are only assigned while you're Available.</MenuLabel>
        <MenuRadioGroup value={user.availability} onValueChange={(v) => m.mutate({ user, value: v as Availability })}>
          {OPTIONS.map((o) => (
            <MenuRadioItem key={o} value={o}>
              {AVAILABILITY[o].label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}
