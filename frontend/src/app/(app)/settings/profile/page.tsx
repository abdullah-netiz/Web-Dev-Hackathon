"use client";

import { GoogleLogoIcon, SlackLogoIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api, describeError } from "@/lib/api";
import { useMe } from "@/lib/session";
import { AvailabilitySwitch } from "@/components/app/availability-switch";
import { SettingsSection } from "@/components/app/section";
import { ThemeSwitch } from "@/components/app/theme-switch";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Avatar } from "@/components/ui/misc";
import { Tag } from "@/components/ui/status";

export default function ProfilePage() {
  const me = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const [memberId, setMemberId] = useState("");
  const u = me.user;

  const google = useMutation({
    mutationFn: () => api().integrations.googleConnectUrl(),
    onSuccess: ({ url }) => {
      if (url.startsWith("/")) router.push(url);
      else window.location.href = url;
    },
    onError: (e) => toast.error(describeError(e).title, { description: describeError(e).action }),
  });
  const disconnect = useMutation({
    mutationFn: () => api().integrations.disconnectGoogle(),
    onSuccess: () => {
      toast.success("Google Calendar disconnected", { description: "Nobody can book appointments on your calendar until you reconnect." });
      void qc.invalidateQueries({ queryKey: ["session"] });
      void qc.invalidateQueries({ queryKey: ["members"] });
    },
  });
  const slack = useMutation({
    mutationFn: (slackUserId?: string) => api().integrations.slackLink(slackUserId ? { slackUserId } : {}),
    onSuccess: () => {
      toast.success("Slack linked", { description: "We sent you a test message in Slack." });
      setMemberId("");
      void qc.invalidateQueries({ queryKey: ["session"] });
      void qc.invalidateQueries({ queryKey: ["members"] });
    },
    onError: (e) => toast.error(describeError(e).title, { description: describeError(e).action }),
  });
  const unlinkSlack = useMutation({
    mutationFn: () => api().integrations.slackUnlink(),
    onSuccess: () => {
      toast.success("Slack unlinked", { description: "You will only see escalations inside the app." });
      void qc.invalidateQueries({ queryKey: ["session"] });
      void qc.invalidateQueries({ queryKey: ["members"] });
    },
  });

  return (
    <div className="flex flex-col gap-10">
      <SettingsSection title="You">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={u.name} size={56} />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold text-ink">{u.name}</p>
            <p className="text-sm text-ink-soft">
              {u.email} · {u.baseLevel === "OWNER" ? "Owner" : u.baseLevel === "ADMIN" ? "Admin" : u.roleName} · {u.timeZone.replace(/_/g, " ")}
            </p>
          </div>
          <div className="w-48">
            <AvailabilitySwitch user={u} />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Appearance" description="System follows your device's light or dark setting. Saved on this device.">
        <ThemeSwitch withLabels className="w-fit" />
      </SettingsSection>

      <SettingsSection
        title="Google Calendar"
        description="Connect your own calendar so teammates can book customers with you. Baton reads your busy times to avoid double-booking and adds the appointments it creates. Tokens stay on our server."
      >
        <div className="flex flex-col gap-4 bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <GoogleLogoIcon size={28} weight="bold" className="text-ink" aria-hidden />
            <div>
              {u.calendarStatus === "CONNECTED" && (
                <Tag tone="ok" shape="check">
                  Connected
                </Tag>
              )}
              {u.calendarStatus === "NEEDS_RECONNECT" && (
                <Tag tone="signal" shape="cross">
                  Needs reconnecting
                </Tag>
              )}
              {u.calendarStatus === "NOT_CONNECTED" && (
                <Tag tone="off" shape="ring">
                  Not connected
                </Tag>
              )}
              <p className="mt-1 text-[13px] text-ink-soft">
                {u.calendarStatus === "NEEDS_RECONNECT"
                  ? "Google stopped accepting our access (it expires after 7 days while the app is in testing). You can't be booked until you reconnect."
                  : u.calendarStatus === "NOT_CONNECTED"
                    ? "You can't be booked for appointments yet."
                    : "Teammates can book appointments on your calendar."}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {u.calendarStatus !== "CONNECTED" ? (
              <Button loading={google.isPending} onClick={() => google.mutate()}>
                {u.calendarStatus === "NEEDS_RECONNECT" ? "Reconnect Google" : "Connect Google"}
              </Button>
            ) : (
              <Button variant="outline" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
                Disconnect
              </Button>
            )}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Escalation alerts in Slack" description="When a lead is handed to you because someone else missed their window, Baton sends you a Slack direct message with the lead's name, source, reason and a link.">
        <div className="flex flex-col gap-4 bg-surface p-5">
          <div className="flex flex-wrap items-center gap-3">
            <SlackLogoIcon size={28} weight="bold" className="text-ink" aria-hidden />
            {u.slackLinked ? (
              <Tag tone="ok" shape="check">
                Linked
              </Tag>
            ) : (
              <Tag tone="off" shape="ring">
                Not linked
              </Tag>
            )}
            <p className="text-[13px] text-ink-soft">
              {u.slackLinked ? `Alerts go to Slack member ${u.slackUserId}.` : "If your Slack account uses " + u.email + ", alerts reach you automatically. Otherwise link it here."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant={u.slackLinked ? "outline" : "primary"} loading={slack.isPending && !slack.variables} onClick={() => slack.mutate(undefined)}>
              {u.slackLinked ? "Re-link by email and send a test" : "Link by my email"}
            </Button>
            {u.slackLinked && (
              <Button variant="ghost" loading={unlinkSlack.isPending} onClick={() => unlinkSlack.mutate()}>
                Unlink
              </Button>
            )}
          </div>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (memberId.trim()) slack.mutate(memberId.trim());
            }}
          >
            <div className="w-64">
              <Field label="Or use your Slack member ID" hint="Slack profile → ⋮ → Copy member ID (starts with U)">
                {(p) => <Input {...p} value={memberId} onChange={(e) => setMemberId(e.target.value)} placeholder="U0123ABCD" spellCheck={false} />}
              </Field>
            </div>
            <Button type="submit" variant="outline" loading={slack.isPending && !!slack.variables} disabled={!/^[UW][A-Z0-9]{6,}$/.test(memberId.trim())}>
              Link member ID
            </Button>
          </form>
        </div>
      </SettingsSection>
    </div>
  );
}
