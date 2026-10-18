"use client";

import { ArrowSquareOutIcon, GoogleLogoIcon, TelegramLogoIcon } from "@phosphor-icons/react";
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
import { Avatar } from "@/components/ui/misc";
import { Tag } from "@/components/ui/status";

export default function ProfilePage() {
  const me = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const [link, setLink] = useState<{ code: string; url: string } | null>(null);
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
  const telegram = useMutation({
    mutationFn: () => api().integrations.telegramLink(),
    onSuccess: setLink,
    onError: (e) => toast.error(describeError(e).title),
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

      <SettingsSection title="Escalation alerts in Telegram" description="When a lead is handed to you because someone else missed their window, Baton messages you in Telegram with the lead's name, source, reason and a link.">
        <div className="flex flex-col gap-4 bg-surface p-5">
          <div className="flex items-center gap-3">
            <TelegramLogoIcon size={28} weight="bold" className="text-ink" aria-hidden />
            {u.telegramLinked ? (
              <Tag tone="ok" shape="check">
                Linked
              </Tag>
            ) : (
              <Tag tone="off" shape="ring">
                Not linked
              </Tag>
            )}
            <p className="text-[13px] text-ink-soft">{u.telegramLinked ? "Alerts go to your Telegram chat." : "You won't get alerts outside the app until you link it."}</p>
          </div>
          {link ? (
            <div className="bg-paper p-4">
              <p className="text-sm text-ink">
                Open the bot and press <span className="font-semibold">Start</span>. Your link code is <span className="tabular font-semibold">{link.code}</span>; it expires in 10 minutes.
              </p>
              <Button asChild className="mt-3">
                <a href={link.url} target="_blank" rel="noopener noreferrer">
                  Open Telegram <ArrowSquareOutIcon size={16} aria-hidden />
                </a>
              </Button>
            </div>
          ) : (
            <div>
              <Button variant={u.telegramLinked ? "outline" : "primary"} loading={telegram.isPending} onClick={() => telegram.mutate()}>
                {u.telegramLinked ? "Link a different chat" : "Link Telegram"}
              </Button>
            </div>
          )}
        </div>
      </SettingsSection>
    </div>
  );
}
