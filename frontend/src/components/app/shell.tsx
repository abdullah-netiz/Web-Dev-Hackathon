"use client";

import {
  AddressBookIcon,
  BuildingsIcon,
  CalendarDotsIcon,
  ChartLineUpIcon,
  ChatsCircleIcon,
  CreditCardIcon,
  FunnelSimpleIcon,
  GearSixIcon,
  LifebuoyIcon,
  ListIcon,
  ScrollIcon,
  SignOutIcon,
  TrayIcon,
  UsersThreeIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { Permission } from "@/lib/api/types";
import { useCan, useMe } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Wordmark } from "@/components/brand/logo";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Avatar } from "@/components/ui/misc";
import { AvailabilitySwitch } from "./availability-switch";
import { DemoPanel } from "./demo-panel";
import { ThemeSwitch } from "./theme-switch";

interface NavItem {
  href: string;
  label: string;
  icon: Icon;
  perm?: Permission;
  count?: "myLeads" | "recovery" | "unread";
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Today",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: ChartLineUpIcon },
      { href: "/leads", label: "Leads", icon: TrayIcon, count: "myLeads" },
      { href: "/recovery", label: "Recovery queue", icon: LifebuoyIcon, count: "recovery" },
      { href: "/conversations", label: "Conversations", icon: ChatsCircleIcon, count: "unread" },
    ],
  },
  {
    group: "Customers",
    items: [
      { href: "/contacts", label: "Contacts", icon: AddressBookIcon, perm: "crm.view" },
      { href: "/companies", label: "Companies", icon: BuildingsIcon, perm: "crm.view" },
      { href: "/opportunities", label: "Opportunities", icon: FunnelSimpleIcon, perm: "crm.view" },
      { href: "/payments", label: "Payments", icon: CreditCardIcon, perm: "crm.view" },
      { href: "/appointments", label: "Appointments", icon: CalendarDotsIcon },
    ],
  },
  {
    group: "Team",
    items: [
      { href: "/team", label: "Availability", icon: UsersThreeIcon },
      { href: "/audit", label: "Audit history", icon: ScrollIcon, perm: "audit.view" },
      { href: "/settings", label: "Settings", icon: GearSixIcon },
    ],
  },
];

function useCounts() {
  const me = useMe();
  const myLeads = useQuery({
    queryKey: ["leads", "mine", "OPEN", ""],
    queryFn: () => api().leads.list({ scope: "mine", status: "OPEN" }),
    refetchInterval: 30_000,
  });
  const recovery = useQuery({ queryKey: ["recovery"], queryFn: () => api().leads.recovery(), refetchInterval: 30_000 });
  const convs = useQuery({ queryKey: ["conversations"], queryFn: () => api().conversations.list() });
  return {
    myLeads: myLeads.data?.filter((l) => l.status === "ASSIGNED" && l.ownerId === me.user.id).length ?? 0,
    recovery: recovery.data?.length ?? 0,
    unread: convs.data?.reduce((s, c) => s + c.unreadCount, 0) ?? 0,
  };
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const can = useCan();
  const counts = useCounts();
  return (
    <nav aria-label="Main" className="flex flex-col gap-6">
      {NAV.map((g) => {
        const items = g.items.filter((i) => !i.perm || can(i.perm));
        if (!items.length) return null;
        return (
          <div key={g.group}>
            <p className="px-3 pb-1.5 text-[12.5px] text-ink-faint">{g.group}</p>
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const n = item.count ? counts[item.count] : 0;
                return (
                  <li key={item.href} className="relative">
                    {active && (
                      <motion.span
                        layoutId="nav-baton"
                        className="absolute top-1.5 bottom-1.5 left-0 w-[3px] bg-teal"
                        transition={{ type: "spring", stiffness: 520, damping: 40 }}
                        aria-hidden
                      />
                    )}
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-9 items-center gap-3 rounded-[3px] px-3 text-sm transition-colors",
                        active ? "bg-paper font-semibold text-ink" : "text-ink-soft hover:bg-surface-2 hover:text-ink",
                      )}
                    >
                      <item.icon size={18} weight={active ? "fill" : "regular"} aria-hidden />
                      <span className="flex-1">{item.label}</span>
                      {n > 0 && (
                        <span
                          className={cn(
                            "tabular min-w-5 rounded-[3px] px-1.5 text-center text-[12px] leading-5 font-semibold",
                            item.count === "recovery" ? "bg-signal text-on-signal" : "bg-teal text-on-teal",
                          )}
                          aria-label={`${n} ${item.count === "unread" ? "unread" : item.count === "recovery" ? "in recovery" : "waiting for you"}`}
                        >
                          {n}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function UserBlock() {
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  async function logout() {
    await api().auth.logout();
    qc.clear();
    router.replace("/login");
  }
  return (
    <div className="flex flex-col gap-1 rounded-[3px] bg-surface-2/60 p-2">
      <AvailabilitySwitch user={me.user} />
      <ThemeSwitch className="mx-1 my-1" />
      <Menu>
        <MenuTrigger className="flex w-full items-center gap-2.5 rounded-[3px] px-2 py-1.5 text-left hover:bg-surface-2" aria-label="Account menu">
          <Avatar name={me.user.name} size={28} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-ink">{me.user.name}</span>
            <span className="block truncate text-[12px] text-ink-soft">
              {me.user.baseLevel === "OWNER" ? "Owner" : me.user.baseLevel === "ADMIN" ? "Admin" : me.user.roleName}
            </span>
          </span>
        </MenuTrigger>
        <MenuContent align="start" className="w-60">
          <MenuLabel>{me.user.email}</MenuLabel>
          <MenuItem onSelect={() => router.push("/settings/profile")}>Profile and notifications</MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={logout}>
            <SignOutIcon size={16} aria-hidden /> Log out
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-dvh w-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-teal focus:px-3 focus:py-2 focus:text-on-teal">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 overflow-y-auto bg-surface px-3 py-5 lg:flex">
        <div className="px-3">
          <Link href="/dashboard" aria-label="Baton home">
            <Wordmark />
          </Link>
          <p className="mt-2 truncate text-[13px] text-ink-soft">{me.workspace.name}</p>
        </div>
        <NavList />
        <div className="mt-auto flex flex-col gap-2">
          <DemoPanel />
          <UserBlock />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-paper/95 px-4 lg:hidden">
          <Link href="/dashboard" aria-label="Baton home">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-1">
          <DemoPanel placement="header" />
          <Dialog open={open} onOpenChange={setOpen}>
            <button onClick={() => setOpen(true)} className="rounded-[3px] p-2 text-ink hover:bg-surface" aria-label="Open navigation">
              <ListIcon size={22} />
            </button>
            <DialogContent title={me.workspace.name} side="right" className="max-w-xs bg-surface">
              <div className="flex flex-col gap-6">
                <NavList onNavigate={() => setOpen(false)} />
                <UserBlock />
              </div>
            </DialogContent>
          </Dialog>
          </div>
        </header>
        <main id="main" className="w-full min-w-0 flex-1 px-4 pt-6 pb-16 md:px-8 md:pt-10 xl:px-12">
          {children}
        </main>
      </div>
    </div>
  );
}
