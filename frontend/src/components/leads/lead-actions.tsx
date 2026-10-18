"use client";

import { ArrowsLeftRightIcon, CheckIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, describeError } from "@/lib/api";
import type { Lead } from "@/lib/api/types";
import { useCan, useMe } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui/menu";
import { AvailabilityTag } from "@/components/ui/status";

function useLeadMutation<T>(fn: (v: T) => Promise<Lead>, success: (l: Lead) => string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (l) => {
      toast.success(success(l));
      for (const k of ["leads", "lead", "recovery", "dashboard", "members"]) void qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => {
      const d = describeError(e);
      toast.error(d.title, { description: d.action });
      void qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

export function AcknowledgeButton({ lead, size = "sm" }: { lead: Lead; size?: "sm" | "md" | "lg" }) {
  const me = useMe();
  const m = useLeadMutation((id: string) => api().leads.acknowledge(id), (l) => `Acknowledged ${l.contactName}. The clock has stopped.`);
  if (lead.status !== "ASSIGNED" || lead.ownerId !== me.user.id) return null;
  return (
    <Button size={size} loading={m.isPending} onClick={() => m.mutate(lead.id)}>
      <CheckIcon size={16} weight="bold" aria-hidden /> Acknowledge
    </Button>
  );
}

export function ReassignMenu({ lead, size = "sm" }: { lead: Lead; size?: "sm" | "md" }) {
  const can = useCan();
  const members = useQuery({ queryKey: ["members"], queryFn: () => api().members.list(), enabled: can("leads.reassign") });
  const m = useLeadMutation(({ id, userId }: { id: string; userId: string }) => api().leads.reassign(id, userId), (l) => `${l.contactName} is now with ${l.ownerName}.`);
  if (!can("leads.reassign") || lead.status === "CLOSED") return null;
  const options = (members.data ?? []).filter((u) => u.active && u.id !== lead.ownerId);
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="outline" size={size} loading={m.isPending}>
          <ArrowsLeftRightIcon size={16} aria-hidden /> Reassign
        </Button>
      </MenuTrigger>
      <MenuContent className="w-72">
        <MenuLabel>Hand {lead.contactName} to…</MenuLabel>
        {options.map((u) => {
          const away = u.availability === "ON_LEAVE" || u.availability === "OFFLINE";
          return (
            <MenuItem key={u.id} disabled={away} onSelect={() => m.mutate({ id: lead.id, userId: u.id })} className="justify-between">
              <span className="min-w-0">
                <span className="block truncate">{u.name}</span>
                <span className="block text-[12px] text-ink-soft">{u.openLeadCount} open leads</span>
              </span>
              <AvailabilityTag value={u.availability} />
            </MenuItem>
          );
        })}
      </MenuContent>
    </Menu>
  );
}

export function CloseLeadButton({ lead }: { lead: Lead }) {
  const me = useMe();
  const can = useCan();
  const m = useLeadMutation((id: string) => api().leads.close(id), (l) => `${l.contactName} closed.`);
  if (lead.status === "CLOSED" || (lead.ownerId !== me.user.id && !can("leads.reassign"))) return null;
  return (
    <Button variant="ghost" size="sm" loading={m.isPending} onClick={() => m.mutate(lead.id)}>
      Close lead
    </Button>
  );
}
