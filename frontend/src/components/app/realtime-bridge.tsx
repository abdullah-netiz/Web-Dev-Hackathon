"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { RealtimeEvent } from "@/lib/api/types";
import { useMe } from "@/lib/session";
import { formatClock } from "@/lib/utils";

export function RealtimeBridge() {
  const qc = useQueryClient();
  const me = useMe();
  const router = useRouter();

  useEffect(() => {
    const myId = me.user.id;
    const invalidate = (...keys: string[]) => {
      for (const k of keys) void qc.invalidateQueries({ queryKey: [k] });
    };
    const secondsLeft = (iso?: string) => (iso ? (new Date(iso).getTime() - Date.now()) / 1000 : 0);

    return api().realtime.subscribe((e: RealtimeEvent) => {
      switch (e.type) {
        case "lead:created":
        case "lead:assigned":
        case "lead:acknowledged":
        case "lead:escalated":
          invalidate("leads", "lead", "recovery", "dashboard", "members", "contact", "audit");
          if ((e.type === "lead:assigned" || e.type === "lead:escalated") && e.lead.ownerId === myId && e.lead.status === "ASSIGNED") {
            const escalated = e.type === "lead:escalated";
            toast(escalated ? `Escalated to you: ${e.lead.contactName}` : `New lead: ${e.lead.contactName}`, {
              description: escalated
                ? `${e.fromUserName ?? "The previous owner"} didn't respond. Acknowledge within ${formatClock(secondsLeft(e.lead.current?.dueAt))}.`
                : `Acknowledge within ${formatClock(secondsLeft(e.lead.current?.dueAt))}.`,
              action: { label: "Open", onClick: () => router.push(`/leads/${e.lead.id}`) },
              duration: 9000,
            });
          }
          break;
        case "message:new":
          invalidate("conversations", "conversation", "contact");
          toast(`New WhatsApp message`, {
            description: e.message.body.slice(0, 90),
            action: { label: "Reply", onClick: () => router.push(`/conversations/${e.conversationId}`) },
          });
          break;
        case "message:status":
          invalidate("conversation", "conversations");
          if (e.message.status === "FAILED" && e.message.sentById === myId) {
            toast.error("A WhatsApp message failed to send", {
              description: e.message.errorMessage ?? undefined,
              action: { label: "View", onClick: () => router.push(`/conversations/${e.message.conversationId}`) },
            });
          }
          break;
        case "payment:updated":
          invalidate("payments", "dashboard", "opportunity", "contact", "opportunities");
          if (e.payment.status === "PAID") {
            toast.success(`Payment received from ${e.payment.contactName}`, {
              description: e.payment.amount === null ? undefined : new Intl.NumberFormat(undefined, { style: "currency", currency: e.payment.currency }).format(e.payment.amount),
            });
          }
          break;
        case "availability:changed":
          invalidate("members", "dashboard", "leads", "recovery");
          if (e.user.id === myId) void qc.invalidateQueries({ queryKey: ["session"] });
          break;
        case "opportunity:updated":
          invalidate("opportunities", "opportunity", "dashboard");
          break;
        case "integration:updated":
          invalidate("integrations");
          break;
        case "refresh":
          invalidate(...e.keys);
          break;
      }
    });
  }, [qc, me.user.id, router]);

  return null;
}
