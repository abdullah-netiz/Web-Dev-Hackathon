"use client";

import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { api, describeError, isApiError } from "@/lib/api";
import type { Pipeline, Stage } from "@/lib/api/types";
import { SettingsSection } from "@/components/app/section";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Menu, MenuContent, MenuLabel, MenuTrigger } from "@/components/ui/menu";
import { ListSkeleton } from "@/components/ui/misc";
import { Tag } from "@/components/ui/status";

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    for (const k of ["pipelines", "opportunities", "dashboard"]) void qc.invalidateQueries({ queryKey: [k] });
  };
}
const onErr = (e: unknown) => toast.error(describeError(e).title, { description: describeError(e).action });

function StageRow({ stage, pipeline, index, count }: { stage: Stage; pipeline: Pipeline; index: number; count: number }) {
  const invalidate = useInvalidate();
  const fields = useQuery({ queryKey: ["fields", "opportunity"], queryFn: () => api().fields.list("opportunity") });
  const [name, setName] = useState(stage.name);
  const [del, setDel] = useState<{ count: number } | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const rename = useMutation({ mutationFn: () => api().pipelines.updateStage(stage.id, { name }), onSuccess: () => (toast.success("Stage renamed"), invalidate()), onError: onErr });
  const required = useMutation({
    mutationFn: (keys: string[]) => api().pipelines.updateStage(stage.id, { requiredFieldKeys: keys }),
    onSuccess: () => invalidate(),
    onError: onErr,
  });
  const reorder = useMutation({
    mutationFn: (dir: -1 | 1) => {
      const ids = [...pipeline.stages].sort((a, b) => a.order - b.order).map((s) => s.id);
      const i = ids.indexOf(stage.id);
      [ids[i], ids[i + dir]] = [ids[i + dir]!, ids[i]!];
      return api().pipelines.reorderStages(pipeline.id, ids);
    },
    onSuccess: () => invalidate(),
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (to: string | null) => api().pipelines.deleteStage(stage.id, to),
    onSuccess: () => {
      toast.success(`"${stage.name}" deleted`, { description: del ? `${del.count} opportunities were moved first.` : undefined });
      setDel(null);
      invalidate();
    },
    onError: (e) => {
      if (isApiError(e) && e.code === "STAGE_NOT_EMPTY") setDel({ count: (e.details as { count: number }).count });
      else onErr(e);
    },
  });
  const pipelineFields = (fields.data ?? []).filter((f) => f.pipelineId === null || f.pipelineId === pipeline.id);

  return (
    <motion.li layout transition={{ type: "spring", stiffness: 420, damping: 36 }} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 bg-paper py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
      <div className="flex flex-col">
        <button className="rounded-[3px] p-1 text-ink-soft hover:bg-surface hover:text-ink disabled:opacity-30" disabled={index === 0 || reorder.isPending} onClick={() => reorder.mutate(-1)} aria-label={`Move ${stage.name} up`}>
          <ArrowUpIcon size={14} />
        </button>
        <button className="rounded-[3px] p-1 text-ink-soft hover:bg-surface hover:text-ink disabled:opacity-30" disabled={index === count - 1 || reorder.isPending} onClick={() => reorder.mutate(1)} aria-label={`Move ${stage.name} down`}>
          <ArrowDownIcon size={14} />
        </button>
      </div>
      <form
        className="flex min-w-0 items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && name !== stage.name) rename.mutate();
        }}
      >
        <label className="sr-only" htmlFor={`stage-${stage.id}`}>
          Stage name
        </label>
        <Input id={`stage-${stage.id}`} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== stage.name && rename.mutate()} className="max-w-64" />
        {stage.isWon && <Tag tone="ok" shape="check">Won</Tag>}
        {stage.isLost && <Tag tone="off" shape="cross">Lost</Tag>}
      </form>
      <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:justify-end">
        <Menu>
          <MenuTrigger asChild>
            <Button variant="outline" size="sm">
              {stage.requiredFieldKeys.length ? `Requires ${stage.requiredFieldKeys.length} field${stage.requiredFieldKeys.length > 1 ? "s" : ""}` : "No required fields"}
            </Button>
          </MenuTrigger>
          <MenuContent className="w-72">
            <MenuLabel>Fields a deal must have before entering &ldquo;{stage.name}&rdquo;</MenuLabel>
            {pipelineFields.map((f) => (
              <label key={f.id} className="flex cursor-pointer items-center gap-2.5 rounded-[3px] px-2.5 py-2 text-sm hover:bg-surface">
                <Checkbox
                  checked={stage.requiredFieldKeys.includes(f.key)}
                  onCheckedChange={(c) => required.mutate(c ? [...stage.requiredFieldKeys, f.key] : stage.requiredFieldKeys.filter((k) => k !== f.key))}
                />
                {f.label}
              </label>
            ))}
            {!pipelineFields.length && <p className="px-2.5 py-2 text-[13px] text-ink-soft">Add custom fields for this pipeline first.</p>}
          </MenuContent>
        </Menu>
        <Button variant="ghost" size="sm" className="text-signal hover:bg-signal-tint" loading={remove.isPending && !del} onClick={() => remove.mutate(null)} aria-label={`Delete stage ${stage.name}`}>
          <TrashIcon size={15} aria-hidden />
        </Button>
      </div>
      <Dialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <DialogContent title={`Delete "${stage.name}"?`} description={`${del?.count} opportunit${del?.count === 1 ? "y is" : "ies are"} in this stage. Choose where they go; nothing is deleted with the stage.`}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (moveTo) remove.mutate(moveTo);
            }}
          >
            <Field label="Move them to" required>
              {(p) => (
                <Select {...p} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                  <option value="">Choose a stage</option>
                  {pipeline.stages
                    .filter((s) => s.id !== stage.id)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDel(null)}>
                Keep the stage
              </Button>
              <Button type="submit" variant="danger" disabled={!moveTo} loading={remove.isPending}>
                Move and delete
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </motion.li>
  );
}

