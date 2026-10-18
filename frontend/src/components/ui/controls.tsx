"use client";

import { Checkbox as C, Switch as S, Tabs as T, Tooltip as Tip } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: ComponentProps<typeof S.Root>) {
  return (
    <S.Root
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full bg-surface-3 transition-colors duration-200",
        "data-[state=checked]:bg-teal disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <S.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-paper transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] data-[state=checked]:translate-x-[18px]" />
    </S.Root>
  );
}

export function Checkbox({ className, ...props }: ComponentProps<typeof C.Root>) {
  return (
    <C.Root
      className={cn(
        "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[3px] bg-paper ring-1 ring-inset ring-surface-3",
        "data-[state=checked]:bg-teal data-[state=checked]:ring-teal disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <C.Indicator className="text-on-teal">
        <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden>
          <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" />
        </svg>
      </C.Indicator>
    </C.Root>
  );
}

export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ className, ...props }: ComponentProps<typeof T.List>) {
  return <T.List className={cn("flex gap-1 overflow-x-auto rounded-[3px] bg-surface p-1", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        "h-8 shrink-0 rounded-[3px] px-3 text-[13px] font-medium text-ink-soft transition-colors",
        "hover:text-ink data-[state=active]:bg-paper data-[state=active]:text-ink",
        className,
      )}
      {...props}
    />
  );
}

export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <Tip.Provider delayDuration={250}>
      <Tip.Root>
        <Tip.Trigger asChild>{children}</Tip.Trigger>
        <Tip.Portal>
          <Tip.Content side={side} sideOffset={6} className="z-50 max-w-64 rounded-[3px] bg-ink px-2.5 py-1.5 text-[13px] text-paper data-[state=delayed-open]:animate-[pop-in_140ms_ease-out]">
            {content}
          </Tip.Content>
        </Tip.Portal>
      </Tip.Root>
    </Tip.Provider>
  );
}
