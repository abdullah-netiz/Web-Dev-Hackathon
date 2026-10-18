"use client";

import { DropdownMenu as M } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;

export function MenuContent({ children, align = "end", className }: { children: ReactNode; align?: "start" | "end" | "center"; className?: string }) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={6}
        className={cn(
          "z-50 min-w-48 rounded-[3px] bg-paper p-1 text-sm text-ink shadow-[0_16px_40px_-12px_rgba(11,43,48,0.35)] ring-1 ring-line",
          "data-[state=open]:animate-[pop-in_160ms_cubic-bezier(0.22,1,0.36,1)]",
          className,
        )}
      >
        {children}
      </M.Content>
    </M.Portal>
  );
}

export function MenuItem({ className, ...props }: ComponentProps<typeof M.Item>) {
  return (
    <M.Item
      className={cn(
        "flex cursor-default items-center gap-2 rounded-[3px] px-2.5 py-2 outline-none select-none",
        "data-[highlighted]:bg-surface data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof M.Label>) {
  return <M.Label className={cn("px-2.5 pt-2 pb-1 text-[13px] text-ink-soft", className)} {...props} />;
}

export function MenuSeparator() {
  return <M.Separator className="my-1 h-px bg-line" />;
}

export const MenuRadioGroup = M.RadioGroup;

export function MenuRadioItem({ className, children, ...props }: ComponentProps<typeof M.RadioItem>) {
  return (
    <M.RadioItem
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-[3px] py-2 pr-2.5 pl-8 outline-none select-none data-[highlighted]:bg-surface",
        className,
      )}
      {...props}
    >
      <M.ItemIndicator className="absolute left-2.5">
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
          <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      </M.ItemIndicator>
      {children}
    </M.RadioItem>
  );
}
