"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { api, describeError, isApiError } from "@/lib/api";
import type { CustomValues, Opportunity, Page } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CustomFieldInput } from "./custom-field";

interface Pending {
  opp: Opportunity;
  stageId: string;
  stageName: string;
  missing: string[];
}

export function useStageMover() {
  const qc = useQueryClient();
  const [pending, setPending] = useState<Pending | null>(null);
  const [values, setValues] = useState<CustomValues>({});
  const fields = useQuery({ queryKey: ["fields", "opportunity"], queryFn: () => api().fields.list("opportunity") });

  const patchCache = (oppId: string, stageId: string) => {
    qc.setQueriesData<Page<Opportunity>>({ queryKey: ["opportunities"] }, (old) =>
      old ? { ...old, data: old.data.map((o) => (o.id === oppId ? { ...o, stageId } : o)) } : old,
    );
  };

  const move = useMutation({
    mutationFn: ({ opp, stageId }: { opp: Opportunity; stageId: string; stageName: string }) => api().opportunities.moveStage(opp.id, opp.version, stageId),
    onMutate: async ({ opp, stageId }) => {
      await qc.cancelQueries({ queryKey: ["opportunities"] });
      const snapshot = qc.getQueriesData<Page<Opportunity>>({ queryKey: ["opportunities"] });
      patchCache(opp.id, stageId);
      return { snapshot };
    },
    onError: (e, vars, ctx) => {
      for (const [k, v] of ctx?.snapshot ?? []) qc.setQueryData(k, v);
      if (isApiError(e) && e.code === "REQUIRED_FIELDS_MISSING") {
        const missing = (e.details as { missing: string[] }).missing;
        setValues(Object.fromEntries(missing.map((k) => [k, vars.opp.custom[k] ?? null])));
        setPending({ ...vars, missing });
        return;
      }
      const d = describeError(e);
      toast.error(d.title, { description: d.action });
      void qc.invalidateQueries({ queryKey: ["opportunities"] });
    },
    onSuccess: (o, vars) => {
      toast.success(`${o.name} moved to ${vars.stageName}`);
      for (const k of ["opportunities", "opportunity", "dashboard", "leads"]) void qc.invalidateQueries({ queryKey: [k] });
    },
  });

  const fillAndMove = useMutation({
    mutationFn: async () => {
      const p = pending!;
      const updated = await api().opportunities.update(p.opp.id, p.opp.version, { custom: values });
      return api().opportunities.moveStage(updated.id, updated.version, p.stageId);
    },
    onSuccess: (o) => {
      toast.success(`${o.name} moved to ${pending?.stageName}`, { description: "The required fields were saved first." });
      setPending(null);
      for (const k of ["opportunities", "opportunity", "dashboard"]) void qc.invalidateQueries({ queryKey: [k] });
    },
  });

  const missingFields = (fields.data ?? []).filter((f) => pending?.missing.includes(f.key));
  const incomplete = pending?.missing.some((k) => values[k] == null || values[k] === "") ?? true;
  const err = fillAndMove.error ? describeError(fillAndMove.error) : null;

  const dialog = (
    <Dialog open={!!pending} onOpenChange={(o) => !o && (setPending(null), fillAndMove.reset())}>
      <DialogContent
        title={`"${pending?.stageName}" needs a few details`}
        description={`${pending?.opp.name} can't move there until ${missingFields.map((f) => f.label).join(", ")} ${missingFields.length > 1 ? "are" : "is"} filled in. Fill them now and it moves straight away.`}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            fillAndMove.mutate();
          }}
          className="flex flex-col gap-4"
        >
          {missingFields.map((f) => (
            <CustomFieldInput key={f.id} field={f} required value={values[f.key]} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
          ))}
          {err && (
            <p role="alert" className="rounded-[3px] bg-signal-tint px-3 py-2 text-sm text-signal">
              {err.title} {err.action}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setPending(null)}>
              Leave it where it is
            </Button>
            <Button type="submit" loading={fillAndMove.isPending} disabled={incomplete}>
              Save and move
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );

  return { move: (opp: Opportunity, stageId: string, stageName: string) => move.mutate({ opp, stageId, stageName }), dialog, moving: move.isPending };
}
