"use client";

import { ArrowLeftIcon, ChatCircleTextIcon, EnvelopeSimpleIcon, PencilSimpleIcon, PhoneIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import Link from "next/link";
import { use, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api, describeError, isApiError } from "@/lib/api";
import type { Contact, CustomValues } from "@/lib/api/types";
import { useCan, useMe } from "@/lib/session";
import { formatDateTime, formatMoney, timeAgo } from "@/lib/utils";
import { NoteForm } from "@/components/activity/note-form";
import { Timeline } from "@/components/activity/timeline";
import { BookDialog } from "@/components/crm/book-dialog";
import { CustomFieldInput, CustomFieldList } from "@/components/crm/custom-field";
import { AckClock } from "@/components/leads/ack-clock";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/controls";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Avatar, ErrorState, Skeleton } from "@/components/ui/misc";
import { AvailabilityTag, LeadStatusTag, PaymentTag, SourceTag, Tag } from "@/components/ui/status";

function Panel({ title, count, action, children, i }: { title: string; count?: number; action?: ReactNode; children: ReactNode; i: number }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 + i * 0.05, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-[3px] bg-surface p-5"
      aria-label={title}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-ink">
          {title}
          {count != null && <span className="tabular ml-1.5 font-normal text-ink-soft">{count}</span>}
        </h2>
        {action}
      </div>
      {children}
    </motion.section>
  );
}

