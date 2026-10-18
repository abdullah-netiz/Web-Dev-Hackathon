"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { BatonMark } from "@/components/brand/logo";
import { InlineClock } from "./inline-clock";
import { SmoothScroll } from "./smooth-scroll";

gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText);

const TEAM = [
  { name: "Bilal Hussain", open: 3 },
  { name: "Priya Nair", open: 2 },
  { name: "Tomás Ferreira", open: 5 },
];
const EXAMPLES = ["Do you install on tile roofs?", "Quote for panels and a battery", "Can someone come Saturday?"];

const STAGES = [
  { sec: 1, color: "bg-[#9cc5c0]", ink: "text-ink", label: "Arrives", time: "Instant", clause: "From your web form, a WhatsApp message, or a call you log." },
  { sec: 1, color: "bg-[#2f737d]", ink: "text-paper", label: "Gets an owner", time: "1 second", clause: "Round-robin among people who are Available and not at their limit." },
  { sec: 90, color: "bg-teal", ink: "text-paper", label: "Response window", time: "90 seconds", clause: "The owner sees a running clock. Any reply, note or booking stops it." },
  { sec: 60, color: "bg-ink", ink: "text-paper", label: "Handed on", time: "60 seconds a level", clause: "Ignored? Next teammate, then their backup, then a manager, each alerted in Telegram." },
];

function useOwnerFor(text: string) {
  return useMemo(() => {
    let h = 0;
    for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return TEAM[h % TEAM.length]!;
  }, [text]);
}

function TryIt() {
  const [text, setText] = useState(EXAMPLES[0]!);
  const owner = useOwnerFor(text.trim() || "x");
  const [left, setLeft] = useState(90);
  useEffect(() => setLeft(90), [text]);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setLeft((l) => (l > 0 ? l - 1 : 90)), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <section id="try" data-chapter="paper" className="min-h-[88svh] bg-paper px-4 py-28 sm:px-8 lg:px-12">
      <p data-reveal className="max-w-xl text-[19px] text-ink-soft">
        Type what a customer might send. See who owns it, and how long they have.
      </p>
      <label htmlFor="try-input" className="sr-only">
        A customer message
      </label>
      <div data-ui className="mt-8 flex items-end">
        <input
          id="try-input"
          value={text}
          maxLength={60}
          onChange={(e) => setText(e.target.value)}
          className="w-full min-w-0 bg-transparent font-display text-[11vw] leading-[1.05] font-light tracking-[-0.03em] text-ink caret-teal outline-none placeholder:text-ink-faint focus-visible:outline-none sm:text-[clamp(48px,7vw,124px)]"
          placeholder="Type a message"
        />
      </div>
      <div data-ui className="mt-12 w-full max-w-[560px] bg-surface p-5" aria-live="polite">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[13px] text-ink-soft">Web form lead · just now</p>
            <p className="mt-1 text-[17px] font-semibold text-ink">Assigned to {owner.name}</p>
            <p className="text-[13px] text-ink-soft">Available · {owner.open} of 8 open leads</p>
          </div>
          <div className="text-right">
            <p className="tabular text-[34px] leading-none font-semibold tracking-[-0.03em] text-ink">
              {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
            </p>
            <p className="text-[12px] text-ink-soft">to acknowledge</p>
          </div>
        </div>
        <div className="mt-4 h-1.5 bg-surface-3">
          <div className="h-full origin-left bg-teal transition-transform duration-1000 ease-linear" style={{ transform: `scaleX(${left / 90})` }} />
        </div>
      </div>
      <div className="mt-10 flex flex-wrap gap-2 sm:gap-6">
        {EXAMPLES.map((e) => (
          <button key={e} onClick={() => setText(e)} className="h-11 bg-surface px-4 text-[17px] text-ink transition-colors hover:bg-surface-2 sm:h-auto sm:bg-transparent sm:px-0 sm:underline sm:underline-offset-4 sm:hover:bg-transparent sm:hover:text-teal">
            {e}
          </button>
        ))}
      </div>
    </section>
  );
}

