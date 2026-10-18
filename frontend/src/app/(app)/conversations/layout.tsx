"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { api } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";
import { Avatar, ErrorState, ListSkeleton } from "@/components/ui/misc";

export default function ConversationsLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ id?: string }>();
  const list = useQuery({ queryKey: ["conversations"], queryFn: () => api().conversations.list() });
  return (
    <div className="mx-auto grid max-w-7xl gap-px bg-line lg:h-[calc(100dvh-112px)] lg:grid-cols-[22rem_minmax(0,1fr)]">
      <aside className={cn("flex min-h-0 flex-col bg-paper", params.id && "hidden lg:flex")} aria-label="Conversations">
        <div className="pb-4 lg:pr-4">
          <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-ink">Conversations</h1>
          <p className="mt-1 text-sm text-ink-soft">WhatsApp threads you're allowed to see.</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto lg:pr-2">
          {list.isPending ? (
            <ListSkeleton rows={8} />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : list.data.length === 0 ? (
            <p className="py-6 text-sm text-ink-soft">No conversations yet. Messages to your WhatsApp sandbox number appear here.</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {list.data.map((c) => {
                const active = c.id === params.id;
                return (
                  <li key={c.id}>
                    <Link
                      href={`/conversations/${c.id}`}
                      aria-current={active ? "page" : undefined}
                      className={cn("flex gap-3 rounded-[3px] p-3 transition-colors", active ? "bg-surface" : "hover:bg-surface/60")}
                    >
                      <Avatar name={c.contactName} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={cn("truncate text-sm text-ink", c.unreadCount ? "font-semibold" : "font-medium")}>{c.contactName}</span>
                          <span className="shrink-0 text-[12px] text-ink-soft">{timeAgo(c.lastMessageAt)}</span>
                        </span>
                        <span className="mt-0.5 flex items-center justify-between gap-2">
                          <span className={cn("truncate text-[13px]", c.unreadCount ? "text-ink" : "text-ink-soft")}>{c.optedOut ? "Opted out" : c.lastMessagePreview}</span>
                          {c.unreadCount > 0 && (
                            <span className="tabular rounded-[3px] bg-teal px-1.5 text-[11px] leading-5 font-semibold text-on-teal" aria-label={`${c.unreadCount} unread`}>
                              {c.unreadCount}
                            </span>
                          )}
                        </span>
                        <span className="text-[12px] text-ink-faint">{c.assigneeName ?? "Unassigned"}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
      <section className={cn("min-h-0 bg-paper", !params.id && "hidden lg:block")}>{children}</section>
    </div>
  );
}
