"use client";

import { CopyIcon, CreditCardIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { api, describeError } from "@/lib/api";
import type { Opportunity, Payment } from "@/lib/api/types";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";

export function PaymentDialog({ opportunity }: { opportunity: Opportunity }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(opportunity.currency || "USD");
  const [created, setCreated] = useState<Payment | null>(null);
  const n = Number(amount);
  const invalid = amount !== "" && (!(n > 0) || n > 999_999);
  const m = useMutation({
    mutationFn: () => api().payments.request({ opportunityId: opportunity.id, amount: n, currency }),
    onSuccess: (p) => {
      setCreated(p);
      for (const k of ["payments", "opportunity", "contact", "dashboard"]) void qc.invalidateQueries({ queryKey: [k] });
    },
  });
  const err = m.error ? describeError(m.error) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setCreated(null);
          setAmount("");
          m.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <CreditCardIcon size={16} aria-hidden /> Request payment
        </Button>
      </DialogTrigger>
      <DialogContent title="Request a payment" description={`For ${opportunity.name}. The customer pays on Stripe's page; card details never touch Baton.`}>
        {created ? (
          <div className="flex flex-col gap-4">
            <div className="bg-surface p-4">
              <p className="text-sm text-ink-soft">Checkout link for {created.contactName}</p>
              <p className="tabular mt-1 text-3xl font-semibold text-ink">{formatMoney(created.amount, created.currency)}</p>
              <p className="mt-3 text-[13px] break-all text-ink">{created.checkoutUrl}</p>
            </div>
            <p className="text-sm text-ink-soft">
              The status changes to Paid on its own when Stripe confirms it. No need to refresh. Unpaid links expire after 24 hours.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(created.checkoutUrl ?? "");
                  toast.success("Link copied", { description: "Paste it into WhatsApp or an email." });
                }}
              >
                <CopyIcon size={16} aria-hidden /> Copy link
              </Button>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!invalid && n > 0) m.mutate();
            }}
            className="flex flex-col gap-4"
            noValidate
          >
            <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
              <Field label="Amount" required error={invalid ? (n > 999_999 ? "Stripe test mode accepts up to 999,999 per payment." : "Enter an amount greater than zero.") : undefined}>
                {(p) => <Input {...p} type="number" inputMode="decimal" min="0.5" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2500" autoFocus />}
              </Field>
              <Field label="Currency">
                {(p) => (
                  <Select {...p} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    {["USD", "EUR", "GBP", "CAD", "AUD", "PKR"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            {err && (
              <p role="alert" className="rounded-[3px] bg-signal-tint px-3 py-2 text-sm text-signal">
                {err.title} {err.action}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={m.isPending} disabled={!amount || invalid}>
                Create checkout link
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
