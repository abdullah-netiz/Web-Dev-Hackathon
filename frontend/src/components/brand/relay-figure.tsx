"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useRef } from "react";

gsap.registerPlugin(useGSAP);

const LANES = [
  { name: "Bilal H.", role: "Sales" },
  { name: "Priya N.", role: "Backup" },
  { name: "Sara L.", role: "Manager" },
];

/**
 * The product's rule as a figure: one lead, one holder. The clock drains;
 * if nobody acknowledges, the baton moves down a lane. On the last lane it is acknowledged.
 */
export function RelayFigure({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.2, defaults: { ease: "power3.inOut" } });
        const baton = ".js-baton";
        const clocks = gsap.utils.toArray<HTMLElement>(".js-clock");
        const notes = gsap.utils.toArray<HTMLElement>(".js-note");
        gsap.set(baton, { yPercent: 0 });
        gsap.set(clocks, { scaleX: 1 });
        gsap.set(notes, { autoAlpha: 0, y: 6 });
        clocks.forEach((clock, i) => {
          const isLast = i === clocks.length - 1;
          tl.to(clock, { scaleX: isLast ? 0.55 : 0, duration: isLast ? 1.4 : 2.4, ease: "none" });
          tl.to(notes[i]!, { autoAlpha: 1, y: 0, duration: 0.35, ease: "power2.out" }, "<+=" + (isLast ? 1.2 : 2.1));
          if (!isLast) tl.to(baton, { yPercent: (i + 1) * 100, duration: 0.7 }, ">-0.05");
        });
        tl.to({}, { duration: 1.6 });
        tl.to([...notes, baton], { autoAlpha: 0, duration: 0.4 });
        tl.set(baton, { yPercent: 0 });
        tl.set(clocks, { scaleX: 1 });
        tl.to(baton, { autoAlpha: 1, duration: 0.3 });
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  const dark = tone === "dark";
  return (
    <div ref={root} className="relative w-full max-w-md" data-ui aria-hidden>
      <div className={dark ? "text-[13px] text-paper/70" : "text-[13px] text-ink-soft"}>Lead · Camila Ortiz · Web form</div>
      <div className="relative mt-3">
        <div className={`js-baton absolute top-0 left-0 z-10 h-1/3 w-[6px] ${dark ? "bg-[#f2c94c]" : "bg-teal"}`} />
        {LANES.map((lane, i) => (
          <div key={lane.name} className={`relative flex h-[76px] items-center gap-4 pl-6 ${i ? (dark ? "mt-0 border-t border-paper/12" : "border-t border-line") : ""}`}>
            <div className="min-w-0 flex-1">
              <div className={dark ? "text-[17px] font-medium text-paper" : "text-[17px] font-medium text-ink"}>{lane.name}</div>
              <div className={`js-note text-[13px] ${dark ? "text-[#f2c94c]" : "text-signal"}`}>
                {i < LANES.length - 1 ? "No response — handed on" : "Acknowledged in 0:41"}
              </div>
            </div>
            <div className="w-28 shrink-0">
              <div className={dark ? "text-right text-[12px] text-paper/60" : "text-right text-[12px] text-ink-soft"}>{lane.role}</div>
              <div className={`mt-1.5 h-1.5 w-full ${dark ? "bg-paper/15" : "bg-surface-2"}`}>
                <div className={`js-clock h-full w-full origin-left ${dark ? "bg-paper" : "bg-teal"}`} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
