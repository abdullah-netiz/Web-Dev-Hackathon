import type { ReactNode } from "react";

export function SettingsSection({ title, description, children, aside }: { title: string; description?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-b border-line pb-10 last:border-0" aria-label={title}>
      <div className="flex flex-col gap-3 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.01em] text-ink">{title}</h2>
          {description && <p className="mt-1 max-w-2xl text-sm text-ink-soft">{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
