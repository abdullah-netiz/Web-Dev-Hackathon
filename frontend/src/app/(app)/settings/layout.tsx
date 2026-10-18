"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { Permission } from "@/lib/api/types";
import { useCan } from "@/lib/session";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/misc";

const ITEMS: { href: string; label: string; perm?: Permission }[] = [
  { href: "/settings/profile", label: "Profile and alerts" },
  { href: "/settings/workspace", label: "Workspace and lead form" },
  { href: "/settings/members", label: "Members", perm: "users.manage" },
  { href: "/settings/roles", label: "Roles and permissions", perm: "roles.manage" },
  { href: "/settings/assignment", label: "Assignment rules", perm: "leads.manage_rules" },
  { href: "/settings/pipelines", label: "Pipelines and stages", perm: "settings.manage" },
  { href: "/settings/fields", label: "Custom fields", perm: "settings.manage" },
  { href: "/settings/integrations", label: "Integrations", perm: "integrations.view" },
];

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const can = useCan();
  const items = ITEMS.filter((i) => !i.perm || can(i.perm));
  const current = ITEMS.find((i) => i.href === pathname);
  const blocked = !!current?.perm && !can(current.perm);
  return (
    <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <nav aria-label="Settings" className="min-w-0 lg:sticky lg:top-10 lg:self-start">
        <h1 className="mb-4 text-[28px] font-semibold tracking-[-0.02em] text-ink">Settings</h1>
        <ul className="-mx-1 flex gap-1 overflow-x-auto pb-1 lg:mx-0 lg:flex-col lg:overflow-visible">
          {items.map((i) => {
            const active = pathname === i.href;
            return (
              <li key={i.href} className="shrink-0">
                <Link
                  href={i.href}
                  aria-current={active ? "page" : undefined}
                  className={cn("block rounded-[3px] px-3 py-2 text-sm whitespace-nowrap", active ? "bg-surface font-semibold text-ink" : "text-ink-soft hover:bg-surface/60 hover:text-ink")}
                >
                  {i.label}
                </Link>
              </li>
            );
          })}
        </ul>
        {items.length < ITEMS.length && <p className="mt-4 hidden text-[13px] text-ink-soft lg:block">Some settings are hidden because your role doesn&apos;t include them.</p>}
      </nav>
      <div className="min-w-0">
        {blocked ? (
          <EmptyState
            title={`${current!.label} is restricted.`}
            body="Your role doesn't include this permission. Ask an Owner or Admin to grant it in Settings → Roles and permissions."
          />
        ) : (
          children
        )}
      </div>
    </div>
  );
}