function Fragment({ kind }: { kind: "whatsapp" | "stripe" | "calendar" | "telegram" | "audit" }) {
  const box = "w-full bg-paper p-4 text-ink";
  if (kind === "whatsapp")
    return (
      <div data-ui className={box}>
        <p className="w-fit max-w-[90%] bg-surface px-3 py-2 text-sm">Can someone come Saturday?</p>
        <p className="mt-2 ml-auto w-fit max-w-[90%] bg-teal px-3 py-2 text-sm text-paper">Saturday at 10:00 works. I&apos;ll send an invite.</p>
        <p className="mt-1 text-right text-[12px] text-ok">Delivered</p>
      </div>
    );
  if (kind === "stripe")
    return (
      <div data-ui className={cn(box, "flex items-center justify-between")}>
        <div>
          <p className="tabular text-2xl font-semibold">$4,800.00</p>
          <p className="text-[12px] text-ink-soft">Deposit · Lindgren residence</p>
        </div>
        <span className="bg-ok-tint px-2 py-1 text-[12.5px] font-semibold text-ok">Paid</span>
      </div>
    );
  if (kind === "calendar")
    return (
      <div data-ui className={box}>
        <p className="text-[12px] text-ink-soft">Thursday</p>
        <div className="mt-2 flex h-8 gap-[2px]">
          <span className="flex-[2] bg-[repeating-linear-gradient(135deg,var(--surface-3)_0_4px,transparent_4px_8px)]" />
          <span className="flex-[1.5] bg-teal px-2 text-[12px] leading-8 text-paper">Survey</span>
          <span className="flex-[3] bg-surface" />
        </div>
        <p className="mt-2 text-[12px] text-ink-soft">10:00 for you · 11:00 for Priya</p>
      </div>
    );
  if (kind === "telegram")
    return (
      <div data-ui className={cn(box, "text-sm")}>
        <p className="font-semibold">Escalated to you: Camila Ortiz</p>
        <p className="mt-1 text-ink-soft">Web form · Bilal didn&apos;t acknowledge in 90 s. You have 60 s.</p>
        <p className="mt-2 text-teal underline">Open the lead</p>
      </div>
    );
  return (
    <div data-ui className={cn(box, "text-[13px]")}>
      <p>
        <span className="font-semibold">Lead escalated</span> · System · 14:02
      </p>
      <p className="mt-1 text-ink-soft">owner: Bilal Hussain → Priya Nair</p>
      <p className="mt-2 text-ink-soft">Entries can be read, never edited.</p>
    </div>
  );
}

const ROWS: { title: string; body: string; kind: Parameters<typeof Fragment>[0]["kind"]; w: string }[] = [
  { title: "WhatsApp, in the record", body: "Messages arrive on the customer's page with sent, delivered and failed states. A failed reply says why and can be retried.", kind: "whatsapp", w: "md:w-[300px]" },
  { title: "Payments that confirm themselves", body: "Send a Stripe checkout link from the deal. It flips to Paid when Stripe confirms it, without anyone refreshing.", kind: "stripe", w: "md:w-[260px]" },
  { title: "Bookings on real calendars", body: "Each person connects their own Google Calendar. Busy times are checked before anything is booked.", kind: "calendar", w: "md:w-[320px]" },
  { title: "Alerts that leave the app", body: "When a lead is handed to someone, they hear about it in Telegram within seconds, with a link straight to it.", kind: "telegram", w: "md:w-[280px]" },
  { title: "A history nobody can edit", body: "Every assignment, escalation, permission change and deletion is written down with who, when, before and after.", kind: "audit", w: "md:w-[240px]" },
];

