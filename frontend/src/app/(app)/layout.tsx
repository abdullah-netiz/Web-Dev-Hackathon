"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { BatonMark } from "@/components/brand/logo";
import { AppShell } from "@/components/app/shell";
import { RealtimeBridge } from "@/components/app/realtime-bridge";
import { ErrorState } from "@/components/ui/misc";
import { isApiError } from "@/lib/api/errors";
import { useSession } from "@/lib/session";

export default function AppLayout({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const unauth = session.isError && isApiError(session.error) && session.error.status === 401;

  useEffect(() => {
    if (unauth) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [unauth, router, pathname]);

  if (session.isPending || unauth) {
    return (
      <div className="flex min-h-dvh items-center justify-center" role="status" aria-label="Loading your workspace">
        <BatonMark className="h-10 w-10 animate-pulse text-teal" />
      </div>
    );
  }
  if (session.isError) {
    return (
      <div className="mx-auto max-w-md p-6 pt-24">
        <ErrorState error={session.error} onRetry={() => session.refetch()} />
      </div>
    );
  }
  return (
    <AppShell>
      <RealtimeBridge />
      {children}
    </AppShell>
  );
}
