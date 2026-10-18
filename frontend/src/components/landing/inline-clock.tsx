"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

const OWNERS = ["Bilal", "Priya", "Sara"];
const WINDOW = 9;
const HOLD = 4;

type S = { owner: number; left: number; acked: number };

function step(s: S): S {
  if (s.acked > 0) return s.acked === 1 ? { owner: 0, left: WINDOW, acked: 0 } : { ...s, acked: s.acked - 1 };
  if (s.owner === OWNERS.length - 1 && s.left === WINDOW - 3) return { ...s, acked: HOLD };
  if (s.left > 1) return { ...s, left: s.left - 1 };
  return { owner: (s.owner + 1) % OWNERS.length, left: WINDOW, acked: 0 };
}

/** The word in the sentence that is shown instead of said: a live acknowledgement clock that hands the lead on. */
export function InlineClock() {
  const [s, setS] = useState<S>({ owner: 0, left: WINDOW, acked: 0 });

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setS(step), 1000);
    return () => clearInterval(t);
  }, []);

  const acked = s.acked > 0;
  return (
    <span
      data-ui
      aria-hidden
      className="relative mr-[0.08em] inline-flex h-[0.6em] w-[2.15em] -translate-y-[0.06em] items-center overflow-hidden bg-ink align-baseline text-paper"
    >
      <span
        className="absolute inset-y-0 left-0 bg-[#9cc5c0] transition-[width,opacity] duration-1000 ease-linear"
        style={{ width: `${(s.left / WINDOW) * 100}%`, opacity: acked ? 0 : 0.28 }}
      />
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={acked ? "ack" : s.owner}
          initial={{ x: "-110%" }}
          animate={{ x: 0 }}
          exit={{ x: "110%" }}
          transition={{ duration: 0.55, ease: [0.65, 0, 0.35, 1] }}
          className="relative flex w-full items-center justify-between gap-[0.1em] px-[0.12em] font-sans text-[0.17em] leading-none font-semibold tracking-normal"
        >
          <span>{acked ? `${OWNERS[s.owner]} replied` : OWNERS[s.owner]}</span>
          <span className="tabular">{acked ? "done" : `0:${String(s.left).padStart(2, "0")}`}</span>
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
