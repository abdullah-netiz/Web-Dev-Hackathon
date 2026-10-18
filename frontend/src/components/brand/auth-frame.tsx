import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "./logo";
import { RelayFigure } from "./relay-figure";

export function AuthFrame({ title, intro, children, footer }: { title: string; intro: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh w-full lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-5 py-6 sm:px-10 lg:px-16 lg:py-10">
        <Link href="/" className="w-fit" aria-label="Baton home">
          <Wordmark />
        </Link>
        <div className="flex flex-1 flex-col justify-center py-12">
          <div className="w-full max-w-[420px]">
            <h1 className="display text-[44px] text-ink sm:text-[56px]">{title}</h1>
            <p className="mt-4 text-[17px] leading-relaxed text-ink-soft">{intro}</p>
            <div className="mt-10">{children}</div>
          </div>
        </div>
        {footer && <div className="text-sm text-ink-soft">{footer}</div>}
      </div>
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-brand px-14 py-12 text-on-brand lg:flex">
        <p className="display max-w-[14ch] text-[64px] text-on-brand xl:text-[76px]">One lead. One owner. Always.</p>
        <RelayFigure />
        <p className="max-w-md text-[15px] leading-relaxed text-on-brand/75">
          When nobody answers in time, Baton hands the lead to the next available teammate, then their backup, then a manager, and tells each of them in Telegram.
        </p>
      </aside>
    </div>
  );
}
