"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { api, describeError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";

export function NoteForm({ entity, invalidate }: { entity: { type: "contact" | "opportunity" | "lead"; id: string }; invalidate: string[] }) {
  const [text, setText] = useState("");
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api().contacts.addNote(entity, text),
    onSuccess: () => {
      setText("");
      toast.success("Note saved");
      for (const k of [...invalidate, "leads", "recovery"]) void qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => {
      const d = describeError(e);
      toast.error(d.title, { description: d.action });
    },
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
      className="flex flex-col gap-2"
    >
      <label htmlFor={`note-${entity.id}`} className="sr-only">
        Add a note
      </label>
      <Textarea id={`note-${entity.id}`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note: what happened, what's next…" rows={2} />
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-ink-soft">A note on a lead you hold counts as acknowledging it.</p>
        <Button type="submit" size="sm" variant="secondary" disabled={!text.trim()} loading={m.isPending}>
          Save note
        </Button>
      </div>
    </form>
  );
}
