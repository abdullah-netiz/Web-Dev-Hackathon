"use client";

import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import { api, describeError } from "@/lib/api";
import { PERMISSIONS, type Permission, type Role } from "@/lib/api/types";
import { SettingsSection } from "@/components/app/section";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { ErrorState, ListSkeleton } from "@/components/ui/misc";

const GROUPS = [...new Set(PERMISSIONS.map((p) => p.group))];

export default function RolesPage() {
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api().roles.list() });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const update = useMutation({
    mutationFn: ({ role, permissions }: { role: Role; permissions: Permission[] }) => api().roles.update(role.id, { permissions }),
    onMutate: async ({ role, permissions }) => {
      await qc.cancelQueries({ queryKey: ["roles"] });
      const prev = qc.getQueryData<Role[]>(["roles"]);
      qc.setQueryData<Role[]>(["roles"], (old) => old?.map((r) => (r.id === role.id ? { ...r, permissions } : r)));
      return { prev };
    },
    onError: (e, _v, ctx) => {
      qc.setQueryData(["roles"], ctx?.prev);
      toast.error(describeError(e).title, { description: describeError(e).action });
    },
    onSuccess: (r) => {
      toast.success(`${r.name} updated`, { description: "Takes effect on their next request; the server enforces it." });
      void qc.invalidateQueries({ queryKey: ["session"] });
    },
  });
  const create = useMutation({
    mutationFn: () => api().roles.create({ name, description: desc, permissions: ["crm.view"] }),
    onSuccess: (r) => {
      toast.success(`${r.name} created`, { description: "Tick what it can do in its column." });
      void qc.invalidateQueries({ queryKey: ["roles"] });
      setCreating(false);
      setName("");
      setDesc("");
    },
    onError: (e) => toast.error(describeError(e).title, { description: describeError(e).action }),
  });
  const remove = useMutation({
    mutationFn: (r: Role) => api().roles.remove(r.id),
    onSuccess: () => {
      toast.success("Role deleted");
      void qc.invalidateQueries({ queryKey: ["roles"] });
    },
    onError: (e) => toast.error(describeError(e).title, { description: describeError(e).action }),
  });

  return (
    <SettingsSection
      title="Roles and permissions"
      description="Permissions aren't tied to role names: build any role from these switches. A Manager is just a role. Hidden buttons aren't the protection; the server checks every request."
      aside={
        <Button onClick={() => setCreating(true)}>
          <PlusIcon size={16} aria-hidden /> New role
        </Button>
      }
    >
      {roles.isPending ? (
        <ListSkeleton />
      ) : roles.isError ? (
        <ErrorState error={roles.error} onRetry={() => roles.refetch()} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Permissions by role</caption>
            <thead>
              <tr>
                <th scope="col" className="w-[40%] py-3 pr-4 text-left font-medium text-ink-soft">
                  Permission
                </th>
                {roles.data.map((r) => (
                  <th key={r.id} scope="col" className="px-2 py-3 text-center align-bottom">
                    <span className="block font-semibold text-ink">{r.name}</span>
                    <span className="block text-[12px] font-normal text-ink-soft">
                      {r.memberCount} member{r.memberCount === 1 ? "" : "s"}
                    </span>
                    {!r.isSystem && (
                      <button
                        className="mt-1 inline-flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-[12px] text-ink-soft hover:bg-signal-tint hover:text-signal"
                        onClick={() => remove.mutate(r)}
                        aria-label={`Delete role ${r.name}`}
                      >
                        <TrashIcon size={12} aria-hidden /> Delete
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {GROUPS.map((g) => (
                <Fragment key={g}>
                  <tr>
                    <th colSpan={roles.data.length + 1} scope="colgroup" className="bg-surface px-3 py-2 text-left text-[13px] font-semibold text-ink">
                      {g}
                    </th>
                  </tr>
                  {PERMISSIONS.filter((p) => p.group === g).map((p) => (
                    <tr key={p.key} className="border-b border-line/70">
                      <th scope="row" className="py-2.5 pr-4 text-left font-normal text-ink">
                        {p.label}
                      </th>
                      {roles.data.map((r) => {
                        const locked = r.name === "Owner";
                        const on = locked || r.permissions.includes(p.key);
                        return (
                          <td key={r.id} className="px-2 py-2.5 text-center">
                            <span className="inline-flex">
                              <Checkbox
                                checked={on}
                                disabled={locked}
                                aria-label={`${r.name}: ${p.label}`}
                                onCheckedChange={(c) =>
                                  update.mutate({ role: r, permissions: c ? [...r.permissions, p.key] : r.permissions.filter((x) => x !== p.key) })
                                }
                              />
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[13px] text-ink-soft">The Owner role always has everything. Changes here are recorded in the audit history.</p>
        </div>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title="New role" description="Start it with view access, then tick what else it can do.">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Field label="Name" required>{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="Support" autoFocus />}</Field>
            <Field label="What it's for">{(p) => <Input {...p} value={desc} onChange={(e) => setDesc(e.target.value)} />}</Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
                Create role
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
