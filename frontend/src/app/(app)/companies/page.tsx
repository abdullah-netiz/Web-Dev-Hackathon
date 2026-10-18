"use client";

import { ArrowUpRightIcon, MagnifyingGlassIcon, MapPinIcon } from "@phosphor-icons/react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { toast } from "sonner";
import { api, describeError } from "@/lib/api";
import { useCan } from "@/lib/session";
import { cn } from "@/lib/utils";
import { CompanyMark } from "@/components/crm/company-mark";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui/misc";

const PAGE = 24;

function NewCompany({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({ name: "", domain: "", industry: "", city: "" });
  const m = useMutation({
    mutationFn: () => api().companies.create(v),
    onSuccess: (c) => {
      toast.success(`${c.name} added`);
      void qc.invalidateQueries({ queryKey: ["companies"] });
      setV({ name: "", domain: "", industry: "", city: "" });
      onOpenChange(false);
    },
  });
  const err = m.error ? describeError(m.error) : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="New company" description="Link contacts to it from their record.">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (v.name.trim()) m.mutate();
          }}
        >
          <Field label="Name" required>{(p) => <Input {...p} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Industry">{(p) => <Input {...p} value={v.industry} onChange={(e) => setV({ ...v, industry: e.target.value })} />}</Field>
            <Field label="City">{(p) => <Input {...p} value={v.city} onChange={(e) => setV({ ...v, city: e.target.value })} />}</Field>
          </div>
          <Field label="Website" hint="e.g. harborlogistics.com">{(p) => <Input {...p} value={v.domain} onChange={(e) => setV({ ...v, domain: e.target.value })} />}</Field>
          {err && (
            <p role="alert" className="rounded-[3px] bg-signal-tint px-3 py-2 text-sm text-signal">
              {err.title} {err.action}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={m.isPending} disabled={!v.name.trim()}>
              Add company
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function CompaniesPage() {
  const can = useCan();
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const companies = useQuery({ queryKey: ["companies", dq, page], queryFn: () => api().companies.list({ q: dq || undefined, page, pageSize: PAGE }), placeholderData: keepPreviousData });
  const total = companies.data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Companies"
        description="Businesses your contacts work for, with their people and open deals."
        actions={can("crm.create") && <Button onClick={() => setCreating(true)}>New company</Button>}
      />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block w-full max-w-sm">
          <span className="sr-only">Search companies</span>
          <MagnifyingGlassIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft" aria-hidden />
          <Input value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="Name or city" className="pl-9" />
        </label>
        {companies.data && (
          <p className="text-sm text-ink-soft" aria-live="polite">
            <span className="tabular font-semibold text-ink">{total}</span> {total === 1 ? "company" : "companies"}
          </p>
        )}
      </div>

      {companies.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-44 rounded-[6px]" />
          ))}
        </div>
      ) : companies.isError ? (
        <ErrorState error={companies.error} onRetry={() => companies.refetch()} />
      ) : companies.data.data.length === 0 ? (
        <EmptyState title="No companies match." body="Try another name or city." />
      ) : (
        <ul className={cn("grid gap-4 transition-opacity sm:grid-cols-2 xl:grid-cols-3", (companies.isFetching || q !== dq) && "opacity-70")}>
          {companies.data.data.map((c, i) => (
            <motion.li
              key={c.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 12) * 0.03, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              <Link
                href={`/companies/${c.id}`}
                className="group flex h-full flex-col rounded-[6px] bg-paper p-5 ring-1 ring-line transition-[box-shadow,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:ring-teal/60 focus-visible:ring-2 focus-visible:ring-teal"
              >
                <div className="flex items-start gap-3.5">
                  <CompanyMark name={c.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[16px] font-semibold text-ink">{c.name}</p>
                    <p className="truncate text-[13px] text-ink-soft">{c.domain ?? "No website"}</p>
                  </div>
                  <ArrowUpRightIcon size={16} className="mt-1 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-teal" aria-hidden />
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-soft">
                  {c.industry && <span className="rounded-[3px] bg-surface px-2 py-0.5 font-medium text-ink">{c.industry}</span>}
                  {c.city && (
                    <span className="inline-flex items-center gap-1">
                      <MapPinIcon size={14} aria-hidden /> {c.city}
                    </span>
                  )}
                </div>
                <div className="min-h-5 flex-1" />
                <dl className="grid grid-cols-2 border-t border-line pt-4">
                  <div>
                    <dt className="text-[12px] text-ink-soft">Contacts</dt>
                    <dd className="tabular text-xl font-semibold text-ink">{c.contactCount}</dd>
                  </div>
                  <div className="border-l border-line pl-4">
                    <dt className="text-[12px] text-ink-soft">Open deals</dt>
                    <dd className={cn("tabular text-xl font-semibold", c.openOpportunityCount ? "text-teal" : "text-ink")}>{c.openOpportunityCount}</dd>
                  </div>
                </dl>
              </Link>
            </motion.li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="mt-6 flex items-center justify-between">
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
      <NewCompany open={creating} onOpenChange={setCreating} />
    </div>
  );
}
