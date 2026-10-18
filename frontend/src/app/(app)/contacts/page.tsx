"use client";

import { BookmarkSimpleIcon, DownloadSimpleIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, describeError } from "@/lib/api";
import type { Filter } from "@/lib/api/types";
import { useCan } from "@/lib/session";
import { cn, timeAgo } from "@/lib/utils";
import { NewContactDialog } from "@/components/crm/new-contact-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/controls";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Avatar, EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui/misc";
import { Tag } from "@/components/ui/status";

type FilterState = { ownerId: string; tag: string; channel: string; createdFrom: string; optedOut: boolean };
const EMPTY: FilterState = { ownerId: "", tag: "", channel: "", createdFrom: "", optedOut: false };

function toFilters(f: FilterState): Filter[] {
  const out: Filter[] = [];
  if (f.ownerId) out.push({ field: "ownerId", op: "eq", value: f.ownerId });
  if (f.tag) out.push({ field: "tags", op: "contains", value: f.tag });
  if (f.channel) out.push({ field: "custom.preferred_channel", op: "eq", value: f.channel });
  if (f.createdFrom) out.push({ field: "createdAt", op: "gte", value: f.createdFrom });
  if (f.optedOut) out.push({ field: "optedOut", op: "isTrue" });
  return out;
}

function fromFilters(list: Filter[]): FilterState {
  const s = { ...EMPTY };
  for (const f of list) {
    if (f.field === "ownerId") s.ownerId = String(f.value ?? "");
    if (f.field === "tags") s.tag = String(f.value ?? "");
    if (f.field === "custom.preferred_channel") s.channel = String(f.value ?? "");
    if (f.field === "createdAt") s.createdFrom = String(f.value ?? "");
    if (f.field === "optedOut") s.optedOut = true;
  }
  return s;
}

