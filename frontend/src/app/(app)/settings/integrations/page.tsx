"use client";

import { CalendarBlankIcon, ChatCircleDotsIcon, CopyIcon, CreditCardIcon, SlackLogoIcon, type Icon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { api, describeError } from "@/lib/api";
import type { IntegrationConnection, IntegrationEvent, Provider } from "@/lib/api/types";
import { cn, formatDateTime, timeAgo } from "@/lib/utils";
import { SettingsSection } from "@/components/app/section";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/controls";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { ErrorState, ListSkeleton } from "@/components/ui/misc";
import { ConnectionTag, Tag } from "@/components/ui/status";

type FieldSpec = { key: string; label: string; hint?: string; secret?: boolean; config?: boolean };

const META: Record<Provider, { name: string; purpose: string; icon: Icon; fields: FieldSpec[]; perUser?: string }> = {
  TWILIO: {
    name: "Twilio WhatsApp",
    purpose: "Talk to customers and capture leads from incoming messages.",
    icon: ChatCircleDotsIcon,
    fields: [
      { key: "accountSid", label: "Account SID", hint: "Starts with AC, on the Twilio console home page", secret: true },
      { key: "authToken", label: "Auth token", hint: "Also used to verify Twilio's webhook signatures", secret: true },
      { key: "whatsappFrom", label: "Sandbox number", hint: "whatsapp:+14155238886 for the WhatsApp sandbox" },
    ],
  },
  LEMONSQUEEZY: {
    name: "Lemon Squeezy",
    purpose: "Collect payments for opportunities through a hosted checkout (test mode).",
    icon: CreditCardIcon,
    fields: [
      { key: "apiKey", label: "API key", hint: "Settings → API in Lemon Squeezy", secret: true },
      { key: "storeId", label: "Store ID", hint: "Settings → Stores, the number next to the store" },
      { key: "variantId", label: "Product variant ID", hint: "Any product's variant; its price is replaced per request" },
      { key: "webhookSecret", label: "Webhook signing secret", hint: "The secret you typed when adding the webhook", secret: true },
      { key: "currency", label: "Store currency", hint: "e.g. USD, must match the store", config: true },
    ],
  },
  GOOGLE: {
    name: "Google Calendar",
    purpose: "Book appointments on employees' own calendars.",
    icon: CalendarBlankIcon,
    fields: [],
    perUser: "Each employee connects their own Google account from Settings → Profile. The OAuth app itself is configured on the server.",
  },
  SLACK: {
    name: "Slack alerts",
    purpose: "Direct-message the new owner when a lead escalates to them.",
    icon: SlackLogoIcon,
    fields: [{ key: "botToken", label: "Bot token", hint: "xoxb-…, from OAuth & Permissions after installing your Slack app", secret: true }],
  },
};

const EVENT_TONE: Record<IntegrationEvent["status"], { tone: "ok" | "signal" | "warn" | "neutral"; label: string }> = {
  OK: { tone: "ok", label: "OK" },
  FAILED: { tone: "signal", label: "Failed" },
  REJECTED: { tone: "signal", label: "Rejected" },
  DUPLICATE: { tone: "neutral", label: "Duplicate ignored" },
  RETRYING: { tone: "warn", label: "Retrying" },
};

function ConnectDialog({ c, open, onOpenChange }: { c: IntegrationConnection; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const meta = META[c.provider];
  const [v, setV] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => {
      const credentials = Object.fromEntries(meta.fields.filter((f) => !f.config && v[f.key]).map((f) => [f.key, v[f.key]!.trim()]));
      const config = Object.fromEntries(meta.fields.filter((f) => f.config && v[f.key]).map((f) => [f.key, v[f.key]!.trim().toUpperCase()]));
      return api().integrations.connect(c.provider, credentials, config);
    },
    onSuccess: () => {
      toast.success(`${meta.name} connected`, { description: "Credentials are encrypted for this workspace only." });
      void qc.invalidateQueries({ queryKey: ["integrations"] });
      setV({});
      onOpenChange(false);
    },
  });
  const err = m.error ? describeError(m.error) : null;
  return (
    <Dialog open={open} onOpenChange={(o) => (onOpenChange(o), o || (setV({}), m.reset()))}>
      <DialogContent title={`Connect ${meta.name}`} description="Paste the values from the provider's dashboard. They're stored encrypted for this workspace and never shown again in full.">
        <form
          className="flex flex-col gap-4"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          {meta.fields.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              {(p) => <Input {...p} type={f.secret ? "password" : "text"} autoComplete="off" spellCheck={false} value={v[f.key] ?? ""} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />}
            </Field>
          ))}
          {err && (
            <p role="alert" className="rounded-[3px] bg-signal-tint px-3 py-2 text-sm text-signal">
              {err.title} {err.action}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={m.isPending} disabled={meta.fields.some((f) => !f.config && !v[f.key]?.trim())}>
              Connect
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProviderCard({ c }: { c: IntegrationConnection }) {
  const qc = useQueryClient();
  const meta = META[c.provider];
  const [connecting, setConnecting] = useState(false);
  const test = useMutation({
    mutationFn: () => api().integrations.test(c.provider),
    onSuccess: (r) => {
      if (r.ok) toast.success(`${meta.name} answered`, { description: r.detail });
      else toast.error(`${meta.name} test failed`, { description: r.detail });
      void qc.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (e) => toast.error(describeError(e).title, { description: describeError(e).action }),
  });
  const disconnect = useMutation({
    mutationFn: () => api().integrations.disconnect(c.provider),
    onSuccess: () => (toast.success(`${meta.name} disconnected`, { description: "The rest of Baton keeps working without it." }), qc.invalidateQueries({ queryKey: ["integrations"] })),
    onError: (e) => toast.error(describeError(e).title),
  });
  const recentError = c.lastError && c.lastErrorAt && Date.now() - new Date(c.lastErrorAt).getTime() < 86_400_000;
  return (
    <li className="grid gap-5 bg-paper p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:p-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <meta.icon size={26} className="text-teal" aria-hidden />
          <h3 className="text-lg font-semibold text-ink">{meta.name}</h3>
          <ConnectionTag value={c.status} hasError={!!recentError} />
        </div>
        <p className="mt-1.5 text-sm text-ink-soft">{meta.purpose}</p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-[13px] text-ink-soft">Last worked</dt>
            <dd className="text-ink">{c.lastOkAt ? <time title={formatDateTime(c.lastOkAt)}>{timeAgo(c.lastOkAt)}</time> : "Never"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[13px] text-ink-soft">Credential</dt>
            <dd className="truncate text-ink" title={c.maskedCredential ?? undefined}>
              {c.maskedCredential ?? "None"}
            </dd>
          </div>
        </dl>
        {c.lastError && (
          <div className={cn("mt-4 p-3 text-[13px]", recentError ? "bg-signal-tint" : "bg-surface")}>
            <p className={cn("font-semibold", recentError ? "text-signal" : "text-ink")}>Latest error{c.lastErrorAt && `, ${timeAgo(c.lastErrorAt)}`}</p>
            <p className="mt-0.5 text-ink">{c.lastError}</p>
          </div>
        )}
        {(c.webhookUrl || c.statusCallbackUrl) && (
          <div className="mt-4 flex flex-col gap-2 text-[13px]">
            {[["Webhook URL", c.webhookUrl], ["Status callback URL", c.statusCallbackUrl]].filter(([, url]) => url).map(([label, url]) => (
              <div key={label} className="min-w-0">
                <p className="text-ink-soft">{label} (paste into the provider dashboard)</p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate bg-surface px-2 py-1 text-ink" title={url!}>{url}</code>
                  <Button size="sm" variant="ghost" aria-label={`Copy ${label}`} onClick={() => void navigator.clipboard?.writeText(url!).then(() => toast.success("Copied"))}>
                    <CopyIcon size={16} aria-hidden />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {meta.perUser && <p className="mt-4 bg-surface p-3 text-[13px] text-ink">{meta.perUser}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          {meta.perUser ? (
            <Button variant="outline" loading={test.isPending} onClick={() => test.mutate()}>
              Check connections
            </Button>
          ) : c.status === "NOT_CONNECTED" ? (
            <Button onClick={() => setConnecting(true)}>Connect</Button>
          ) : (
            <>
              <Button variant="outline" loading={test.isPending} onClick={() => test.mutate()}>
                Test connection
              </Button>
              <Button variant="outline" onClick={() => setConnecting(true)}>
                Replace credentials
              </Button>
              <Button variant="ghost" className="text-signal hover:bg-signal-tint" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
                Disconnect
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="grid gap-4 bg-surface p-4 text-sm sm:grid-cols-2 md:grid-cols-1">
        <div>
          <p className="font-semibold text-ink">What it does</p>
          <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-ink">
            {c.canDo.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-semibold text-ink">What it can&apos;t do</p>
          <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-ink-soft">
            {c.cannotDo.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </div>
      <ConnectDialog c={c} open={connecting} onOpenChange={setConnecting} />
    </li>
  );
}

export default function IntegrationsPage() {
  const list = useQuery({ queryKey: ["integrations"], queryFn: () => api().integrations.list() });
  const [provider, setProvider] = useState<Provider | "">("");
  const events = useQuery({ queryKey: ["integrations", "events", provider], queryFn: () => api().integrations.events({ provider: provider || undefined }), refetchInterval: 15_000 });
  const alerts = useQuery({ queryKey: ["integrations", "alerts"], queryFn: () => api().integrations.alerts() });

  return (
    <div className="flex flex-col gap-10">
      <SettingsSection title="Integrations" description="Each workspace uses its own accounts. If one provider is down, everything else in Baton keeps working, and failures show up here with a plain reason.">
        {list.isPending ? (
          <ListSkeleton rows={4} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : (
          <ul className="flex flex-col gap-px bg-line">
            {list.data.map((c) => (
              <ProviderCard key={c.provider} c={c} />
            ))}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection
        title="Sync history"
        description="Every webhook received and every call made, with its result and the provider's reference. Forged requests are rejected and listed; repeats are ignored."
        aside={
          <Tabs value={provider} onValueChange={(v) => setProvider(v as Provider | "")}>
            <TabsList aria-label="Provider">
              <TabsTrigger value="">All</TabsTrigger>
              <TabsTrigger value="TWILIO">Twilio</TabsTrigger>
              <TabsTrigger value="LEMONSQUEEZY">Payments</TabsTrigger>
              <TabsTrigger value="GOOGLE">Google</TabsTrigger>
              <TabsTrigger value="SLACK">Slack</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      >
        {events.isPending ? (
          <ListSkeleton />
        ) : events.isError ? (
          <ErrorState error={events.error} onRetry={() => events.refetch()} />
        ) : (
          <div className="relative max-h-[480px] overflow-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="sticky top-0 bg-paper">
                <tr className="border-b border-line text-[13px] text-ink-soft">
                  <th scope="col" className="py-2.5 pr-4 font-medium">When</th>
                  <th scope="col" className="py-2.5 pr-4 font-medium">Provider</th>
                  <th scope="col" className="py-2.5 pr-4 font-medium">Event</th>
                  <th scope="col" className="py-2.5 pr-4 font-medium">Result</th>
                  <th scope="col" className="py-2.5 font-medium">Reference</th>
                </tr>
              </thead>
              <tbody>
                {events.data.map((e) => (
                  <tr key={e.id} className="border-b border-line/70 align-top">
                    <td className="tabular py-2.5 pr-4 whitespace-nowrap text-ink-soft">{formatDateTime(e.at)}</td>
                    <td className="py-2.5 pr-4 text-ink">{META[e.provider]?.name ?? e.provider}</td>
                    <td className="py-2.5 pr-4 text-ink">
                      {e.direction === "INBOUND" ? "In: " : "Out: "}
                      {e.type}
                    </td>
                    <td className="py-2.5 pr-4">
                      <Tag tone={EVENT_TONE[e.status].tone} shape={e.status === "OK" ? "check" : e.status === "RETRYING" ? "clock" : e.status === "DUPLICATE" ? "bar" : "cross"}>
                        {EVENT_TONE[e.status].label}
                      </Tag>
                      {e.error && <span className="mt-1 block max-w-xs text-[12.5px] text-ink-soft">{e.error}</span>}
                    </td>
                    <td className="max-w-[14rem] py-2.5 text-[12.5px] break-all text-ink-soft">{e.reference}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="Escalation alert deliveries" description="Slack alerts sent to new owners. Failed ones are retried up to 3 times, then listed here.">
        {alerts.isPending ? (
          <ListSkeleton rows={3} />
        ) : alerts.isError ? (
          <ErrorState error={alerts.error} onRetry={() => alerts.refetch()} />
        ) : !alerts.data.length ? (
          <p className="text-sm text-ink-soft">No escalation alerts yet. They appear here when a lead escalates.</p>
        ) : (
          <ul className="flex flex-col gap-px bg-line">
            {alerts.data?.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 bg-paper py-3">
                <div className="min-w-0">
                  <p className="text-sm text-ink">
                    <span className="font-semibold">{a.leadLabel}</span> → {a.userName}
                  </p>
                  <p className="text-[12.5px] text-ink-soft">
                    {formatDateTime(a.at)} · {a.attempts} attempt{a.attempts > 1 ? "s" : ""}
                    {a.lastError && ` · ${a.lastError}`}
                  </p>
                </div>
                <Tag tone={a.status === "SENT" ? "ok" : a.status === "RETRYING" ? "warn" : "signal"} shape={a.status === "SENT" ? "check" : a.status === "RETRYING" ? "clock" : "cross"}>
                  {a.status === "SENT" ? "Delivered" : a.status === "RETRYING" ? "Retrying" : "Failed"}
                </Tag>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
    </div>
  );
}
