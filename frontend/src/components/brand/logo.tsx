import { cn } from "@/lib/utils";

/** The baton: one solid bar held, a short segment waiting to receive it. */
export function BatonMark({ className, handoff = false }: { className?: string; handoff?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-6 w-6", className)} aria-hidden>
      <rect x="2" y="12" width="20" height="8" fill="currentColor" className={cn("transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]", handoff && "translate-x-[6px]")} />
      <rect x="25" y="12" width="5" height="8" fill="currentColor" opacity="0.45" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-ink", className)}>
      <BatonMark />
      <span className="font-display text-[22px] leading-none tracking-[-0.02em]" style={{ fontWeight: 400 }}>
        baton
      </span>
    </span>
  );
}
