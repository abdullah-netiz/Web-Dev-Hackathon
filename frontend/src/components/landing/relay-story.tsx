"use client";

import { useGSAP } from "@gsap/react";
import {
  ArrowBendDownRightIcon,
  CheckIcon,
  GlobeSimpleIcon,
  LifebuoyIcon,
  PaperPlaneTiltIcon,
  PhoneIcon,
  WhatsappLogoIcon,
} from "@phosphor-icons/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const STEPS = [
  {
    kicker: "Capture",
    title: "Leads arrive from anywhere.",
    body: "Your website form, a WhatsApp message to your number, or a call someone logs by hand. Each lead is labelled with where it came from, and a known phone number attaches to the customer you already have.",
  },
  {
    kicker: "Assign",
    title: "One owner, picked fairly.",
    body: "Baton hands each lead to the next teammate in turn, but only people who are Available and under their open-lead limit. Busy, on leave and offline never receive leads.",
  },
  {
    kicker: "Clock",
    title: "A clock everyone can see.",
    body: "The owner has a window, 90 seconds by default, to acknowledge. A reply, a note, a booking or a stage change all count. The time left is on every screen.",
  },
  {
    kicker: "Hand-off",
    title: "Ignored? It moves on its own.",
    body: "When the window runs out, the lead goes to the next available teammate, then the owner's designated backup, then a manager. Each new owner gets a Slack message with a link straight to it.",
  },
  {
    kicker: "Recover",
    title: "Nothing slips away quietly.",
    body: "Leads that ran out of time, were passed on twice, or have gone untouched land in the recovery queue with the reason shown, so a manager can step in before the customer gives up.",
  },
];

function Avatar({ i, n }: { i: string; n: string }) {
  const tone: Record<string, string> = { BH: "bg-[#2f6f5e]", PN: "bg-[#4b5d7a]", SL: "bg-[#7c5c2e]", TF: "bg-teal", HK: "bg-[#8a3b2a]" };
  return (
    <span className="flex items-center gap-2">
      <span className={cn("flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-white", tone[i])}>{i}</span>
      <span className="text-[13px] font-medium text-ink">{n}</span>
    </span>
  );
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-[12px] bg-paper p-5 shadow-[0_24px_60px_-30px_rgba(11,43,48,0.35),0_0_0_1px_rgba(11,43,48,0.08)]", className)}>{children}</div>;
}

function LiveClock() {
  const [left, setLeft] = useState(90);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setLeft((l) => (l > 0 ? l - 1 : 90)), 1000);
    return () => clearInterval(t);
  }, []);
  const urgent = left < 27;
  return (
    <>
      <p className={cn("tabular mt-6 text-[76px] leading-none font-semibold tracking-[-0.04em] transition-colors", urgent ? "text-signal" : "text-ink")}>
        {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
      </p>
      <p className="mt-1 text-[14px] text-ink-soft">left to acknowledge Camila Ortiz{urgent && <span className="font-semibold text-signal"> · due soon</span>}</p>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-surface-2">
        <div className={cn("h-full origin-left rounded-full transition-[transform,background-color] duration-1000 ease-linear", urgent ? "bg-signal" : "bg-teal")} style={{ transform: `scaleX(${left / 90})` }} />
      </div>
    </>
  );
}

