"use client";

import { CheckIcon, GlobeSimpleIcon, PaperPlaneTiltIcon, PhoneIcon, WhatsappLogoIcon, type Icon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  name: string;
  source: "Web form" | "WhatsApp" | "Phone";
  msg: string;
  owner: string | null;
  left: number;
  total: number;
  state: "assigning" | "waiting" | "overdue" | "acked";
  passed?: number;
};

const SRC: Record<Row["source"], Icon> = { "Web form": GlobeSimpleIcon, WhatsApp: WhatsappLogoIcon, Phone: PhoneIcon };
const INITIALS: Record<string, string> = { "Bilal H.": "BH", "Priya N.": "PN", "Sara L.": "SL", "Tomás F.": "TF" };
const TONES: Record<string, string> = { "Bilal H.": "bg-[#2f6f5e]", "Priya N.": "bg-[#4b5d7a]", "Sara L.": "bg-[#7c5c2e]", "Tomás F.": "bg-teal" };

/** A scripted loop of the real product behaviour: arrive → assign → clock → escalate → acknowledge. */
const SCRIPT: { at: number; apply: (rows: Row[]) => Row[]; toast?: string }[] = [
  { at: 0, apply: () => [{ id: "b", name: "Kofi Asante", source: "WhatsApp", msg: "Do you install on tile roofs?", owner: "Priya N.", left: 0, total: 90, state: "acked" }] },
  { at: 0.6, apply: (r) => [{ id: "a", name: "Camila Ortiz", source: "Web form", msg: "Quote for panels and a battery, please", owner: null, left: 90, total: 90, state: "assigning" }, ...r] },
  { at: 1.6, apply: (r) => r.map((x) => (x.id === "a" ? { ...x, owner: "Bilal H.", state: "waiting" } : x)) },
  { at: 3.2, apply: (r) => [{ id: "c", name: "Ruth Adler", source: "Phone", msg: "Called about a site survey on Saturday", owner: null, left: 90, total: 90, state: "assigning" }, ...r] },
  { at: 4.0, apply: (r) => r.map((x) => (x.id === "c" ? { ...x, owner: "Tomás F.", state: "waiting" } : x)) },
  { at: 6.4, apply: (r) => r.map((x) => (x.id === "c" ? { ...x, state: "acked", left: 0 } : x)) },
  { at: 8.2, apply: (r) => r.map((x) => (x.id === "a" ? { ...x, state: "overdue", left: 0 } : x)) },
  {
    at: 9.2,
    apply: (r) => r.map((x) => (x.id === "a" ? { ...x, owner: "Priya N.", state: "waiting", left: 60, total: 60, passed: 1 } : x)),
    toast: "Escalated to you: Camila Ortiz",
  },
  { at: 12.4, apply: (r) => r.map((x) => (x.id === "a" ? { ...x, state: "acked", left: 0 } : x)) },
  { at: 15.5, apply: (r) => r },
];

function Clock({ row }: { row: Row }) {
  if (row.state === "acked")
    return (
      <span className="inline-flex items-center gap-1 rounded-[3px] bg-ok-tint px-1.5 py-0.5 text-[11.5px] font-semibold text-ok">
        <CheckIcon size={11} weight="bold" aria-hidden /> <span className="sm:hidden">Done</span><span className="hidden sm:inline">Acknowledged</span>
      </span>
    );
  if (row.state === "assigning") return <span className="text-[11.5px] text-ink-soft">Finding an owner…</span>;
  const overdue = row.state === "overdue";
  return (
    <div className="w-[76px] sm:w-[88px]">
      <div className="flex items-baseline justify-end gap-1">
        {overdue && <span className="text-[10.5px] font-semibold text-signal">Overdue</span>}
        <span className={cn("tabular text-[13px] font-semibold", overdue ? "text-signal" : "text-ink")}>
          {overdue ? "0:00" : `${Math.floor(row.left / 60)}:${String(row.left % 60).padStart(2, "0")}`}
        </span>
      </div>
      <div className="mt-1 h-[3px] bg-surface-2">
        <div className={cn("h-full origin-left transition-transform duration-500 ease-linear", overdue ? "bg-signal" : "bg-teal")} style={{ transform: `scaleX(${overdue ? 1 : row.left / row.total})` }} />
      </div>
    </div>
  );
}

