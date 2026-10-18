"use client";

import { useEffect, useRef, useState } from "react";

function fmt(total: number) {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** The industry average keeps ticking while you read; Baton's number never moves. */
export function WaitCost() {
  const ref = useRef<HTMLDivElement>(null);
  const [secs, setSecs] = useState(42 * 3600);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let t: ReturnType<typeof setInterval> | null = null;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting && !t) t = setInterval(() => setSecs((s) => s + 1), 1000);
      if (!e?.isIntersecting && t) {
        clearInterval(t);
        t = null;
      }
    });
    io.observe(el);
    return () => {
      io.disconnect();
      if (t) clearInterval(t);
    };
  }, []);

  return (
    <section id="why" className="bg-paper px-5 py-28 sm:px-8 lg:px-12 lg:py-36">
      <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div data-reveal>
          <p className="text-[15px] font-semibold text-teal">Why it matters</p>
          <h2 className="mt-3 text-[38px] leading-[1.05] font-semibold tracking-[-0.03em] text-ink sm:text-[52px]">The lead that waits is the lead you lose.</h2>
          <p className="mt-6 max-w-lg text-[18px] leading-relaxed text-ink-soft">
            When Harvard Business Review studied how 2,241 companies answered web leads, the average reply took 42 hours. The companies that replied within an hour were far more likely to
            have a real conversation. Speed isn&apos;t a nice-to-have. It is the sale.
          </p>
          <p className="mt-4 max-w-lg text-[18px] leading-relaxed text-ink-soft">
            Leads usually don&apos;t go cold because people are lazy. They go cold because nobody was sure whose they were.
          </p>
        </div>

        <div ref={ref} data-reveal className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-[14px] bg-surface p-6 ring-1 ring-line">
            <p className="text-[14px] font-medium text-ink-soft">The average company</p>
            <p className="tabular mt-4 text-[40px] leading-none font-semibold tracking-[-0.03em] text-signal sm:text-[44px]">{fmt(secs)}</p>
            <p className="mt-3 text-[14px] text-ink-soft">and counting, before anyone replies</p>
            <ul className="mt-6 space-y-1.5 text-[13.5px] text-ink">
              <li className="flex justify-between">
                <span>Owner</span>
                <span className="text-ink-soft">nobody in particular</span>
              </li>
              <li className="flex justify-between">
                <span>Window to reply</span>
                <span className="text-ink-soft">none</span>
              </li>
              <li className="flex justify-between">
                <span>If it&apos;s ignored</span>
                <span className="font-semibold text-signal">nothing happens</span>
              </li>
            </ul>
          </div>
          <div className="rounded-[14px] bg-ink p-6 text-paper">
            <p className="text-[14px] font-medium text-paper/70">A lead on Baton</p>
            <p className="tabular mt-4 text-[40px] leading-none font-semibold tracking-[-0.03em] text-[#9cc5c0] sm:text-[44px]">00:00:01</p>
            <p className="mt-3 text-[14px] text-paper/70">to have a named owner and a running clock</p>
            <ul className="mt-6 space-y-1.5 text-[13.5px] text-paper/85">
              <li className="flex justify-between">
                <span>Owner assigned</span>
                <span className="tabular">1 s</span>
              </li>
              <li className="flex justify-between">
                <span>Window to acknowledge</span>
                <span className="tabular">90 s</span>
              </li>
              <li className="flex justify-between">
                <span>Handed on if ignored</span>
                <span className="tabular">automatic</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
