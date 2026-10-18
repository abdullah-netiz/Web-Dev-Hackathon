"use client";

import { XIcon } from "@phosphor-icons/react";
import { Dialog as D } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  side,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  side?: "right";
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-ink/35 data-[state=open]:animate-[fade-in_180ms_ease-out]" />
      <D.Content
        className={cn(
          "fixed z-50 flex flex-col bg-paper text-ink shadow-[0_24px_64px_-24px_rgba(11,43,48,0.5)] focus:outline-none",
          side === "right"
            ? "inset-y-0 right-0 w-full max-w-lg data-[state=open]:animate-[slide-in-right_260ms_cubic-bezier(0.22,1,0.36,1)]"
            : "top-1/2 left-1/2 max-h-[min(92dvh,760px)] w-[calc(100vw-24px)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-[3px] data-[state=open]:animate-[dialog-in_220ms_cubic-bezier(0.22,1,0.36,1)]",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
          <div className="min-w-0">
            <D.Title className="text-lg font-semibold tracking-[-0.01em]">{title}</D.Title>
            {description ? (
              <D.Description className="mt-1 text-sm text-ink-soft">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</D.Description>
            )}
          </div>
          <D.Close className="-mr-2 rounded-[3px] p-2 text-ink-soft hover:bg-surface hover:text-ink" aria-label="Close">
            <XIcon size={18} />
          </D.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-2 pb-6">{children}</div>
      </D.Content>
    </D.Portal>
  );
}