function Visual({ step }: { step: number }) {
  if (step === 0)
    return (
      <div className="flex flex-col gap-3">
        {[
          { icon: GlobeSimpleIcon, src: "Web form", name: "Camila Ortiz", msg: "Quote for panels and a battery" },
          { icon: WhatsappLogoIcon, src: "WhatsApp", name: "+1 415 555 7731", msg: "How much for a 3-bedroom house?" },
          { icon: PhoneIcon, src: "Logged call", name: "Ruth Adler", msg: "Wants a survey on Saturday" },
        ].map((l, k) => (
          <motion.div key={l.src} initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: k * 0.12, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
            <Card className="flex items-center gap-4 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-teal-tint text-teal">
                <l.icon size={20} weight="duotone" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-teal">{l.src}</p>
                <p className="truncate text-[15px] font-semibold text-ink">{l.name}</p>
                <p className="truncate text-[13px] text-ink-soft">{l.msg}</p>
              </div>
              <span className="text-[12px] text-ink-faint">now</span>
            </Card>
          </motion.div>
        ))}
      </div>
    );
  if (step === 1)
    return (
      <Card>
        <p className="text-[13px] text-ink-soft">Who can take Camila Ortiz?</p>
        <ul className="mt-4 flex flex-col gap-2.5">
          {[
            { i: "BH", n: "Bilal Hussain", s: "Available", load: "3 of 8", pick: true },
            { i: "PN", n: "Priya Nair", s: "Available", load: "5 of 8" },
            { i: "TF", n: "Tomás Ferreira", s: "Busy", load: "skipped", off: true },
            { i: "HK", n: "Hana Kobayashi", s: "On leave", load: "skipped", off: true },
          ].map((p, k) => (
            <motion.li
              key={p.n}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: p.off ? 0.45 : 1, y: 0 }}
              transition={{ delay: k * 0.08, duration: 0.4 }}
              className={cn("flex items-center justify-between rounded-[8px] px-3 py-2.5", p.pick ? "bg-teal-tint ring-1 ring-teal/30" : "bg-surface")}
            >
              <Avatar i={p.i} n={p.n} />
              <span className="flex items-center gap-3 text-[12.5px]">
                <span className={p.off ? "text-ink-soft" : "text-ok"}>{p.s}</span>
                <span className="tabular w-16 text-right text-ink-soft">{p.load}</span>
              </span>
            </motion.li>
          ))}
        </ul>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="mt-4 flex items-center gap-2 text-[13.5px] font-semibold text-teal">
          <CheckIcon size={16} weight="bold" /> Assigned to Bilal Hussain in 1 second
        </motion.p>
      </Card>
    );
  if (step === 2)
    return (
      <Card className="p-7">
        <div className="flex items-center justify-between">
          <Avatar i="BH" n="Bilal Hussain has" />
          <span className="rounded-[4px] bg-teal-tint px-2 py-1 text-[12px] font-semibold text-teal">Waiting for ack</span>
        </div>
        <LiveClock />
        <div className="mt-6 grid grid-cols-3 gap-2 text-center text-[12.5px]">
          {["Reply on WhatsApp", "Add a note", "Book a visit"].map((t) => (
            <span key={t} className="rounded-[6px] bg-surface px-2 py-2 text-ink">
              {t}
            </span>
          ))}
        </div>
        <p className="mt-2 text-center text-[12px] text-ink-soft">Any of these stops the clock</p>
      </Card>
    );
  if (step === 3)
    return (
      <div className="relative">
        <Card>
          <p className="text-[13px] text-ink-soft">Camila Ortiz · who has held it</p>
          <ol className="mt-4 flex flex-col gap-2">
            {[
              { i: "BH", n: "Bilal Hussain", r: "First owner", st: "No response", tone: "signal" },
              { i: "PN", n: "Priya Nair", r: "Next teammate", st: "Holding now", tone: "teal" },
              { i: "SL", n: "Sara Lindqvist", r: "Manager, if needed", st: "Next", tone: "off" },
            ].map((x, k) => (
              <motion.li
                key={x.n}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: k * 0.18, duration: 0.45 }}
                className="flex items-center justify-between rounded-[8px] bg-surface px-3 py-2.5"
              >
                <span className="flex items-center gap-3">
                  <span className={cn("h-8 w-[3px] rounded-full", x.tone === "signal" ? "bg-signal" : x.tone === "teal" ? "bg-teal" : "bg-surface-3")} />
                  <span>
                    <Avatar i={x.i} n={x.n} />
                    <span className="ml-9 block text-[12px] text-ink-soft">{x.r}</span>
                  </span>
                </span>
                <span className={cn("text-[12.5px] font-semibold", x.tone === "signal" ? "text-signal" : x.tone === "teal" ? "text-teal" : "text-ink-soft")}>{x.st}</span>
              </motion.li>
            ))}
          </ol>
        </Card>
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.6, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="relative mt-4 ml-auto w-[min(100%,300px)] rounded-[12px] bg-ink p-4 text-paper shadow-[0_24px_48px_-16px_rgba(0,0,0,0.5)] lg:absolute lg:-right-6 lg:-bottom-16 lg:mt-0"
        >
          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[#9cc5c0]">
            <PaperPlaneTiltIcon size={12} weight="fill" /> Slack · to Priya
          </p>
          <p className="mt-1 text-[14px] font-semibold">Escalated to you: Camila Ortiz</p>
          <p className="mt-0.5 text-[12.5px] text-paper/70">Web form · Bilal didn&apos;t reply in 90 s. Open the lead →</p>
        </motion.div>
      </div>
    );
  return (
    <Card>
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <LifebuoyIcon size={18} className="text-signal" /> Recovery queue
        </p>
        <span className="rounded-[4px] bg-signal-tint px-2 py-0.5 text-[12px] font-semibold text-signal">3 need a manager</span>
      </div>
      <ul className="mt-4 flex flex-col gap-2">
        {[
          { n: "Diego Brennan", why: "Not acknowledged in time", tag: "Overdue" },
          { n: "Ethan Mensah", why: "Passed on twice with no reply", tag: "Escalated twice" },
          { n: "Nora Rossi", why: "No action for an hour after the first reply", tag: "Idle" },
        ].map((x, k) => (
          <motion.li key={x.n} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: k * 0.1 }} className="flex items-center justify-between gap-3 rounded-[8px] bg-surface px-3 py-3">
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold text-ink">{x.n}</span>
              <span className="block truncate text-[12.5px] text-ink-soft">{x.why}</span>
            </span>
            <span className={cn("shrink-0 rounded-[4px] px-2 py-0.5 text-[12px] font-semibold", x.tag === "Idle" ? "bg-warn-tint text-warn" : "bg-signal-tint text-signal")}>{x.tag}</span>
          </motion.li>
        ))}
      </ul>
      <p className="mt-4 flex items-center gap-2 text-[13px] text-ink-soft">
        <ArrowBendDownRightIcon size={15} /> Reassign in one click; the hand-off is recorded.
      </p>
    </Card>
  );
}

