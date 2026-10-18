"use client";

import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, describeError } from "@/lib/api";
import type { CustomValues } from "@/lib/api/types";
import { useCan, useMe } from "@/lib/session";
import { formatDateTime, formatMoney } from "@/lib/utils";
import { NoteForm } from "@/components/activity/note-form";
import { Timeline } from "@/components/activity/timeline";
import { BookDialog } from "@/components/crm/book-dialog";
import { CustomFieldInput } from "@/components/crm/custom-field";
import { PaymentDialog } from "@/components/crm/payment-dialog";
import { useStageMover } from "@/components/crm/stage-mover";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { ErrorState, Skeleton } from "@/components/ui/misc";
import { PaymentTag } from "@/components/ui/status";

export default function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useMe();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["opportunity", id], queryFn: () => api().opportunities.get(id) });
  const pipelines = useQuery({ queryKey: ["pipelines"], queryFn: () => api().pipelines.list() });
  const mover = useStageMover();
  const [custom, setCustom] = useState<CustomValues>({});
  useEffect(() => {
    if (q.data) setCustom(q.data.opportunity.custom);
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api().opportunities.update(id, q.data!.opportunity.version, { custom }),
    onSuccess: () => {
      toast.success("Details saved");
      void qc.invalidateQueries({ queryKey: ["opportunity", id] });
    },
    onError: (e) => {
      const d = describeError(e);
      toast.error(d.title, { description: d.action });
      void qc.invalidateQueries({ queryKey: ["opportunity", id] });
    },
  });

  if (q.isPending) return <Skeleton className="mx-auto h-96 max-w-6xl" />;
  if (q.isError) return <ErrorState className="mx-auto max-w-3xl" error={q.error} onRetry={() => q.refetch()} />;

  const { opportunity: o, activities, payments, appointments, fields } = q.data;
  const pipeline = pipelines.data?.find((p) => p.id === o.pipelineId);
  const stage = pipeline?.stages.find((s) => s.id === o.stageId);
  const dirty = JSON.stringify(custom) !== JSON.stringify(o.custom);
  const collected = payments.filter((p) => ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status)).reduce((s, p) => s + p.amount - p.refundedAmount, 0);
  const pending = payments.filter((p) => p.status === "PENDING").reduce((s, p) => s + p.amount, 0);

  return (
    <div className="mx-auto max-w-6xl">
      <Link href={`/opportunities?pipeline=${o.pipelineId}`} className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
        <ArrowLeftIcon size={14} aria-hidden /> {pipeline?.name ?? "Opportunities"}
      </Link>
      <header className="mt-4 grid gap-6 bg-surface p-6 md:grid-cols-[minmax(0,1fr)_auto] md:p-8">
        <div className="min-w-0">
          <h1 className="text-[32px] leading-tight font-semibold tracking-[-0.02em] text-ink md:text-[40px]">{o.name}</h1>
          <p className="mt-1 text-[15px] text-ink-soft">
            <Link href={`/contacts/${o.contactId}`} className="text-teal hover:underline">
              {o.contactName}
            </Link>
            {o.companyName && ` · ${o.companyName}`} · owned by {o.ownerName}
          </p>
          <div className="mt-5 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink">Stage</span>
              <Select value={o.stageId} disabled={!can("crm.edit") || mover.moving} onChange={(e) => mover.move(o, e.target.value, pipeline?.stages.find((s) => s.id === e.target.value)?.name ?? "")} className="min-w-48">
                {pipeline?.stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.requiredFieldKeys.length ? ` (needs ${s.requiredFieldKeys.length})` : ""}
                  </option>
                ))}
              </Select>
            </label>
            {can("crm.edit") && <PaymentDialog opportunity={o} />}
            {can("crm.edit") && <BookDialog contactId={o.contactId} contactName={o.contactName} opportunityId={o.id} />}
          </div>
        </div>
        <dl className="grid min-w-60 grid-cols-1 gap-4 bg-paper p-5">
          <div>
            <dt className="text-[13px] text-ink-soft">Value</dt>
            <dd className="tabular text-3xl font-semibold tracking-[-0.02em] text-ink">
              {o.value != null ? formatMoney(o.value, o.currency) : <span className="text-base font-normal text-ink-soft">Hidden for your role</span>}
            </dd>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-[13px] text-ink-soft">Collected</dt>
              <dd className="tabular font-semibold text-ok">{formatMoney(collected, o.currency)}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-ink-soft">Awaiting</dt>
              <dd className="tabular font-semibold text-ink">{formatMoney(pending, o.currency)}</dd>
            </div>
          </div>
        </dl>
      </header>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col gap-10">
          <section aria-labelledby="fields-h">
            <h2 id="fields-h" className="text-lg font-semibold text-ink">
              {pipeline?.name} details
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              Fields for this pipeline. {stage?.requiredFieldKeys.length ? `"${stage.name}" requires the ones marked *.` : ""}
            </p>
            <form
              className="mt-4 flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
            >
              {fields.map((f) => (
                <CustomFieldInput key={f.id} field={f} required={stage?.requiredFieldKeys.includes(f.key)} value={custom[f.key]} onChange={(v) => setCustom((c) => ({ ...c, [f.key]: v }))} />
              ))}
              {can("crm.edit") && (
                <div className="flex justify-end">
                  <Button type="submit" variant="secondary" disabled={!dirty} loading={save.isPending}>
                    Save details
                  </Button>
                </div>
              )}
            </form>
          </section>

          <section aria-labelledby="pay-h">
            <h2 id="pay-h" className="text-lg font-semibold text-ink">
              Payments
            </h2>
            {payments.length ? (
              <ul className="mt-3 flex flex-col gap-px bg-line">
                {payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 bg-paper py-3">
                    <span className="min-w-0">
                      <span className="tabular block font-semibold text-ink">{formatMoney(p.amount, p.currency)}</span>
                      <span className="block truncate text-[12.5px] text-ink-soft">
                        {p.requestedByName} · {formatDateTime(p.createdAt)} · {p.stripeSessionId}
                      </span>
                    </span>
                    <PaymentTag value={p.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink-soft">No payment requested yet.</p>
            )}
          </section>

          <section aria-labelledby="appt-h">
            <h2 id="appt-h" className="text-lg font-semibold text-ink">
              Appointments
            </h2>
            {appointments.length ? (
              <ul className="mt-3 flex flex-col gap-2">
                {appointments.map((a) => (
                  <li key={a.id} className="bg-surface p-3 text-sm">
                    <span className="tabular font-semibold text-ink">{formatDateTime(a.startsAt, me.user.timeZone)}</span> · {a.title} with {a.userName}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink-soft">Nothing booked for this deal.</p>
            )}
          </section>
        </div>

        <section aria-labelledby="hist-h">
          <h2 id="hist-h" className="text-lg font-semibold text-ink">
            History
          </h2>
          {can("crm.edit") && (
            <div className="mt-4">
              <NoteForm entity={{ type: "opportunity", id: o.id }} invalidate={["opportunity"]} />
            </div>
          )}
          <div className="mt-6">
            <Timeline items={activities} />
          </div>
        </section>
      </div>
      {mover.dialog}
    </div>
  );
}
