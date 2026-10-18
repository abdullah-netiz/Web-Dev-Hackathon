"use client";

import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { Button } from "@/components/ui/button";

const REASONS: Record<string, string> = {
  access_denied: "You chose not to give Baton access. Nothing was connected.",
  invalid_grant: "Google rejected the sign-in, usually because it took too long or the account isn't a listed test user.",
  not_test_user: "This Google account isn't on the app's test-user list yet. Ask an Admin to add it.",
};

function Result() {
  const params = useSearchParams();
  const qc = useQueryClient();
  const ok = params.get("status") === "connected";
  const reason = params.get("reason") ?? params.get("error") ?? "";
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ["session"] });
    void qc.invalidateQueries({ queryKey: ["members"] });
  }, [qc]);
  return (
    <div className="mx-auto max-w-lg pt-10">
      {ok ? <CheckCircleIcon size={44} weight="fill" className="text-ok" aria-hidden /> : <WarningCircleIcon size={44} weight="fill" className="text-signal" aria-hidden />}
      <h1 className="mt-4 text-[32px] font-semibold tracking-[-0.02em] text-ink">{ok ? "Google Calendar connected." : "Google Calendar wasn't connected."}</h1>
      <p className="mt-3 text-[17px] leading-relaxed text-ink-soft">
        {ok
          ? "Teammates can now book customers with you. Baton checks your busy times first and adds each appointment to your calendar."
          : (REASONS[reason] ?? "Something went wrong during the Google sign-in. Try again in a minute.")}
      </p>
      <div className="mt-8 flex gap-2">
        <Button asChild>
          <Link href="/settings/profile">{ok ? "Back to settings" : "Try again"}</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/dashboard">Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}

export default function GoogleResultPage() {
  return (
    <Suspense>
      <Result />
    </Suspense>
  );
}