export function RelayStory() {
  const root = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(min-width: 1024px)", () => {
        const items = gsap.utils.toArray<HTMLElement>(".js-step");
        items.forEach((el, i) => {
          ScrollTrigger.create({
            trigger: el,
            start: "top 55%",
            end: "bottom 55%",
            onToggle: (self) => self.isActive && setStep(i),
          });
        });
        gsap.to(".js-progress", {
          scaleY: 1,
          ease: "none",
          scrollTrigger: { trigger: ".js-steps", start: "top 55%", end: "bottom 55%", scrub: true },
        });
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section id="how" ref={root} className="bg-surface px-5 py-28 sm:px-8 lg:px-12 lg:py-36">
      <div className="mx-auto max-w-7xl">
        <div data-reveal className="max-w-2xl">
          <p className="text-[15px] font-semibold text-teal">How it works</p>
          <h2 className="mt-3 text-[38px] leading-[1.05] font-semibold tracking-[-0.03em] text-ink sm:text-[52px]">A relay, not a free-for-all.</h2>
          <p className="mt-5 text-[18px] leading-relaxed text-ink-soft">
            In a relay exactly one runner holds the baton, and if they stumble it&apos;s passed on. That&apos;s how Baton treats every lead, from the second it arrives.
          </p>
        </div>

        <div className="mt-20 grid gap-16 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <ol className="js-steps relative flex flex-col gap-14 lg:gap-0">
            <span aria-hidden className="absolute top-2 bottom-2 left-[15px] hidden w-[2px] bg-surface-3 lg:block" />
            <span aria-hidden className="js-progress absolute top-2 bottom-2 left-[15px] hidden w-[2px] origin-top scale-y-0 bg-teal lg:block" />
            {STEPS.map((s, i) => (
              <li key={s.kicker} className="js-step relative lg:flex lg:min-h-[62vh] lg:items-center">
                <div className="relative lg:ml-14">
                  <span
                    aria-hidden
                    className={cn(
                      "absolute top-[-6px] -left-14 hidden h-8 w-8 items-center justify-center rounded-full text-[13px] font-semibold transition-colors duration-300 lg:flex",
                      step >= i ? "bg-teal text-on-teal" : "bg-paper text-ink-soft ring-1 ring-line",
                    )}
                  >
                    {i + 1}
                  </span>
                  <p className="text-[14px] font-semibold text-teal">{s.kicker}</p>
                  <h3 className={cn("mt-2 text-[28px] leading-tight font-semibold tracking-[-0.02em] transition-colors duration-300 sm:text-[34px]", step === i ? "text-ink" : "text-ink lg:text-ink-faint")}>
                    {s.title}
                  </h3>
                  <p className={cn("mt-3 max-w-md text-[17px] leading-relaxed transition-colors duration-300", step === i ? "text-ink-soft" : "text-ink-soft lg:text-ink-faint")}>{s.body}</p>
                  <div className="mt-8 lg:hidden">
                    <Visual step={i} />
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <div className="hidden lg:block">
            <div className="sticky top-[18vh] flex min-h-[64vh] items-center">
              <div className="w-full">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={step}
                    initial={{ opacity: 0, y: 24, filter: "blur(6px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, y: -16, filter: "blur(4px)" }}
                    transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <Visual step={step} />
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
