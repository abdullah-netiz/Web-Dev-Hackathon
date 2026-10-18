"use client";

import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use } from "react";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/utils";
import { Avatar, ErrorState, Skeleton } from "@/components/ui/misc";

export default function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ["company", id], queryFn: () => api().companies.get(id) });
  if (q.isPending) return <Skeleton className="mx-auto h-80 max-w-5xl" />;
  if (q.isError) return <ErrorState className="mx-auto max-w-3xl" error={q.error} onRetry={() => q.refetch()} />;
  const { company: c, contacts, opportunities } = q.data;
  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/companies" className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
        <ArrowLeftIcon size={14} aria-hidden /> Companies
      </Link>
      <header className="mt-4 bg-surface p-6 md:p-8">
        <h1 className="text-[32px] font-semibold tracking-[-0.02em] text-ink md:text-[40px]">{c.name}</h1>
        <p className="mt-1 text-ink-soft">
          {c.industry} · {c.city} {c.domain && <>· {c.domain}</>}
        </p>
      </header>
      <div className="mt-8 grid gap-10 md:grid-cols-2">
        <section aria-labelledby="ppl">
          <h2 id="ppl" className="text-lg font-semibold text-ink">
            People <span className="font-normal text-ink-soft">{contacts.length}</span>
          </h2>
          <ul className="mt-3 flex flex-col gap-px bg-line">
            {contacts.map((p) => (
              <li key={p.id} className="bg-paper">
                <Link href={`/contacts/${p.id}`} className="flex items-center gap-3 py-3 hover:underline">
                  <Avatar name={`${p.firstName} ${p.lastName}`} size={28} />
                  <span className="text-sm text-ink">
                    {p.firstName} {p.lastName}
                    <span className="block text-[12.5px] text-ink-soft">{p.email}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="deals">
          <h2 id="deals" className="text-lg font-semibold text-ink">
            Opportunities <span className="font-normal text-ink-soft">{opportunities.length}</span>
          </h2>
          <ul className="mt-3 flex flex-col gap-px bg-line">
            {opportunities.map((o) => (
              <li key={o.id} className="bg-paper">
                <Link href={`/opportunities/${o.id}`} className="flex items-center justify-between gap-3 py-3 hover:underline">
                  <span className="text-sm text-ink">{o.name}</span>
                  <span className="tabular text-sm font-semibold text-ink">{o.value != null ? formatMoney(o.value, o.currency) : "Hidden"}</span>
                </Link>
              </li>
            ))}
            {!opportunities.length && <li className="bg-paper py-3 text-sm text-ink-soft">No deals yet.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
