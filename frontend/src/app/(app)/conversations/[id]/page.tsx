"use client";

import { ArrowClockwiseIcon, ArrowLeftIcon, PaperPlaneRightIcon, ProhibitIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, describeError } from "@/lib/api";
import type { Message } from "@/lib/api/types";
import { cn, formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Avatar, ErrorState, Skeleton } from "@/components/ui/misc";
import { MessageStatusTag } from "@/components/ui/status";

function Bubble({ m, onRetry, retrying }: { m: Message; onRetry: () => void; retrying: boolean }) {
  const out = m.direction === "OUTBOUND";
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={cn("flex max-w-[85%] flex-col gap-1 md:max-w-[70%]", out ? "items-end self-end" : "items-start self-start")}
    >
      <div
        className={cn(
          "rounded-[3px] px-3.5 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap",
          out ? (m.status === "FAILED" ? "bg-signal-tint text-ink" : "bg-teal text-on-teal") : "bg-surface text-ink",
        )}
      >
        {m.body}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-ink-soft">
        <time dateTime={m.at}>{formatDateTime(m.at)}</time>
        {out && m.sentByName && <span>· {m.sentByName}</span>}
        {out && <MessageStatusTag value={m.status} className="h-5 text-[11.5px]" />}
      </div>
      {m.status === "FAILED" && (
        <div role="alert" className="max-w-md rounded-[3px] bg-signal-tint p-3 text-[13px] text-ink">
          <p className="font-semibold text-signal">Not delivered{m.errorCode ? ` (error ${m.errorCode})` : ""}</p>
          <p className="mt-0.5">{m.errorMessage ?? "The provider rejected this message."}</p>
          <Button size="sm" variant="outline" className="mt-2" loading={retrying} onClick={onRetry}>
            <ArrowClockwiseIcon size={14} aria-hidden /> Retry
          </Button>
        </div>
      )}
    </motion.li>
  );
}

export default function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ["conversation", id], queryFn: () => api().conversations.get(id) });

  useEffect(() => {
    if (q.data?.conversation.unreadCount) {
      void api()
        .conversations.markRead(id)
        .then(() => qc.invalidateQueries({ queryKey: ["conversations"] }));
    }
  }, [q.data?.conversation.unreadCount, id, qc]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [q.data?.messages.length]);

  const send = useMutation({
    mutationFn: (text: string) => api().conversations.send(id, text),
    onMutate: () => setBody(""),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["conversation", id] });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e, text) => {
      setBody(text);
      const d = describeError(e);
      toast.error(d.title, { description: d.action });
    },
  });
  const retry = useMutation({
    mutationFn: (messageId: string) => api().conversations.retry(messageId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["conversation", id] }),
    onError: (e) => toast.error(describeError(e).title, { description: describeError(e).action }),
  });

  if (q.isPending)
    return (
      <div className="flex flex-col gap-3 p-6">
        <Skeleton className="h-10 w-60" />
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="ml-auto h-16 w-1/2" />
      </div>
    );
  if (q.isError) return <ErrorState className="m-6" error={q.error} onRetry={() => q.refetch()} />;
  const { conversation: c, messages } = q.data;

  return (
    <div className="flex h-full min-h-[70dvh] flex-col lg:pl-6">
      <header className="flex items-center gap-3 pb-4">
        <Link href="/conversations" className="rounded-[3px] p-1.5 text-ink-soft hover:bg-surface lg:hidden" aria-label="Back to conversations">
          <ArrowLeftIcon size={18} />
        </Link>
        <Avatar name={c.contactName} size={40} />
        <div className="min-w-0 flex-1">
          <Link href={`/contacts/${c.contactId}`} className="block truncate font-semibold text-ink hover:underline">
            {c.contactName}
          </Link>
          <p className="tabular truncate text-[13px] text-ink-soft">
            WhatsApp {c.contactPhone} · assigned to {c.assigneeName ?? "nobody"}
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface/50 p-4 md:p-6">
        <p className="mx-auto mb-6 max-w-md text-center text-[12.5px] text-ink-soft">
          Sandbox: only phones that sent the join phrase can receive replies. Free-form replies work within 24 hours of the customer&apos;s last message.
        </p>
        <ul className="flex flex-col gap-4" aria-live="polite" aria-label="Messages">
          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <Bubble key={m.id} m={m} retrying={retry.isPending && retry.variables === m.id} onRetry={() => retry.mutate(m.id)} />
            ))}
          </AnimatePresence>
        </ul>
        <div ref={endRef} />
      </div>

      {c.optedOut ? (
        <div className="flex items-start gap-3 bg-off-tint p-4 text-sm text-ink">
          <ProhibitIcon size={20} className="mt-0.5 shrink-0 text-off" aria-hidden />
          <p>
            <span className="font-semibold">{c.contactName} opted out of WhatsApp messages,</span> so replies are blocked. If they message you again, or an Admin switches off the opt-out on
            their contact page, you can reply.
          </p>
        </div>
      ) : (
        <form
          className="flex items-end gap-2 pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) send.mutate(body);
          }}
        >
          <label htmlFor="reply" className="sr-only">
            Reply to {c.contactName}
          </label>
          <Textarea
            id="reply"
            rows={2}
            value={body}
            maxLength={1600}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (body.trim()) send.mutate(body);
              }
            }}
            placeholder={`Reply on WhatsApp. Enter to send, Shift+Enter for a new line`}
            className="min-h-12"
          />
          <Button type="submit" size="lg" loading={send.isPending} disabled={!body.trim()} aria-label="Send">
            <PaperPlaneRightIcon size={18} weight="fill" aria-hidden />
          </Button>
        </form>
      )}
    </div>
  );
}
