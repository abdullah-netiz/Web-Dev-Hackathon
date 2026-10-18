"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useDeferredValue, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Opportunity, Stage } from "@/lib/api/types";
import { useCan } from "@/lib/session";
import { cn, formatCompactMoney, formatMoney, timeAgo } from "@/lib/utils";
import { useStageMover } from "@/components/crm/stage-mover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/controls";
import { Input, Select } from "@/components/ui/field";
import { Avatar, ErrorState, PageHeader, Skeleton } from "@/components/ui/misc";
import { PaymentTag } from "@/components/ui/status";

function Card({ o, overlay, stage }: { o: Opportunity; overlay?: boolean; stage?: Stage }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: o.id, data: { o } });
  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
      aria-roledescription="Draggable opportunity"
      aria-label={`${o.name}${stage ? `, in ${stage.name}` : ""}. Press space to pick up, arrow keys to move, space to drop.`}
      className={cn(
        "group cursor-grab touch-none rounded-[3px] bg-paper p-3 text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-teal active:cursor-grabbing",
        isDragging && !overlay && "opacity-30",
        overlay && "rotate-[1.5deg] shadow-[0_18px_40px_-14px_rgba(11,43,48,0.45)]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link href={`/opportunities/${o.id}`} className="text-sm leading-snug font-semibold text-ink hover:underline" onPointerDown={(e) => e.stopPropagation()}>
          {o.name}
        </Link>
      </div>
      <p className="mt-0.5 truncate text-[12.5px] text-ink-soft">{o.contactName}</p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="tabular text-sm font-semibold text-ink">
          {o.value != null ? formatCompactMoney(o.value, o.currency) : <span className="text-[12px] font-normal text-ink-faint">Value hidden</span>}
        </span>
        <span className="flex items-center gap-1.5">
          {o.paymentStatus && o.paymentStatus !== "EXPIRED" && <PaymentTag value={o.paymentStatus} />}
          {o.ownerName && <Avatar name={o.ownerName} size={22} />}
        </span>
      </div>
    </div>
  );
}