export function Landing() {
  const root = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [company, setCompany] = useState("");
  const [onDark, setOnDark] = useState(false);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const split = SplitText.create(".js-hero-line", { type: "words" });
        gsap.from(split.words, { yPercent: 35, autoAlpha: 0, duration: 1.1, ease: "expo.out", stagger: 0.07, delay: 0.1 });
        gsap.from(".js-hero-sub", { y: 24, autoAlpha: 0, duration: 0.9, ease: "power3.out", delay: 0.5 });
        gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
          gsap.from(el, { y: 28, autoAlpha: 0, duration: 0.9, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 88%", once: true } });
        });
        gsap.utils.toArray<HTMLElement>("[data-row]").forEach((row) => {
          gsap.from(row.children, { y: 32, autoAlpha: 0, duration: 0.9, ease: "power3.out", stagger: 0.08, scrollTrigger: { trigger: row, start: "top 85%", once: true } });
        });
        gsap.from(".js-seg", { scaleX: 0, transformOrigin: "left center", duration: 1.1, ease: "expo.out", stagger: 0.12, scrollTrigger: { trigger: ".js-bar", start: "top 80%", once: true } });
        gsap.to(".js-hero-media", { yPercent: -18, ease: "none", scrollTrigger: { trigger: ".js-hero", start: "top top", end: "bottom top", scrub: true } });
        return () => split.revert();
      });
      gsap.utils.toArray<HTMLElement>("[data-chapter]").forEach((sec) => {
        ScrollTrigger.create({
          trigger: sec,
          start: "top 40px",
          end: "bottom 40px",
          onToggle: (self) => self.isActive && setOnDark(sec.dataset.chapter === "dark"),
        });
      });
    },
    { scope: root },
  );

  return (
    <div ref={root} className="bg-paper text-ink">
      <SmoothScroll />
      <header className={cn("fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between px-4 transition-colors duration-300 sm:px-8 lg:px-12", onDark ? "text-paper" : "text-ink")}>
        <Link href="/" className="flex items-center gap-2" aria-label="Baton home">
          <BatonMark />
          <span className="font-display text-[24px] leading-none tracking-[-0.02em]">baton</span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-6">
          <a href="#how" className="hidden text-[15px] hover:underline sm:inline">
            How it works
          </a>
          <a href="#connected" className="hidden text-[15px] hover:underline md:inline">
            What&apos;s connected
          </a>
          <Link href="/login" className="px-2 text-[15px] hover:underline">
            Log in
          </Link>
          <Link href="/signup" className={cn("h-10 px-4 text-[15px] leading-10 font-medium transition-colors", onDark ? "bg-paper text-ink hover:bg-surface" : "bg-teal text-on-teal hover:bg-teal-hover")}>
            Create workspace
          </Link>
        </nav>
      </header>

      <main>
        <section data-chapter="paper" className="js-hero relative flex min-h-[100svh] flex-col">
          <div className="flex flex-1 items-end px-4 pt-28 pb-10 sm:px-8 lg:px-12 lg:pb-14">
            <h1 className="display text-[12.4vw] leading-[0.95] font-light tracking-[-0.035em] sm:text-[clamp(72px,10.5vw,176px)]">
              <span className="js-hero-line block">Every lead has</span>
              <span className="block whitespace-nowrap">
                <InlineClock />
                <span className="js-hero-line"> one owner.</span>
              </span>
            </h1>
          </div>
          <div data-chapter="dark" className="js-hero-media bg-teal px-4 pt-10 pb-16 text-paper sm:px-8 lg:px-12 lg:pt-14">
            <div className="js-hero-sub flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
              <p className="max-w-xl text-[19px] leading-relaxed text-paper/90 sm:text-[21px]">
                Baton is the CRM for service teams of 5 to 30. Every inbound lead gets one accountable person, a visible clock, and an automatic hand-off when it&apos;s ignored.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href="/signup" className="h-12 bg-paper px-6 text-[16px] leading-[48px] font-semibold text-ink transition-transform hover:bg-surface active:scale-[0.98]">
                  Create your workspace
                </Link>
                <Link href="/login" className="h-12 px-2 text-[16px] leading-[48px] text-paper underline underline-offset-4">
                  Try the demo
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section id="how" data-chapter="paper" className="bg-paper px-4 py-32 sm:px-8 lg:px-12 lg:py-44">
          <h2 data-reveal className="display max-w-[16ch] text-[11vw] leading-[0.95] sm:text-[clamp(48px,6.4vw,104px)]">
            Nobody drops it.
          </h2>
          <div data-ui className="js-bar mt-16 flex flex-col gap-[6px] md:h-[22vh] md:min-h-44 md:flex-row" aria-label="What happens to a lead, with how long each step takes">
            {STAGES.map((s) => (
              <div key={s.label} className="flex min-w-0 flex-col md:basis-0" style={{ flexGrow: Math.max(s.sec, 152 * 0.18) }}>
                <div className={cn("js-seg flex min-h-[88px] flex-1 flex-col justify-between p-5", s.color, s.ink)}>
                  <span className="text-[clamp(20px,2vw,28px)] leading-tight font-medium">{s.time}</span>
                  <span className="text-[15px] opacity-85">{s.label}</span>
                </div>
                <p className="mt-3 max-w-[30ch] text-[16px] leading-snug text-ink-soft md:text-[15px]">{s.clause}</p>
              </div>
            ))}
          </div>
        </section>

        <TryIt />

        <section id="connected" data-chapter="dark" className="bg-teal px-4 py-32 text-paper sm:px-8 lg:px-12 lg:py-44">
          <div className="grid md:grid-cols-12">
            <h2 data-reveal className="display flex min-h-[40svh] items-center text-[9vw] leading-[0.95] sm:text-[clamp(40px,5vw,80px)] md:col-span-8 md:col-start-5">
              The whole customer, one page.
            </h2>
          </div>
          <div className="mt-10 flex flex-col gap-24 md:gap-28">
            {ROWS.map((r) => (
              <div key={r.title} data-row className="grid gap-6 md:grid-cols-12 md:items-start">
                <div className="md:col-span-5 md:col-start-5">
                  <h3 className="text-[clamp(26px,3vw,44px)] leading-tight font-medium tracking-[-0.02em]">{r.title}</h3>
                  <p className="mt-3 max-w-[38ch] text-[17px] leading-relaxed text-paper/85">{r.body}</p>
                </div>
                <div className={cn("w-full md:col-span-3 md:col-start-10 md:justify-self-end", r.w)}>
                  <Fragment kind={r.kind} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section data-chapter="paper" className="bg-surface px-4 py-32 sm:px-8 lg:px-12 lg:py-44">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              router.push(`/signup${company.trim() ? `?company=${encodeURIComponent(company.trim())}` : ""}`);
            }}
            className="display text-[10vw] leading-[1.08] tracking-[-0.03em] sm:text-[clamp(40px,6vw,96px)]"
          >
            <span>Put </span>
            <label htmlFor="cta-company" className="sr-only">
              Your company name
            </label>
            <input
              id="cta-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="your team"
              className="my-1 inline-block h-[1.05em] w-full bg-paper px-[0.2em] align-baseline font-display text-[1em] font-light text-ink placeholder:text-ink-faint focus:outline-2 focus:outline-teal sm:w-[6.5em]"
            />
            <span> on Baton </span>
            <button type="submit" className="inline-block h-[1.05em] bg-teal px-[0.25em] align-baseline font-display text-[1em] font-light text-on-teal transition-colors hover:bg-teal-hover">
              today.
            </button>
          </form>
          <p className="mt-6 max-w-lg text-[16px] text-ink-soft">You&apos;ll be the Owner of a new workspace. Invite your team, set the response window, and share your lead form.</p>
        </section>
      </main>

      <footer data-chapter="dark" className="flex min-h-[90svh] flex-col bg-ink px-4 py-10 text-paper sm:px-8 lg:px-12">
        <div className="flex flex-wrap items-start justify-between gap-6 text-[15px] text-paper/75">
          <div className="flex flex-col gap-1 sm:flex-row sm:gap-10">
            <span className="flex items-center gap-2 text-paper">
              <BatonMark className="h-5 w-5" /> baton
            </span>
            <span>Lead accountability for service teams.</span>
            <span>WhatsApp · Stripe · Google Calendar · Telegram</span>
          </div>
          <a href="#top" onClick={(e) => (e.preventDefault(), window.scrollTo({ top: 0, behavior: "smooth" }))} className="underline underline-offset-4">
            Back to top
          </a>
        </div>
        <div className="flex flex-1 items-end py-16">
          <Link href="/signup" className="display block text-[16vw] leading-[0.9] tracking-[-0.04em] text-paper transition-colors hover:text-[#9cc5c0] sm:text-[clamp(64px,9vw,168px)]">
            One lead.
            <br />
            One owner.
          </Link>
        </div>
        <div className="flex flex-col gap-1 text-[14px] text-paper/60 sm:flex-row sm:justify-between">
          <span>
            <Link href="/login" className="underline">
              Log in
            </Link>{" "}
            ·{" "}
            <Link href="/signup" className="underline">
              Create workspace
            </Link>
          </span>
          <span>Built for the Web Dev Hackathon</span>
          <span>2026</span>
        </div>
      </footer>
    </div>
  );
}