export default function ContactsPage() {
  const can = useCan();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q);
  const [page, setPage] = useState(1);
  const [f, setF] = useState<FilterState>(EMPTY);
  const [activeList, setActiveList] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [listName, setListName] = useState("");
  const [shared, setShared] = useState(true);
  const filters = useMemo(() => toFilters(f), [f]);

  const contacts = useQuery({
    queryKey: ["contacts", dq, filters, page],
    queryFn: () => api().contacts.list({ q: dq || undefined, filters, page, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });
  const members = useQuery({ queryKey: ["members"], queryFn: () => api().members.list() });
  const tags = useQuery({ queryKey: ["contacts", "tags"], queryFn: () => api().contacts.tags() });
  const lists = useQuery({ queryKey: ["saved-lists", "contact"], queryFn: () => api().savedLists.list("contact") });

  const saveList = useMutation({
    mutationFn: () => api().savedLists.create({ entity: "contact", name: listName, filters, shared }),
    onSuccess: (l) => {
      toast.success(`Saved "${l.name}"`, { description: "It updates by itself as contacts start or stop matching." });
      void qc.invalidateQueries({ queryKey: ["saved-lists"] });
      setActiveList(l.id);
      setSaveOpen(false);
      setListName("");
    },
    onError: (e) => toast.error(describeError(e).title),
  });
  const exportCsv = useMutation({
    mutationFn: () => api().contacts.exportCsv({ q: dq || undefined, filters }),
    onSuccess: (csv) => {
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export ready", { description: `${csv.split("\n").length - 1} contacts downloaded.` });
    },
    onError: (e) => {
      const d = describeError(e);
      toast.error(d.title, { description: d.action });
    },
  });

  const update = (patch: Partial<FilterState>) => {
    setF((s) => ({ ...s, ...patch }));
    setPage(1);
    setActiveList(null);
  };
  const total = contacts.data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 25));
  const current = lists.data?.find((l) => l.id === activeList);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={current ? current.name : "Contacts"}
        description={current ? "A saved list. It stays current as records change." : "Everyone your company has talked to, with their owner and history."}
        actions={
          <>
            <Menu>
              <MenuTrigger asChild>
                <Button variant="outline">
                  <BookmarkSimpleIcon size={16} aria-hidden /> Saved lists
                </Button>
              </MenuTrigger>
              <MenuContent className="w-72">
                <MenuLabel>Open a saved list</MenuLabel>
                {lists.data?.length ? (
                  lists.data.map((l) => (
                    <MenuItem
                      key={l.id}
                      onSelect={() => {
                        setF(fromFilters(l.filters));
                        setActiveList(l.id);
                        setPage(1);
                      }}
                    >
                      <span className="flex-1">{l.name}</span>
                      {l.shared && <span className="text-[12px] text-ink-soft">shared</span>}
                    </MenuItem>
                  ))
                ) : (
                  <MenuItem disabled>No saved lists yet</MenuItem>
                )}
                <MenuSeparator />
                <MenuItem disabled={!filters.length} onSelect={() => setSaveOpen(true)}>
                  Save current filters as a list…
                </MenuItem>
              </MenuContent>
            </Menu>
            {can("crm.export") && (
              <Button variant="outline" loading={exportCsv.isPending} onClick={() => exportCsv.mutate()}>
                <DownloadSimpleIcon size={16} aria-hidden /> Export CSV
              </Button>
            )}
            {can("crm.create") && <NewContactDialog />}
          </>
        }
      />

      <section aria-label="Filters" className="mb-4 grid grid-cols-2 gap-3 rounded-[3px] bg-surface p-3 md:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))_auto] md:items-end">
        <label className="relative col-span-2 block md:col-span-1">
          <span className="mb-1.5 block text-[13px] font-medium text-ink">Search</span>
          <MagnifyingGlassIcon size={16} className="pointer-events-none absolute bottom-3 left-3 text-ink-soft" aria-hidden />
          <Input value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="Name, email, phone, company" className="pl-9" />
        </label>
        <Field label="Owner">
          {(p) => (
            <Select {...p} value={f.ownerId} onChange={(e) => update({ ownerId: e.target.value })}>
              <option value="">Anyone</option>
              {members.data?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Tag">
          {(p) => (
            <Select {...p} value={f.tag} onChange={(e) => update({ tag: e.target.value })}>
              <option value="">Any tag</option>
              {tags.data?.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Preferred channel">
          {(p) => (
            <Select {...p} value={f.channel} onChange={(e) => update({ channel: e.target.value })}>
              <option value="">Any</option>
              <option>WhatsApp</option>
              <option>Phone</option>
              <option>Email</option>
            </Select>
          )}
        </Field>
        <Field label="Added since">{(p) => <Input {...p} type="date" value={f.createdFrom} onChange={(e) => update({ createdFrom: e.target.value })} />}</Field>
        <div className="col-span-2 flex items-center gap-3 md:col-span-1 md:h-10">
          <label className="flex items-center gap-2 text-[13px] font-medium whitespace-nowrap text-ink">
            <Switch checked={f.optedOut} onCheckedChange={(c) => update({ optedOut: c })} /> Opted out
          </label>
          {filters.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => update(EMPTY)} aria-label="Clear all filters">
              <XIcon size={14} aria-hidden /> Clear
            </Button>
          )}
        </div>
      </section>

      <div className="flex items-center justify-between pb-3 text-sm text-ink-soft" aria-live="polite">
        <span>
          {contacts.data ? (
            <>
              <span className="font-semibold text-ink">{total.toLocaleString()}</span> contacts
              {filters.length > 0 && ` match ${filters.length} filter${filters.length > 1 ? "s" : ""}`}
            </>
          ) : (
            "Loading…"
          )}
        </span>
        {contacts.isFetching && !contacts.isPending && <span>Updating…</span>}
      </div>

      {contacts.isPending ? (
        <div className="flex flex-col gap-1">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : contacts.isError ? (
        <ErrorState error={contacts.error} onRetry={() => contacts.refetch()} />
      ) : contacts.data.data.length === 0 ? (
        <EmptyState title="No contacts match." body="Loosen a filter or clear the search." action={<Button variant="outline" size="sm" onClick={() => (update(EMPTY), setQ(""))}>Clear filters</Button>} />
      ) : (
        <div className={cn("overflow-x-auto transition-opacity", (contacts.isFetching || q !== dq) && "opacity-70")}>
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[13px] text-ink-soft">
                <th scope="col" className="py-2.5 pr-4 font-medium">Name</th>
                <th scope="col" className="py-2.5 pr-4 font-medium">Company</th>
                <th scope="col" className="py-2.5 pr-4 font-medium">Phone</th>
                <th scope="col" className="py-2.5 pr-4 font-medium">Owner</th>
                <th scope="col" className="py-2.5 pr-4 font-medium">Tags</th>
                <th scope="col" className="py-2.5 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {contacts.data.data.map((c) => (
                <tr key={c.id} className="group relative border-b border-line/70 hover:bg-surface/60">
                  <td className="py-3 pr-4">
                    <Link href={`/contacts/${c.id}`} className="font-semibold text-ink after:absolute after:inset-0 group-hover:underline">
                      {c.firstName} {c.lastName}
                    </Link>
                    {c.optedOut && (
                      <Tag tone="off" shape="cross" className="ml-2">
                        Opted out
                      </Tag>
                    )}
                    <span className="block text-[13px] text-ink-soft">{c.email}</span>
                  </td>
                  <td className="py-3 pr-4 text-ink">{c.companyName ?? <span className="text-ink-faint">—</span>}</td>
                  <td className="tabular py-3 pr-4 text-ink">{c.phone}</td>
                  <td className="py-3 pr-4">
                    {c.ownerName ? (
                      <span className="flex items-center gap-2">
                        <Avatar name={c.ownerName} size={22} />
                        <span className="text-ink">{c.ownerName}</span>
                      </span>
                    ) : (
                      <span className="text-ink-faint">Unassigned</span>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <span className="flex flex-wrap gap-1">
                      {c.tags.slice(0, 2).map((t) => (
                        <Tag key={t}>{t}</Tag>
                      ))}
                      {c.tags.length > 2 && <span className="text-[12px] text-ink-soft">+{c.tags.length - 2}</span>}
                    </span>
                  </td>
                  <td className="py-3 text-ink-soft">{c.lastActivityAt ? timeAgo(c.lastActivityAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {contacts.data && pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-3">
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

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent title="Save as a list" description={`${filters.length} filter${filters.length === 1 ? "" : "s"}. The list re-runs every time it's opened.`}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveList.mutate();
            }}
            className="flex flex-col gap-4"
          >
            <Field label="List name" required>
              {(p) => <Input {...p} value={listName} onChange={(e) => setListName(e.target.value)} placeholder="Battery prospects in Oakland" autoFocus />}
            </Field>
            <label className="flex items-center justify-between rounded-[3px] bg-surface px-3 py-2.5 text-sm">
              Share with the whole team
              <Switch checked={shared} onCheckedChange={setShared} />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setSaveOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saveList.isPending} disabled={!listName.trim()}>
                Save list
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
