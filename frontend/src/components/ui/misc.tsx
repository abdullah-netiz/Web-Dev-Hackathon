import type { ReactNode } from "react";
import { describeError } from "@/lib/api/errors";
import { cn, initials } from "@/lib/utils";
import { Button } from "./button";

const AVATAR_TONES = ["bg-teal text-on-teal", "bg-[#2f6f5e] text-paper", "bg-[#7c5c2e] text-paper", "bg-[#3d5a5f] text-paper", "bg-[#8a3b2a] text-paper", "bg-[#4b5d7a] text-paper"];

export function Avatar({ name, size = 28, className }: { name: string; size?: number; className?: string }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none", AVATAR_TONES[h % AVATAR_TONES.length], className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initials(name)}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block rounded-[3px] bg-[linear-gradient(90deg,var(--surface)_0%,var(--surface-2)_50%,var(--surface)_100%)] bg-[length:200%_100%] animate-[shimmer_1.4s_linear_infinite]", className)}
    />
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action, className }: { title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-start gap-3 rounded-[3px] bg-surface px-6 py-10", className)}>
      <svg viewBox="0 0 64 16" className="h-4 w-16 text-surface-3" aria-hidden>
        <rect x="0" y="5" width="40" height="6" fill="currentColor" />
        <rect x="46" y="5" width="18" height="6" fill="currentColor" opacity="0.5" />
      </svg>
      <p className="text-base font-semibold text-ink">{title}</p>
      {body && <div className="max-w-prose text-sm text-ink-soft">{body}</div>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const { title, action } = describeError(error);
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-3 rounded-[3px] bg-signal-tint px-6 py-6 text-signal", className)}>
      <p className="font-semibold">{title}</p>
      {action && <p className="text-sm text-ink">{action}</p>}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 pb-6 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-ink md:text-[32px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[15px] text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[3px] bg-surface-2 px-1 font-sans text-[11px] font-semibold text-ink-soft">{children}</kbd>;
}