function Column({ stage, items, highlight }: { stage: Stage; items: Opportunity[]; highlight: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const total = items.reduce((s, o) => s + (o.value ?? 0), 0);
  const hasValues = items.some((o) => o.value != null);
  return (
    <section
      ref={setNodeRef}
      aria-label={`${stage.name}, ${items.length} opportunities`}
      className={cn("flex w-[78vw] max-w-[300px] shrink-0 flex-col rounded-[3px] bg-surface transition-colors sm:w-72", isOver && "bg-teal-tint", highlight && "ring-2 ring-teal")}
    >
      <header className="px-3 pt-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">{stage.name}</h2>
          <span className="tabular text-[13px] text-ink-soft">{items.length}</span>
        </div>
        <p className="tabular mt-0.5 text-[12.5px] text-ink-soft">
          {hasValues ? formatCompactMoney(total) : stage.isWon ? "Won" : stage.isLost ? "Lost" : " "}
          {stage.requiredFieldKeys.length > 0 && <span> · needs {stage.requiredFieldKeys.length} field{stage.requiredFieldKeys.length > 1 ? "s" : ""}</span>}
        </p>
      </header>
      <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {items.map((o) => (
          <Card key={o.id} o={o} stage={stage} />
        ))}
      </div>
    </section>
  );
}

function Board() {
  const params = useSearchParams();
  const router = useRouter();
  const can = useCan();
  const pipelines = useQuery({ queryKey: ["pipelines"], queryFn: () => api().pipelines.list() });
  const stageParam = params.get("stage");
  const fromStage = pipelines.data?.find((p) => p.stages.some((s) => s.id === stageParam))?.id;
  const pipelineId = params.get("pipeline") ?? fromStage ?? pipelines.data?.[0]?.id;
  const pipeline = pipelines.data?.find((p) => p.id === pipelineId);
  const [view, setView] = useState<"board" | "list">("board");
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q);
  const opps = useQuery({
    queryKey: ["opportunities", pipelineId, dq],
    queryFn: () => api().opportunities.list({ pipelineId: pipelineId!, q: dq || undefined, pageSize: 100 }),
    enabled: !!pipelineId,
  });
  const mover = useStageMover();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const [active, setActive] = useState<Opportunity | null>(null);
  const byStage = useMemo(() => {
    const m = new Map<string, Opportunity[]>();
    for (const o of opps.data?.data ?? []) m.set(o.stageId, [...(m.get(o.stageId) ?? []), o]);
    return m;
  }, [opps.data]);

  const onEnd = (e: DragEndEvent) => {
    setActive(null);
    const o = e.active.data.current?.o as Opportunity | undefined;
    const to = e.over?.id as string | undefined;
    if (!o || !to || to === o.stageId || !can("crm.edit")) return;
    const stage = pipeline?.stages.find((s) => s.id === to);
    mover.move(o, to, stage?.name ?? "the new stage");
  };

  return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader
        title="Opportunities"
        description="Drag a card to change its stage. Some stages ask for details before a deal can enter them."
        actions={
          <>
            <Select aria-label="Pipeline" value={pipelineId ?? ""} onChange={(e) => router.replace(`/opportunities?pipeline=${e.target.value}`)} className="min-w-44">
              {pipelines.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} pipeline
                </option>
              ))}
            </Select>
            <Tabs value={view} onValueChange={(v) => setView(v as "board" | "list")}>
              <TabsList aria-label="View">
                <TabsTrigger value="board">Board</TabsTrigger>
                <TabsTrigger value="list">List</TabsTrigger>
              </TabsList>
            </Tabs>
          </>
        }
      />
      <label className="relative mb-4 block max-w-sm">
        <span className="sr-only">Search opportunities</span>
        <MagnifyingGlassIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Deal, contact or company" className="pl-9" />
      </label>

      {pipelines.isError || opps.isError ? (
        <ErrorState error={pipelines.error ?? opps.error} onRetry={() => opps.refetch()} />
      ) : !pipeline || opps.isPending ? (
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-96 w-72 shrink-0" />
          ))}
        </div>
      ) : view === "board" ? (
        <DndContext sensors={sensors} onDragStart={(e: DragStartEvent) => setActive((e.active.data.current?.o as Opportunity) ?? null)} onDragEnd={onEnd} onDragCancel={() => setActive(null)}>
          <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8 xl:-mx-12 xl:px-12" style={{ height: "calc(100dvh - 300px)", minHeight: 420 }}>
            {pipeline.stages.map((s) => (
              <Column key={s.id} stage={s} items={byStage.get(s.id) ?? []} highlight={s.id === stageParam} />
            ))}
          </div>
          <DragOverlay dropAnimation={{ duration: 220, easing: "cubic-bezier(0.22,1,0.36,1)" }}>{active ? <Card o={active} overlay /> : null}</DragOverlay>
        </DndContext>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[13px] text-ink-soft">
                <th scope="col" className="py-2.5 pr-4 font-medium">Opportunity</th>
                <th scope="col" className="py-2.5 pr-4 font-medium">Stage</th>
                <th scope="col" className="py-2.5 pr-4 text-right font-medium">Value</th>
                <th scope="col" className="py-2.5 pr-4 font-medium">Owner</th>
                <th scope="col" className="py-2.5 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {(opps.data?.data ?? [])
                .filter((o) => !stageParam || o.stageId === stageParam)
                .map((o) => (
                  <tr key={o.id} className="border-b border-line/70">
                    <td className="py-2.5 pr-4">
                      <Link href={`/opportunities/${o.id}`} className="font-semibold text-ink hover:underline">
                        {o.name}
                      </Link>
                      <span className="block text-[13px] text-ink-soft">{o.contactName}</span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <Select
                        aria-label={`Stage for ${o.name}`}
                        value={o.stageId}
                        disabled={!can("crm.edit")}
                        onChange={(e) => mover.move(o, e.target.value, pipeline.stages.find((s) => s.id === e.target.value)?.name ?? "")}
                        className="h-9 min-w-40"
                      >
                        {pipeline.stages.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="tabular py-2.5 pr-4 text-right">{o.value != null ? formatMoney(o.value, o.currency) : <span className="text-ink-faint">Hidden</span>}</td>
                    <td className="py-2.5 pr-4 text-ink">{o.ownerName}</td>
                    <td className="py-2.5 text-ink-soft">{timeAgo(o.updatedAt)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {mover.dialog}
    </div>
  );
}

export default function OpportunitiesPage() {
  return (
    <Suspense>
      <Board />
    </Suspense>
  );
}
