"use client";

import { FlaskIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { Popover } from "radix-ui";
import { toast } from "sonner";
import { API_MODE } from "@/lib/api";
import { mockDemo } from "@/lib/api/mock";
import { Button } from "@/components/ui/button";

/** Only rendered in mock mode: stands in for provider webhooks until the backend is connected. */
export function DemoPanel({ placement = "sidebar" }: { placement?: "sidebar" | "header" }) {
  const qc = useQueryClient();
  if (API_MODE !== "mock") return null;
  const refresh = () => void qc.invalidateQueries();
  const run = (label: string, fn: () => unknown) => () => {
    const r = fn();
    refresh();
    if (r === null) toast("Nothing to update", { description: "There is no payment in the right state for that event." });
    else toast(label);
  };
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        {placement === "sidebar" ? (
          <button className="flex h-9 w-full items-center gap-2 rounded-[3px] bg-ink px-3 text-[13px] font-medium text-paper hover:bg-teal" aria-label="Open demo controls">
            <FlaskIcon size={16} weight="fill" aria-hidden /> Demo controls
          </button>
        ) : (
          <button className="rounded-[3px] p-2 text-ink hover:bg-surface" aria-label="Open demo controls">
            <FlaskIcon size={20} weight="fill" aria-hidden />
          </button>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side={placement === "sidebar" ? "right" : "bottom"} align={placement === "sidebar" ? "end" : "end"} sideOffset={10} className="z-50 w-[min(92vw,340px)] rounded-[3px] bg-ink p-4 text-paper shadow-[0_24px_64px_-24px_rgba(0,0,0,0.6)] data-[state=open]:animate-[pop-in_160ms_ease-out]">
          <p className="text-sm font-semibold">Simulated provider events</p>
          <p className="mt-1 text-[13px] text-paper/70">The backend isn&apos;t connected, so these buttons play the part of Twilio, Stripe and the public form.</p>
          <div className="mt-4 grid grid-cols-1 gap-2">
            <Button size="sm" variant="secondary" onClick={run("Web form lead submitted", () => mockDemo.webLead())}>
              New web-form lead
            </Button>
            <Button size="sm" variant="secondary" onClick={run("WhatsApp from an unknown number", () => mockDemo.inboundWhatsApp(false))}>
              WhatsApp from a new number
            </Button>
            <Button size="sm" variant="secondary" onClick={run("WhatsApp reply received", () => mockDemo.inboundWhatsApp(true))}>
              WhatsApp reply from a customer
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="secondary" onClick={run("Stripe: checkout completed", () => mockDemo.stripe("PAID"))}>
                Stripe: paid
              </Button>
              <Button size="sm" variant="secondary" onClick={run("Stripe: session expired", () => mockDemo.stripe("EXPIRED"))}>
                Stripe: expired
              </Button>
              <Button size="sm" variant="secondary" onClick={run("Stripe: payment failed", () => mockDemo.stripe("FAILED"))}>
                Stripe: failed
              </Button>
              <Button size="sm" variant="secondary" onClick={run("Stripe: charge refunded", () => mockDemo.stripe("REFUNDED"))}>
                Stripe: refund
              </Button>
            </div>
            <Button size="sm" variant="secondary" onClick={run("Ack window set to 20 seconds", () => mockDemo.setAckWindow(20))}>
              Fast timers (20 s windows)
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-paper/70 hover:bg-paper/10 hover:text-paper"
              onClick={() => {
                mockDemo.reset();
                window.location.href = "/login";
              }}
            >
              Reset demo data
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
