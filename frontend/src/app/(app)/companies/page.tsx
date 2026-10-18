"use client";

import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/ui/misc";

export default function CompaniesPage() {
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q);
  const [page, setPage] = useState(1);
  const companies = useQuery({ queryKey: ["companies", dq, page], queryFn: () => api().companies.list({ q: dq || undefined, page, pageSize: 24 }), placeholderData: keepPreviousData });
  const pages = Math.max(1, Math.ceil((companies.data?.meta.total ?? 0) / 24));
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Companies" description="Businesses your contacts work for, with their people and open deals." />
      <label className="relative mb-4 block max-w-sm">
        <span className="sr-only">Search companies</span>
        <MagnifyingGlassIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft" aria-hidden />
        <Input value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="Name or city" className="pl-9" />
      </label>
      {companies.isPending ? (
        <ListSkeleton />
      ) : companies.isError ? (
        <ErrorState error={companies.error} onRetry={() => companies.refetch()} />
      ) : companies.data.data.length === 0 ? (
        <EmptyState title="No companies match." />
      ) : (
        <ul className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
          {companies.data.data.map((c) => (
            <li key={c.id} className="bg-paper">
              <Link href={`/companies/${c.id}`} className="block h-full p-5 hover:bg-surface/70">
                <p className="font-semibold text-ink">{c.name}</p>
                <p className="text-[13px] text-ink-soft">
                  {c.industry} · {c.city}
                </p>
                <p className="tabular mt-4 text-sm text-ink">
                  {c.contactCount} contact{c.contactCount === 1 ? "" : "s"} · {c.openOpportunityCount} open deal{c.openOpportunityCount === 1 ? "" : "s"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="tabular text-sm text-ink-soft">
            Page {page} of {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </nav>
      )}
    </div>
  );
}
