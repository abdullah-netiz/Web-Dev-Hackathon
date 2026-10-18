"use client";

import { CheckCircleIcon, ClockIcon, XCircleIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { api, describeError } from "@/lib/api";
import { formatMoney } from "@/lib/utils";

function Result() {
  const { result } = useParams<{ result: string }>();
  const params = useSearchParams();
  const session = params.get("session_id") ?? "";
  const q = useQuery({
    queryKey: ["pay", session],
    queryFn: () => api().public.paymentStatus(session),
    enabled: !!session,
    retry: false,
    refetchInterval: (query) => (query.state.data?.status === "PENDING" ? 2000 : false),
  });
  const cancelled = result === "cancelled";
  const status = q.data?.status;

  let icon = <ClockIcon size={48} weight="fill" className="text-teal" aria-hidden />;
  let title = "Confirming your payment…";
  let body = "Stripe is confirming the payment with us. This page updates by itself in a few seconds.";
  if (cancelled && status !== "PAID") {
    icon = <XCircleIcon size={48} weight="fill" className="text-off" aria-hidden />;
    title = "No payment was taken.";
    body = "You left the payment page before paying. The link in your message still works until it expires.";
  } else if (status === "PAID") {
    icon = <CheckCircleIcon size={48} weight="fill" className="text-ok" aria-hidden />;
    title = "Payment received. Thank you.";
    body = "Stripe has confirmed it and the team can see it now. A receipt is on its way from Stripe.";
  } else if (status === "EXPIRED" || status === "FAILED") {
    icon = <XCircleIcon size={48} weight="fill" className="text-signal" aria-hidden />;
    title = status === "EXPIRED" ? "This payment link expired." : "The payment didn't go through.";
    body = "Nothing was charged. Ask for a new link and try again.";
  } else if (q.isError) {
    icon = <XCircleIcon size={48} weight="fill" className="text-signal" aria-hidden />;
    title = "We couldn't look up this payment.";
    body = describeError(q.error).title;
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-5" aria-live="polite">
      {icon}
      <h1 className="display mt-6 text-[44px] text-ink sm:text-[60px]">{title}</h1>
      {q.data && (
        <p className="tabular mt-6 text-2xl font-semibold text-ink">
          {formatMoney(q.data.amount, q.data.currency)} <span className="text-base font-normal text-ink-soft">to {q.data.workspaceName}</span>
        </p>
      )}
      <p className="mt-4 text-lg leading-relaxed text-ink-soft">{body}</p>
      <p className="mt-10 text-[13px] text-ink-faint">Card details are handled by Stripe and never reach us.</p>
    </main>
  );
}

export default function PayResultPage() {
  return (
    <Suspense>
      <Result />
    </Suspense>
  );
}
