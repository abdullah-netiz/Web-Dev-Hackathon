"use client";

import { ArrowLeftIcon, GlobeSimpleIcon, MapPinIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import Link from "next/link";
import { use, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useCan } from "@/lib/session";
import { formatCompactMoney, formatMoney, timeAgo } from "@/lib/utils";
import { CompanyMark } from "@/components/crm/company-mark";
import { Avatar, ErrorState, Skeleton } from "@/components/ui/misc";
import { Tag } from "@/components/ui/status";

function Panel({ title, count, children, i }: { title: string; count: number; children: ReactNode; i: number }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 + i * 0.06, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      aria-label={title}
      className="overflow-hidden rounded-[6px] bg-paper ring-1 ring-line"
    >
      <header className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        <span className="tabular rounded-[3px] bg-surface px-2 text-[13px] leading-6 font-semibold text-ink-soft">{count}</span>
      </header>
      {children}
    </motion.section>
  );
}

export default function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const q = useQuery({ queryKey: ["company", id], queryFn: () => api().companies.get(id) });
  const pipelines = useQuery({ queryKey: ["pipelines"], queryFn: () => api().pipelines.list() });

  if (q.isPending)
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <Skeleton className="h-40 rounded-[6px]" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-72 rounded-[6px]" />
          <Skeleton className="h-72 rounded-[6px]" />
        </div>
      </div>
    );
  if (q.isError) return <ErrorState className="mx-auto max-w-3xl" error={q.error} onRetry={() => q.refetch()} />;

  const { company: c, contacts, opportunities } = q.data;
  const stages = new Map((pipelines.data ?? []).flatMap((p) => p.stages.map((s) => [s.id, s] as const)));
  const canValues = can("crm.view_values");
  const open = opportunities.filter((o) => {
    const s = stages.get(o.stageId);
    return s && !s.isWon && !s.isLost;
  });
  const openValue = open.reduce((s, o) => s + (o.value ?? 0), 0);
  const wonValue = opportunities.filter((o) => stages.get(o.stageId)?.isWon).reduce((s, o) => s + (o.value ?? 0), 0);

  const stats = [
    { label: "People", value: String(contacts.length) },
    { label: "Open deals", value: String(open.length) },
    { label: "Open pipeline", value: canValues ? formatCompactMoney(openValue) : "Hidden" },
    { label: "Won", value: canValues ? formatCompactMoney(wonValue) : "Hidden" },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/companies" className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
        <ArrowLeftIcon size={14} aria-hidden /> Companies
      </Link>

      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="mt-4 overflow-hidden rounded-[6px] bg-paper ring-1 ring-line"
      >
        <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center md:p-8">
          <CompanyMark name={c.name} size={72} />
          <div className="min-w-0">
            <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.02em] text-ink md:text-[38px]">{c.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-ink-soft">
              {c.industry && <Tag>{c.industry}</Tag>}
              {c.city && (
                <span className="inline-flex items-center gap-1">
                  <MapPinIcon size={15} aria-hidden /> {c.city}
                </span>
              )}
              {c.domain && (
                <a href={`https://${c.domain}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-teal hover:underline">
                  <GlobeSimpleIcon size={15} aria-hidden /> {c.domain}
                </a>
              )}
              <span>Customer since {new Date(c.createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-2 border-t border-line bg-surface/50 md:grid-cols-4">
          {stats.map((s, i) => (
            <div key={s.label} className={`px-6 py-4 ${i % 2 ? "border-l border-line" : ""} ${i >= 2 ? "border-t border-line md:border-t-0" : ""} ${i === 2 ? "md:border-l" : ""}`}>
              <dt className="text-[12.5px] text-ink-soft">{s.label}</dt>
              <dd className="tabular mt-0.5 text-2xl font-semibold tracking-[-0.02em] text-ink">{s.value}</dd>
            </div>
          ))}
        </dl>
      </motion.header>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <Panel title="People" count={contacts.length} i={0}>
          {contacts.length ? (
            <ul>
              {contacts.map((p) => (
                <li key={p.id} className="border-b border-line last:border-0">
                  <Link href={`/contacts/${p.id}`} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface/70">
                    <Avatar name={`${p.firstName} ${p.lastName}`} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {p.firstName} {p.lastName}
                      </span>
                      <span className="block truncate text-[12.5px] text-ink-soft">{p.email ?? p.phone}</span>
                    </span>
                    <span className="hidden text-right text-[12.5px] text-ink-soft sm:block">
                      {p.ownerName ?? "Unassigned"}
                      <span className="block">{p.lastActivityAt ? timeAgo(p.lastActivityAt) : ""}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-6 text-sm text-ink-soft">Nobody linked yet.</p>
          )}
        </Panel>
        <Panel title="Opportunities" count={opportunities.length} i={1}>
          {opportunities.length ? (
            <ul>
              {opportunities.map((o) => {
                const s = stages.get(o.stageId);
                return (
                  <li key={o.id} className="border-b border-line last:border-0">
                    <Link href={`/opportunities/${o.id}`} className="flex items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-surface/70">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-ink">{o.name}</span>
                        <span className="mt-1 flex items-center gap-2 text-[12.5px] text-ink-soft">
                          {s && (
                            <Tag tone={s.isWon ? "ok" : s.isLost ? "off" : "teal"} shape={s.isWon ? "check" : s.isLost ? "cross" : "dot"}>
                              {s.name}
                            </Tag>
                          )}
                          {o.ownerName}
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-sm font-semibold text-ink">{o.value != null ? formatMoney(o.value, o.currency) : <span className="font-normal text-ink-faint">Hidden</span>}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-5 py-6 text-sm text-ink-soft">No deals yet.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
