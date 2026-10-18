import { cn, initials } from "@/lib/utils";

export function CompanyMark({ name, size = 44, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-[6px] bg-teal-tint font-display text-teal ring-1 ring-teal/15", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), fontWeight: 400 }}
    >
      {initials(name)}
    </span>
  );
}