export function HeroDemo() {
  const [rows, setRows] = useState<Row[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setRows(SCRIPT.slice(0, 5).reduce((r, s) => s.apply(r), [] as Row[]));
      return;
    }
    let timers: ReturnType<typeof setTimeout>[] = [];
    const run = () => {
      setRows([]);
      setToast(null);
      timers = SCRIPT.map((s, i) =>
        setTimeout(() => {
          setRows((r) => s.apply(r));
          if (s.toast) {
            setToast(s.toast);
            timers.push(setTimeout(() => setToast(null), 2600));
          }
          if (i === SCRIPT.length - 1) timers.push(setTimeout(run, 300));
        }, s.at * 1000),
      );
    };
    run();
    const drain = setInterval(() => setRows((r) => r.map((x) => (x.state === "waiting" ? { ...x, left: Math.max(1, x.left - 9) } : x))), 500);
    return () => {
      timers.forEach(clearTimeout);
      clearInterval(drain);
    };
  }, []);

  return (
    <div data-ui aria-hidden className="relative">
      <div className="overflow-hidden rounded-[10px] bg-paper shadow-[0_40px_80px_-30px_rgba(11,43,48,0.35),0_0_0_1px_rgba(11,43,48,0.08)]">
        <div className="flex items-center justify-between border-b border-line bg-surface/60 px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-surface-3" />
            <span className="h-2.5 w-2.5 rounded-full bg-surface-3" />
            <span className="h-2.5 w-2.5 rounded-full bg-surface-3" />
          </div>
          <span className="text-[12px] font-medium text-ink-soft">Leads · Northwind Solar</span>
          <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ok">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
            </span>
            Live
          </span>
        </div>
        <div className="flex items-center gap-1 border-b border-line px-3 py-2 text-[12px]">
          {["Open", "Waiting", "Acknowledged", "Recovery"].map((t, k) => (
            <span key={t} className={cn("rounded-[5px] px-2.5 py-1 font-medium", k === 0 ? "bg-surface text-ink" : "text-ink-soft", k === 3 && "hidden sm:inline")}>
              {t}
              {k === 0 && <span className="tabular ml-1.5 text-ink-soft">{rows.length}</span>}
            </span>
          ))}
        </div>
        <ul className="min-h-[234px] divide-y divide-line">
          <AnimatePresence initial={false}>
            {rows.map((r) => {
              const S = SRC[r.source];
              return (
                <motion.li
                  key={r.id}
                  layout
                  initial={{ opacity: 0, y: -18, backgroundColor: "rgba(6,82,92,0.10)" }}
                  animate={{ opacity: 1, y: 0, backgroundColor: r.state === "overdue" ? "rgba(185,58,20,0.08)" : "rgba(6,82,92,0)" }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  className="relative flex items-center gap-3 px-4 py-3.5"
                >
                  <span className={cn("absolute top-0 bottom-0 left-0 w-[3px] transition-colors duration-300", r.state === "acked" ? "bg-ok" : r.state === "overdue" ? "bg-signal" : "bg-teal")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[14px] font-semibold text-ink">{r.name}</span>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-[3px] bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink-soft">
                        <S size={11} aria-hidden /> {r.source}
                      </span>
                      {r.passed ? <span className="hidden shrink-0 text-[11px] text-ink-soft sm:inline">passed on {r.passed}×</span> : null}
                    </div>
                    <p className="mt-0.5 truncate text-[12.5px] text-ink-soft">{r.msg}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 sm:w-[92px]">
                    <AnimatePresence mode="popLayout" initial={false}>
                      {r.owner && (
                        <motion.span
                          key={r.owner}
                          initial={{ x: -14, opacity: 0, scale: 0.8 }}
                          animate={{ x: 0, opacity: 1, scale: 1 }}
                          exit={{ x: 14, opacity: 0, scale: 0.8 }}
                          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                          className="flex items-center gap-1.5"
                        >
                          <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white", TONES[r.owner])}>{INITIALS[r.owner]}</span>
                          <span className="hidden text-[12px] text-ink sm:inline">{r.owner}</span>
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                  <div className="flex w-[84px] shrink-0 justify-end sm:w-[100px]">
                    <Clock row={r} />
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
        <div className="grid grid-cols-3 border-t border-line bg-surface/60 text-center">
          {[
            { k: "Waiting", v: String(rows.filter((r) => r.state === "waiting" || r.state === "assigning").length) },
            { k: "Avg first response", v: "47s" },
            { k: "In recovery", v: String(rows.filter((r) => r.state === "overdue").length) },
          ].map((s, i) => (
            <div key={s.k} className={cn("px-3 py-2.5", i > 0 && "border-l border-line")}>
              <p className={cn("tabular text-[15px] font-semibold", s.k === "In recovery" && s.v !== "0" ? "text-signal" : "text-ink")}>{s.v}</p>
              <p className="text-[11px] text-ink-soft">{s.k}</p>
            </div>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-2 -bottom-10 w-64 rounded-[10px] bg-ink p-3.5 text-paper shadow-[0_24px_48px_-16px_rgba(0,0,0,0.5)] sm:-right-8"
          >
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-[#9cc5c0]">
              <PaperPlaneTiltIcon size={12} weight="fill" aria-hidden /> Telegram · Baton bot
            </p>
            <p className="mt-1 text-[13px] font-semibold">{toast}</p>
            <p className="mt-0.5 text-[12px] text-paper/70">Bilal didn&apos;t reply in 90 s. You have 60 s.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
