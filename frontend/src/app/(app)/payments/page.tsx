"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api } from "@/lib/api";
import type { PaymentStatus } from "@/lib/api/types";
import { formatDateTime, formatMoney } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/controls";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/ui/misc";
import { PaymentTag } from "@/components/ui/status";

function Payments() {
  const params = useSearchParams();
  const [status, setStatus] = useState<PaymentStatus | "">((params.get("status") as PaymentStatus) ?? "");
  const all = useQuery({ queryKey: ["payments", "all"], queryFn: () => api().payments.list() });
  const rows = (all.data ?? []).filter((p) => !status || p.status === status);
  const month = new Date();
  month.setDate(1);
  month.setHours(0, 0, 0, 0);
  const collected = (all.data ?? []).filter((p) => p.paidAt && new Date(p.paidAt) >= month && ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status)).reduce((s, p) => s + p.amount - p.refundedAmount, 0);
  const awaiting = (all.data ?? []).filter((p) => p.status === "PENDING").reduce((s, p) => s + p.amount, 0);
  const refunded = (all.data ?? []).reduce((s, p) => s + p.refundedAmount, 0);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Payments" description="Payment requests sent through Stripe. Statuses change only when Stripe confirms them." />
      <dl className="mb-8 grid gap-px bg-line sm:grid-cols-3">
        <div className="bg-paper p-5">
          <dt className="text-sm text-ink-soft">Collected this month</dt>
          <dd className="tabular mt-2 text-4xl font-semibold tracking-[-0.02em] text-ok">{formatMoney(collected)}</dd>
          <dd className="mt-1 text-[13px] text-ink-soft">Confirmed by Stripe, minus refunds</dd>
        </div>
        <div className="bg-paper p-5">
          <dt className="text-sm text-ink-soft">Awaiting payment</dt>
          <dd className="tabular mt-2 text-4xl font-semibold tracking-[-0.02em] text-ink">{formatMoney(awaiting)}</dd>
          <dd className="mt-1 text-[13px] text-ink-soft">Projected, not counted as revenue</dd>
        </div>
        <div className="bg-paper p-5">
          <dt className="text-sm text-ink-soft">Refunded, all time</dt>
          <dd className="tabular mt-2 text-4xl font-semibold tracking-[-0.02em] text-ink">{formatMoney(refunded)}</dd>
          <dd className="mt-1 text-[13px] text-ink-soft">Refunds made in the Stripe dashboard show up here</dd>
        </div>
      </dl>
      <Tabs value={status} onValueChange={(v) => setStatus(v as PaymentStatus | "")} className="mb-4">
        <TabsList aria-label="Payment status" className="w-fit max-w-full">
          <TabsTrigger value="">All</TabsTrigger>
          <TabsTrigger value="PENDING">Awaiting</TabsTrigger>
          <TabsTrigger value="PAID">Paid</TabsTrigger>
          <TabsTrigger value="EXPIRED">Expired</TabsTrigger>
          <TabsTrigger value="FAILED">Failed</TabsTrigger>
          <TabsTrigger value="REFUNDED">Refunded</TabsTrigger>
        </TabsList>
      </Tabs>
      {all.isPending ? (
        <ListSkeleton />
      ) : all.isError ? (
        <ErrorState error={all.error} onRetry={() => all.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="No payments here." body="Request a payment from any opportunity." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[13px] text-ink-soft">
                <th scope="col" className="py-2.5 pr-4 font-medium">Amount</th>
                <th scope="col" className="py-2.5 pr-4 font-medium">Status</th>
                <th scope="col" className="py-2.5 pr-4 font-medium">Opportunity · contact</th>
                <th scope="col" className="py-2.5 pr-4 font-medium">Requested by</th>
                <th scope="col" className="py-2.5 font-medium">Stripe reference</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-line/70 align-top">
                  <td className="tabular py-3 pr-4 font-semibold text-ink">
                    {formatMoney(p.amount, p.currency)}
                    {p.refundedAmount > 0 && <span className="block text-[12.5px] font-normal text-ink-soft">−{formatMoney(p.refundedAmount, p.currency)} refunded</span>}
                  </td>
                  <td className="py-3 pr-4">
                    <PaymentTag value={p.status} />
                    <span className="mt-1 block text-[12.5px] text-ink-soft">{p.paidAt ? `paid ${formatDateTime(p.paidAt)}` : `sent ${formatDateTime(p.createdAt)}`}</span>
                  </td>
                  <td className="py-3 pr-4">
                    <Link href={`/opportunities/${p.opportunityId}`} className="text-ink hover:underline">
                      {p.opportunityName}
                    </Link>
                    <Link href={`/contacts/${p.contactId}`} className="block text-[13px] text-ink-soft hover:underline">
                      {p.contactName}
                    </Link>
                  </td>
                  <td className="py-3 pr-4 text-ink">{p.requestedByName}</td>
                  <td className="py-3 text-[13px] break-all text-ink-soft">{p.stripeSessionId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function PaymentsPage() {
  return (
    <Suspense>
      <Payments />
    </Suspense>
  );
}