function PipelineBlock({ p }: { p: Pipeline }) {
  const invalidate = useInvalidate();
  const [stage, setStage] = useState("");
  const add = useMutation({
    mutationFn: () => api().pipelines.addStage(p.id, stage.trim()),
    onSuccess: (s) => {
      toast.success(`"${s.name}" added`, { description: "It sits before Won and Lost; reorder it with the arrows." });
      setStage("");
      invalidate();
    },
    onError: onErr,
  });
  const stages = [...p.stages].sort((a, b) => a.order - b.order);
  return (
    <SettingsSection title={`${p.name} pipeline`} description={`${stages.length} stages. Each pipeline has its own custom fields; contact details are shared.`}>
      <ul className="flex flex-col gap-px bg-line">
        <AnimatePresence initial={false}>
          {stages.map((s, i) => (
            <StageRow key={s.id} stage={s} pipeline={p} index={i} count={stages.length} />
          ))}
        </AnimatePresence>
      </ul>
      <form
        className="mt-4 flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (stage.trim()) add.mutate();
        }}
      >
        <label htmlFor={`new-${p.id}`} className="sr-only">
          New stage name
        </label>
        <Input id={`new-${p.id}`} value={stage} onChange={(e) => setStage(e.target.value)} placeholder="New stage name" />
        <Button type="submit" variant="secondary" loading={add.isPending} disabled={!stage.trim()}>
          <PlusIcon size={16} aria-hidden /> Add stage
        </Button>
      </form>
    </SettingsSection>
  );
}

export default function PipelinesPage() {
  const invalidate = useInvalidate();
  const pipelines = useQuery({ queryKey: ["pipelines"], queryFn: () => api().pipelines.list() });
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => api().pipelines.create(name.trim()),
    onSuccess: (p) => {
      toast.success(`${p.name} pipeline created`);
      setName("");
      invalidate();
    },
    onError: onErr,
  });
  if (pipelines.isPending) return <ListSkeleton />;
  return (
    <div className="flex flex-col gap-10">
      {pipelines.data?.map((p) => (
        <PipelineBlock key={p.id} p={p} />
      ))}
      <SettingsSection title="Another pipeline" description="For a different kind of deal with its own stages and fields, sharing the same contacts.">
        <form
          className="flex max-w-md gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <label htmlFor="new-pipe" className="sr-only">
            Pipeline name
          </label>
          <Input id="new-pipe" value={name} onChange={(e) => setName(e.target.value)} placeholder="Maintenance contracts" />
          <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
            Create
          </Button>
        </form>
      </SettingsSection>
    </div>
  );
}
