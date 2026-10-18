"use client";

import { CopyIcon, LockSimpleIcon, UserPlusIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { api, describeError } from "@/lib/api";
import type { BaseLevel, User } from "@/lib/api/types";
import { useMe } from "@/lib/session";
import { SettingsSection } from "@/components/app/section";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/controls";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Avatar, ErrorState, ListSkeleton } from "@/components/ui/misc";
import { AvailabilityTag, Tag } from "@/components/ui/status";

function useUpdateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<ReturnType<typeof api>["members"]["update"]>[1] }) => api().members.update(id, patch),
    onSuccess: (u) => {
      toast.success(`${u.name} updated`);
      void qc.invalidateQueries({ queryKey: ["members"] });
    },
    onError: (e) => {
      toast.error(describeError(e).title, { description: describeError(e).action });
      void qc.invalidateQueries({ queryKey: ["members"] });
    },
  });
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api().roles.list() });
  const [v, setV] = useState({ name: "", email: "", baseLevel: "USER" as BaseLevel, roleId: "" });
  const [url, setUrl] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api().members.invite({ ...v, roleId: v.roleId || roles.data?.find((r) => r.name === "Sales")?.id || roles.data![0]!.id }),
    onSuccess: (r) => {
      setUrl(r.inviteUrl);
      void qc.invalidateQueries({ queryKey: ["members"] });
    },
  });
  const err = m.error ? describeError(m.error) : null;
  return (
    <Dialog open={open} onOpenChange={(o) => (onOpenChange(o), o || (setUrl(null), m.reset(), setV({ name: "", email: "", baseLevel: "USER", roleId: "" })))}>
      <DialogContent title="Invite a teammate" description="They set their own password from the invite link.">
        {url ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink">Send {v.name} this link. It works once.</p>
            <p className="bg-surface p-3 text-[13px] break-all text-ink">{url}</p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(url);
                  toast.success("Invite link copied");
                }}
              >
                <CopyIcon size={16} aria-hidden /> Copy link
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              m.mutate();
            }}
          >
            <Field label="Name" required>{(p) => <Input {...p} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
            <Field label="Work email" required>{(p) => <Input {...p} type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />}</Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Level" hint="Admins configure the workspace.">
                {(p) => (
                  <Select {...p} value={v.baseLevel} onChange={(e) => setV({ ...v, baseLevel: e.target.value as BaseLevel })}>
                    <option value="USER">User</option>
                    <option value="ADMIN">Admin</option>
                  </Select>
                )}
              </Field>
              <Field label="Role" hint="Decides what they can see and do.">
                {(p) => (
                  <Select {...p} value={v.roleId} onChange={(e) => setV({ ...v, roleId: e.target.value })}>
                    <option value="">Sales (default)</option>
                    {roles.data
                      ?.filter((r) => r.name !== "Owner")
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
            </div>
            {err && (
              <p role="alert" className="rounded-[3px] bg-signal-tint px-3 py-2 text-sm text-signal">
                {err.title} {err.action}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={m.isPending} disabled={!v.name.trim() || !v.email.includes("@")}>
                Create invite
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MemberRow({ u, all, roles }: { u: User; all: User[]; roles: { id: string; name: string }[] }) {
  const me = useMe();
  const upd = useUpdateMember();
  const qc = useQueryClient();
  const deact = useMutation({
    mutationFn: () => api().members.deactivate(u.id),
    onSuccess: () => {
      toast.success(`${u.name} deactivated`, { description: "Their waiting leads were reassigned first." });
      void qc.invalidateQueries({ queryKey: ["members"] });
    },
    onError: (e) => toast.error(describeError(e).title, { description: describeError(e).action }),
  });
  const ownerLocked = u.baseLevel === "OWNER" && me.user.baseLevel !== "OWNER";
  const isOwner = u.baseLevel === "OWNER";
  const self = u.id === me.user.id;
  return (
    <li className="grid gap-4 bg-paper py-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)] md:items-start">
      <div className="flex items-center gap-3">
        <Avatar name={u.name} size={36} />
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">
            {u.name} {self && <span className="font-normal text-ink-soft">(you)</span>}
          </p>
          <p className="truncate text-[13px] text-ink-soft">{u.email}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <AvailabilityTag value={u.availability} />
            {!u.active && (
              <Tag tone="off" shape="bar">
                Deactivated
              </Tag>
            )}
          </div>
        </div>
      </div>
      {ownerLocked ? (
        <p className="flex items-center gap-2 bg-surface px-3 py-2.5 text-sm text-ink-soft">
          <LockSimpleIcon size={16} aria-hidden /> Only the Owner can change the Owner&apos;s account.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Field label="Level">
            {(p) => (
              <Select {...p} value={u.baseLevel} disabled={isOwner || self || !u.active} onChange={(e) => upd.mutate({ id: u.id, patch: { baseLevel: e.target.value as BaseLevel } })}>
                {isOwner && <option value="OWNER">Owner</option>}
                <option value="ADMIN">Admin</option>
                <option value="USER">User</option>
              </Select>
            )}
          </Field>
          <Field label="Role">
            {(p) => (
              <Select {...p} value={u.roleId} disabled={isOwner || !u.active} onChange={(e) => upd.mutate({ id: u.id, patch: { roleId: e.target.value } })}>
                {roles
                  .filter((r) => isOwner || r.name !== "Owner")
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label="Backup">
            {(p) => (
              <Select {...p} value={u.backupUserId ?? ""} disabled={!u.active} onChange={(e) => upd.mutate({ id: u.id, patch: { backupUserId: e.target.value || null } })}>
                <option value="">None</option>
                {all
                  .filter((x) => x.id !== u.id && x.active)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label="Max open leads" hint="Blank = workspace default">
            {(p) => (
              <Input
                {...p}
                type="number"
                min={1}
                max={99}
                defaultValue={u.maxOpenLeads ?? ""}
                disabled={!u.active}
                onBlur={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  if (v !== u.maxOpenLeads && (v === null || v >= 1)) upd.mutate({ id: u.id, patch: { maxOpenLeads: v } });
                }}
              />
            )}
          </Field>
          <label className="col-span-2 flex items-center justify-between gap-3 rounded-[3px] bg-surface px-3 py-2 text-sm text-ink lg:col-span-3">
            Receives escalations as a manager (last level)
            <Switch checked={u.isManager} disabled={!u.active} onCheckedChange={(c) => upd.mutate({ id: u.id, patch: { isManager: c } })} />
          </label>
          {!isOwner && !self && u.active && (
            <Button variant="ghost" size="sm" className="self-center text-signal hover:bg-signal-tint" loading={deact.isPending} onClick={() => deact.mutate()}>
              Deactivate
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export default function MembersPage() {
  const [invite, setInvite] = useState(false);
  const members = useQuery({ queryKey: ["members"], queryFn: () => api().members.list() });
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api().roles.list() });
  return (
    <SettingsSection
      title="Members"
      description="Owner, Admin and User are the three levels. What each person can see and do comes from their role."
      aside={
        <Button onClick={() => setInvite(true)}>
          <UserPlusIcon size={16} aria-hidden /> Invite
        </Button>
      }
    >
      {members.isPending || roles.isPending ? (
        <ListSkeleton />
      ) : members.isError ? (
        <ErrorState error={members.error} onRetry={() => members.refetch()} />
      ) : (
        <ul className="flex flex-col gap-px bg-line">
          {members.data.map((u) => (
            <MemberRow key={u.id} u={u} all={members.data} roles={roles.data ?? []} />
          ))}
        </ul>
      )}
      <InviteDialog open={invite} onOpenChange={setInvite} />
    </SettingsSection>
  );
}