function EditDetails({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const qc = useQueryClient();
  const fields = useQuery({ queryKey: ["fields", "contact"], queryFn: () => api().fields.list("contact") });
  const [v, setV] = useState({ firstName: contact.firstName, lastName: contact.lastName, email: contact.email ?? "", phone: contact.phone ?? "" });
  const [custom, setCustom] = useState<CustomValues>(contact.custom);
  const m = useMutation({
    mutationFn: () => api().contacts.update(contact.id, contact.version, { ...v, email: v.email || null, phone: v.phone || null, custom }),
    onSuccess: () => {
      toast.success("Saved");
      void qc.invalidateQueries({ queryKey: ["contact", contact.id] });
      void qc.invalidateQueries({ queryKey: ["contacts"] });
      onClose();
    },
  });
  const conflict = isApiError(m.error) && m.error.code === "VERSION_CONFLICT";
  const err = m.error ? describeError(m.error) : null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
      className="flex flex-col gap-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" required>{(p) => <Input {...p} value={v.firstName} onChange={(e) => setV({ ...v, firstName: e.target.value })} />}</Field>
        <Field label="Last name">{(p) => <Input {...p} value={v.lastName} onChange={(e) => setV({ ...v, lastName: e.target.value })} />}</Field>
        <Field label="Email">{(p) => <Input {...p} type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />}</Field>
        <Field label="Phone">{(p) => <Input {...p} type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />}</Field>
      </div>
      {fields.data?.map((f) => (
        <CustomFieldInput key={f.id} field={f} value={custom[f.key]} onChange={(val) => setCustom((c) => ({ ...c, [f.key]: val }))} />
      ))}
      {err && (
        <div role="alert" className="rounded-[3px] bg-signal-tint px-3 py-2 text-sm">
          <p className="font-semibold text-signal">{err.title}</p>
          <p className="text-ink">{err.action}</p>
          {conflict && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => {
                void qc.invalidateQueries({ queryKey: ["contact", contact.id] });
                onClose();
              }}
            >
              Reload their version
            </Button>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={m.isPending}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

export default function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useMe();
  const can = useCan();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ["contact", id], queryFn: () => api().contacts.overview(id) });
  const fields = useQuery({ queryKey: ["fields", "contact"], queryFn: () => api().fields.list("contact") });
  const optOut = useMutation({
    mutationFn: (v: boolean) => api().contacts.update(id, q.data!.contact.version, { optedOut: v }),
    onSuccess: (c) => {
      toast.success(c.optedOut ? "Marked as opted out of WhatsApp" : "Opted back in to WhatsApp");
      void qc.invalidateQueries({ queryKey: ["contact", id] });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e) => toast.error(describeError(e).title, { description: describeError(e).action }),
  });

  if (q.isPending)
    return (
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <Skeleton className="h-36 w-full" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  if (q.isError) return <ErrorState className="mx-auto max-w-3xl" error={q.error} onRetry={() => q.refetch()} />;

  const { contact: c, company, opportunities, conversations, payments, appointments, leads, activities, owner } = q.data;
  const name = `${c.firstName} ${c.lastName}`.trim();
  const collected = payments.filter((p) => ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status)).reduce((s, p) => s + (p.amount ?? 0) - (p.refundedAmount ?? 0), 0);
  const openLead = leads.find((l) => l.status === "ASSIGNED");

  return (
    <div className="mx-auto max-w-7xl">
      <Link href="/contacts" className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
        <ArrowLeftIcon size={14} aria-hidden /> Contacts
      </Link>

      <header className="mt-4 grid gap-6 rounded-[3px] bg-surface p-6 md:grid-cols-[minmax(0,1fr)_auto] md:p-8">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {c.optedOut && <Tag tone="off" shape="cross">Opted out of WhatsApp</Tag>}
            {c.tags.map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </div>
          <h1 className="mt-2 text-[34px] leading-tight font-semibold tracking-[-0.02em] text-ink md:text-[44px]">{name}</h1>
          <p className="mt-1 text-[15px] text-ink-soft">
            {company ? (
              <Link href={`/companies/${company.id}`} className="text-teal hover:underline">
                {company.name}
              </Link>
            ) : (
              "No company"
            )}{" "}
            · customer since {new Date(c.createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </p>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {c.phone && (
              <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 text-teal hover:underline">
                <PhoneIcon size={15} aria-hidden /> {c.phone}
              </a>
            )}
            {c.email && (
              <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1.5 text-teal hover:underline">
                <EnvelopeSimpleIcon size={15} aria-hidden /> {c.email}
              </a>
            )}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {can("crm.edit") && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <PencilSimpleIcon size={16} aria-hidden /> Edit details
              </Button>
            )}
            {can("crm.edit") && <BookDialog contactId={c.id} contactName={name} />}
            {conversations[0] && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/conversations/${conversations[0].id}`}>
                  <ChatCircleTextIcon size={16} aria-hidden /> Open WhatsApp
                </Link>
              </Button>
            )}
          </div>
        </div>
        <div className="flex min-w-64 flex-col gap-4 bg-paper p-5">
          <p className="text-[13px] text-ink-soft">Assigned employee</p>
          {owner ? (
            <div className="flex items-center gap-3">
              <Avatar name={owner.name} size={40} />
              <div>
                <p className="font-semibold text-ink">{owner.name}</p>
                <AvailabilityTag value={owner.availability} className="mt-1" />
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink">Nobody yet</p>
          )}
          {openLead && (
            <Link href={`/leads/${openLead.id}`} className="block bg-surface p-3 hover:bg-surface-2">
              <p className="text-[13px] text-ink-soft">Open lead, waiting for {openLead.ownerName}</p>
              <AckClock lead={openLead} className="mt-1 w-full items-start" />
            </Link>
          )}
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-[13px] text-ink-soft">Collected</dt>
              <dd className="tabular font-semibold text-ink">{formatMoney(collected)}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-ink-soft">Last activity</dt>
              <dd className="text-ink">{c.lastActivityAt ? timeAgo(c.lastActivityAt) : "—"}</dd>
            </div>
          </dl>
        </div>
      </header>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Panel i={0} title="Leads" count={leads.length}>
          {leads.length ? (
            <ul className="flex flex-col gap-2">
              {leads.map((l) => (
                <li key={l.id}>
                  <Link href={`/leads/${l.id}`} className="block rounded-[3px] bg-paper p-3 hover:bg-surface-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <SourceTag value={l.source} />
                      <LeadStatusTag value={l.status} />
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-sm text-ink">{l.message}</p>
                    <p className="mt-1 text-[12.5px] text-ink-soft">
                      {l.ownerName ?? "Unassigned"} · {timeAgo(l.createdAt)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-soft">No leads from this contact.</p>
          )}
        </Panel>

        <Panel i={1} title="Opportunities" count={opportunities.length}>
          {opportunities.length ? (
            <ul className="flex flex-col gap-2">
              {opportunities.map((o) => (
                <li key={o.id}>
                  <Link href={`/opportunities/${o.id}`} className="flex items-center justify-between gap-3 rounded-[3px] bg-paper p-3 hover:bg-surface-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">{o.name}</span>
                      <span className="block text-[12.5px] text-ink-soft">{o.ownerName}</span>
                    </span>
                    <span className="tabular shrink-0 text-sm font-semibold text-ink">
                      {o.value != null ? formatMoney(o.value, o.currency) : <span className="font-normal text-ink-soft" title="Hidden for your role">Value hidden</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-soft">No opportunities yet.</p>
          )}
        </Panel>

        <Panel i={2} title="Conversations" count={conversations.length}>
          {conversations.length ? (
            <ul className="flex flex-col gap-2">
              {conversations.map((cv) => (
                <li key={cv.id}>
                  <Link href={`/conversations/${cv.id}`} className="block rounded-[3px] bg-paper p-3 hover:bg-surface-2">
                    <p className="text-[12.5px] text-ink-soft">
                      WhatsApp · {cv.assigneeName ?? "Unassigned"} · {timeAgo(cv.lastMessageAt)}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm text-ink">{cv.lastMessagePreview}</p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-soft">No messages yet. A WhatsApp from their number lands here automatically.</p>
          )}
        </Panel>

        <Panel i={3} title="Payments" count={payments.length}>
          {payments.length ? (
            <ul className="flex flex-col gap-2">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 rounded-[3px] bg-paper p-3">
                  <span className="min-w-0">
                    <span className="tabular block text-sm font-semibold text-ink">{formatMoney(p.amount, p.currency)}</span>
                    <span className="block truncate text-[12.5px] text-ink-soft">
                      {p.opportunityName} · by {p.requestedByName}
                    </span>
                  </span>
                  <PaymentTag value={p.status} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-soft">No payment requests. Create one from an opportunity.</p>
          )}
        </Panel>

        <Panel i={4} title="Appointments" count={appointments.length}>
          {appointments.length ? (
            <ul className="flex flex-col gap-2">
              {appointments.map((a) => (
                <li key={a.id} className="rounded-[3px] bg-paper p-3">
                  <p className="tabular text-sm font-semibold text-ink">{formatDateTime(a.startsAt, me.user.timeZone)}</p>
                  <p className="text-[12.5px] text-ink-soft">
                    {a.title} with {a.userName}
                    {a.status === "CANCELLED" && " · cancelled"}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-soft">Nothing booked.</p>
          )}
        </Panel>

        <Panel
          i={5}
          title="Details"
          action={
            can("crm.edit") ? (
              <label className="flex items-center gap-2 text-[13px] text-ink">
                WhatsApp opt-out
                <Switch checked={c.optedOut} disabled={optOut.isPending} onCheckedChange={(v) => optOut.mutate(v)} />
              </label>
            ) : undefined
          }
        >
          <CustomFieldList fields={fields.data ?? []} values={c.custom} />
          {c.optedOut && <p className="mt-3 text-[13px] text-ink-soft">They asked not to be messaged. Replies are blocked until they message you again or this is switched off.</p>}
        </Panel>
      </div>

      <section className="mt-10 max-w-3xl" aria-labelledby="history-h">
        <h2 id="history-h" className="text-lg font-semibold text-ink">
          Everything that happened
        </h2>
        <p className="mt-1 text-sm text-ink-soft">Notes, assignments, stage changes, messages, payments and appointments, newest first.</p>
        {can("crm.edit") && (
          <div className="mt-4">
            <NoteForm entity={{ type: "contact", id: c.id }} invalidate={["contact"]} />
          </div>
        )}
        <div className="mt-6">
          <Timeline items={activities} />
        </div>
      </section>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent title={`Edit ${name}`}>{editing && <EditDetails contact={c} onClose={() => setEditing(false)} />}</DialogContent>
      </Dialog>
    </div>
  );
}
