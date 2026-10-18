"use client";

import {
  ArrowRightIcon,
  CalendarCheckIcon,
  CheckIcon,
  CreditCardIcon,
  EyeSlashIcon,
  FlowArrowIcon,
  LockKeyIcon,
  PaperPlaneTiltIcon,
  ScrollIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  WhatsappLogoIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Link from "next/link";
import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { BatonMark } from "@/components/brand/logo";

gsap.registerPlugin(useGSAP, ScrollTrigger);

function Tile({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div data-tile className={cn("group relative flex flex-col overflow-hidden rounded-[16px] bg-paper p-6 ring-1 ring-line transition-shadow duration-300 hover:shadow-[0_30px_60px_-30px_rgba(11,43,48,0.35)] sm:p-7", className)}>
      {children}
    </div>
  );
}

function TileHead({ icon: I, label, title, body }: { icon: Icon; label: string; title: string; body: string }) {
  return (
    <div className="mb-6">
      <p className="flex items-center gap-2 text-[13px] font-semibold text-teal">
        <I size={16} weight="duotone" /> {label}
      </p>
      <h3 className="mt-2 text-[22px] leading-tight font-semibold tracking-[-0.02em] text-ink">{title}</h3>
      <p className="mt-2 max-w-md text-[15px] leading-relaxed text-ink-soft">{body}</p>
    </div>
  );
}

export function RecordBento() {
  return (
    <section id="record" className="bg-paper px-5 py-28 sm:px-8 lg:px-12 lg:py-36">
      <div className="mx-auto max-w-7xl">
        <div data-reveal className="max-w-2xl">
          <p className="text-[15px] font-semibold text-teal">One customer, one page</p>
          <h2 className="mt-3 text-[38px] leading-[1.05] font-semibold tracking-[-0.03em] text-ink sm:text-[52px]">Stop switching between five apps.</h2>
          <p className="mt-5 text-[18px] leading-relaxed text-ink-soft">
            Messages, payments and appointments come from real services and land on the right customer, next to the lead, the deal and everything that happened.
          </p>
        </div>

        <div data-bento className="mt-16 grid gap-4 lg:grid-cols-6">
          <Tile className="lg:col-span-4">
            <TileHead icon={WhatsappLogoIcon} label="WhatsApp via Twilio" title="Reply where your customer wrote." body="Every message shows sent, delivered or read. If one fails, it says why and lets you retry; nothing disappears." />
            <div data-ui className="mt-auto rounded-[12px] bg-surface p-4">
              <p className="w-fit max-w-[80%] rounded-[10px] rounded-tl-[2px] bg-paper px-3.5 py-2 text-[14px] text-ink ring-1 ring-line">Hi! Can someone come Saturday to look at the roof?</p>
              <div className="mt-2 ml-auto w-fit max-w-[80%]">
                <p className="rounded-[10px] rounded-tr-[2px] bg-teal px-3.5 py-2 text-[14px] text-on-teal">Saturday at 10:00 works. I&apos;ll send a calendar invite now.</p>
                <p className="mt-1 flex items-center justify-end gap-1 text-[11.5px] font-medium text-ok">
                  <CheckIcon size={11} weight="bold" />
                  <CheckIcon size={11} weight="bold" className="-ml-1.5" /> Read · Priya Nair
                </p>
              </div>
              <div className="mt-3 rounded-[8px] bg-signal-tint px-3 py-2 text-[12.5px] text-ink">
                <span className="font-semibold text-signal">Not delivered (63016).</span> WhatsApp only allows free replies within 24 h of their last message.{" "}
                <span className="font-semibold text-teal underline">Retry</span>
              </div>
            </div>
          </Tile>
          <Tile className="lg:col-span-2">
            <TileHead icon={CreditCardIcon} label="Lemon Squeezy" title="Paid shows up on its own." body="Send a checkout link from the deal. The signed payment webhook marks it paid; no refresh, no card data in Baton." />
            <div data-ui className="mt-auto rounded-[12px] bg-surface p-4">
              <div className="flex items-center justify-between">
                <span>
                  <span className="tabular block text-[26px] font-semibold tracking-[-0.02em] text-ink">$4,800</span>
                  <span className="block text-[12.5px] text-ink-soft">Deposit · Lindgren residence</span>
                </span>
                <span className="rounded-[4px] bg-ok-tint px-2 py-1 text-[12px] font-semibold text-ok">Paid</span>
              </div>
              <div className="mt-3 flex justify-between border-t border-line pt-3 text-[12px] text-ink-soft">
                <span>cs_test_a1b2…f9</span>
                <span>by Bilal H.</span>
              </div>
            </div>
          </Tile>
          <Tile className="lg:col-span-3">
            <TileHead icon={CalendarCheckIcon} label="Google Calendar" title="Book on real calendars." body="Each person connects their own Google Calendar. Baton reads their busy times first and warns before a double booking." />
            <div data-ui className="mt-auto rounded-[12px] bg-surface p-4">
              <p className="text-[12px] font-medium text-ink-soft">Thursday · Priya Nair</p>
              <div className="mt-2 flex h-10 gap-[3px]">
                <span className="flex-[2] rounded-[4px] bg-[repeating-linear-gradient(135deg,var(--surface-3)_0_4px,transparent_4px_8px)]" />
                <span className="flex flex-[1.4] items-center rounded-[4px] bg-teal px-2 text-[12px] font-semibold text-on-teal">Site survey</span>
                <span className="flex-[1] rounded-[4px] bg-[repeating-linear-gradient(135deg,var(--surface-3)_0_4px,transparent_4px_8px)]" />
                <span className="flex-[2.6] rounded-[4px] bg-paper ring-1 ring-line" />
              </div>
              <p className="mt-2 text-[12px] text-ink-soft">10:00 for you · 11:00 for Priya (Denver)</p>
            </div>
          </Tile>
          <Tile className="lg:col-span-3">
            <TileHead icon={PaperPlaneTiltIcon} label="Slack" title="Alerts that leave the app." body="When a lead is handed to someone, they hear about it within seconds, with who, why and a link. Failed alerts are retried and listed for admins." />
            <div data-ui className="mt-auto rounded-[12px] bg-ink p-4 text-paper">
              <p className="text-[11.5px] font-semibold text-[#9cc5c0]">Baton bot · now</p>
              <p className="mt-1 text-[14px] font-semibold">Escalated to you: Camila Ortiz</p>
              <p className="mt-0.5 text-[12.5px] text-paper/70">Source: web form · Reason: Bilal didn&apos;t acknowledge in 90 s</p>
              <span className="mt-3 inline-block rounded-[6px] bg-paper/10 px-3 py-1.5 text-[12.5px] font-semibold">Open the lead</span>
            </div>
          </Tile>
        </div>
      </div>
    </section>
  );
}

const FIGURES = [
  { label: "New leads today", value: 23, suffix: "" },
  { label: "Average first response", value: 47, suffix: "s" },
  { label: "Escalations, 24 h", value: 4, suffix: "" },
  { label: "Collected this month", value: 18.4, suffix: "k", prefix: "$" },
];

export function Managers() {
  const root = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      gsap.utils.toArray<HTMLElement>(".js-count").forEach((el) => {
        const target = Number(el.dataset.value);
        const decimals = target % 1 ? 1 : 0;
        const obj = { v: 0 };
        gsap.to(obj, {
          v: target,
          duration: 1.6,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 85%", once: true },
          onUpdate: () => {
            el.textContent = obj.v.toFixed(decimals);
          },
        });
      });
      gsap.from(".js-bar", { scaleY: 0, stagger: 0.07, duration: 0.8, ease: "power3.out", scrollTrigger: { trigger: ".js-bars", start: "top 88%", once: true } });
      gsap.from(".js-audit li", { y: 14, autoAlpha: 0, stagger: 0.12, duration: 0.6, ease: "power3.out", scrollTrigger: { trigger: ".js-audit", start: "top 80%", once: true } });
    },
    { scope: root },
  );
  return (
    <section ref={root} id="managers" className="bg-ink px-5 py-28 text-paper sm:px-8 lg:px-12 lg:py-36">
      <div className="mx-auto max-w-7xl">
        <div data-reveal className="max-w-2xl">
          <p className="text-[15px] font-semibold text-[#9cc5c0]">For owners and managers</p>
          <h2 className="mt-3 text-[38px] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-[52px]">See what really happened.</h2>
          <p className="mt-5 text-[18px] leading-relaxed text-paper/75">
            A live dashboard of response times, pipeline and payments, and a history of every hand-off that nobody can edit. When a customer says they never heard back, you can see exactly
            who held the lead and for how long.
          </p>
        </div>
        <div className="mt-16 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="rounded-[16px] bg-paper/[0.06] p-6 ring-1 ring-paper/10 sm:p-7">
            <p className="text-[14px] font-medium text-paper/70">Dashboard · company-wide</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {FIGURES.map((f) => (
                <div key={f.label} className="rounded-[12px] bg-paper/[0.06] p-4">
                  <p className="text-[13px] text-paper/65">{f.label}</p>
                  <p className="tabular mt-2 text-[34px] leading-none font-semibold tracking-[-0.03em]">
                    {f.prefix}
                    <span className="js-count" data-value={f.value}>
                      0
                    </span>
                    {f.suffix}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-[12px] bg-paper/[0.06] p-4">
              <div className="flex justify-between text-[13px] text-paper/65">
                <span>Team right now</span>
                <span>5 of 8 can take leads</span>
              </div>
              <div className="mt-3 flex h-2.5 gap-[2px] overflow-hidden rounded-full">
                <span className="flex-[5] bg-[#6ccf98]" />
                <span className="flex-[1] bg-[#e6b85c]" />
                <span className="flex-[1] bg-[#9aa7ae]" />
                <span className="flex-[1] bg-paper/20" />
              </div>
            </div>
            <div className="mt-3 rounded-[12px] bg-paper/[0.06] p-4">
              <div className="flex justify-between text-[13px] text-paper/65">
                <span>First response, last 7 days</span>
                <span>down from 6m to 47s</span>
              </div>
              <div className="js-bars mt-4 flex h-24 items-end gap-2">
                {[92, 78, 70, 52, 40, 26, 14].map((h, k) => (
                  <div key={k} className="flex flex-1 flex-col items-center gap-1.5">
                    <span className="js-bar w-full origin-bottom rounded-t-[4px] bg-[#9cc5c0]" style={{ height: `${h}%`, opacity: 0.45 + k * 0.08 }} />
                    <span className="text-[11px] text-paper/45">{["M", "T", "W", "T", "F", "S", "S"][k]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="rounded-[16px] bg-paper/[0.06] p-6 ring-1 ring-paper/10 sm:p-7">
            <p className="flex items-center gap-2 text-[14px] font-medium text-paper/70">
              <ScrollIcon size={16} /> Audit history · read-only
            </p>
            <ul className="js-audit mt-5 flex flex-col gap-2.5">
              {[
                { t: "14:02:11", a: "Lead escalated", d: "Camila Ortiz · Bilal Hussain → Priya Nair", who: "System" },
                { t: "14:02:12", a: "Alert sent", d: "Slack to Priya Nair · delivered", who: "System" },
                { t: "14:02:51", a: "Lead acknowledged", d: "Camila Ortiz · first response 2m 40s", who: "Priya Nair" },
                { t: "14:10:03", a: "Permissions changed", d: "Sales: see opportunity values → off", who: "Amina Rahman" },
                { t: "14:12:40", a: "Integration changed", d: "Lemon Squeezy: connected", who: "Daniel Okafor" },
              ].map((x) => (
                <li key={x.t} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 rounded-[10px] bg-paper/[0.05] px-3.5 py-3 text-[13px]">
                  <span className="tabular text-paper/50">{x.t}</span>
                  <span className="min-w-0">
                    <span className="block font-semibold">{x.a}</span>
                    <span className="block truncate text-paper/65">{x.d}</span>
                    <span className="block text-[12px] text-paper/45">by {x.who}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

const TRUST: { icon: Icon; title: string; body: string }[] = [
  { icon: ShieldCheckIcon, title: "Roles you design", body: "Owner, Admin and User levels, plus roles built from switches: who can view, edit, delete, export, reassign, configure." },
  { icon: EyeSlashIcon, title: "Values only for the right people", body: "Deal amounts are hidden in lists, records and exports for anyone without permission, and the server enforces it." },
  { icon: LockKeyIcon, title: "Every company sealed off", body: "Each workspace has its own people, data, settings and integrations. A guessed link to someone else's record leads nowhere." },
  { icon: FlowArrowIcon, title: "Your pipeline, your stages", body: "Add, rename and reorder stages. Require fields before a deal enters a stage. Run more than one pipeline." },
  { icon: SlidersHorizontalIcon, title: "Fields without a developer", body: "Add text, number, date, dropdown and checkbox fields from settings. They appear on forms immediately." },
  { icon: ScrollIcon, title: "History that can't be rewritten", body: "Assignments, escalations, permission and pipeline changes, deletions: recorded with who, when, before and after." },
];

export function Trust() {
  return (
    <section id="control" className="bg-surface px-5 py-28 sm:px-8 lg:px-12 lg:py-36">
      <div className="mx-auto max-w-7xl">
        <div data-reveal className="max-w-2xl">
          <p className="text-[15px] font-semibold text-teal">Built for real teams</p>
          <h2 className="mt-3 text-[38px] leading-[1.05] font-semibold tracking-[-0.03em] text-ink sm:text-[52px]">Shaped to your company, not the other way round.</h2>
        </div>
        <ul data-bento className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TRUST.map((t) => (
            <li data-tile key={t.title} className="rounded-[16px] bg-paper p-6 ring-1 ring-line transition-transform duration-300 hover:-translate-y-1">
              <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-teal-tint text-teal">
                <t.icon size={20} weight="duotone" />
              </span>
              <h3 className="mt-5 text-[19px] font-semibold tracking-[-0.01em] text-ink">{t.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{t.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="bg-paper px-5 py-24 sm:px-8 lg:px-12 lg:py-32">
      <div data-reveal className="relative mx-auto max-w-7xl overflow-hidden rounded-[24px] bg-teal px-6 py-16 text-on-teal sm:px-12 lg:px-16 lg:py-24">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(247,249,248,0.14)_1px,transparent_0)] bg-[length:22px_22px] [mask-image:radial-gradient(ellipse_at_right,black,transparent_70%)]" />
        <div className="relative grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_auto] lg:items-end">
          <div>
            <h2 className="display text-[44px] leading-[0.98] text-paper sm:text-[68px]">Never lose another lead to silence.</h2>
            <p className="mt-6 max-w-xl text-[18px] leading-relaxed text-paper/85">
              Create a workspace in a minute, invite your team, and share your lead form. Or try the demo company with real data and three different roles.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
            <Link href="/signup" className="group inline-flex h-13 items-center justify-center gap-2 rounded-full bg-paper px-7 text-[16px] font-semibold text-ink transition-transform hover:scale-[1.02] active:scale-[0.98]">
              Create your workspace <ArrowRightIcon size={18} className="transition-transform group-hover:translate-x-1" />
            </Link>
            <Link href="/login" className="inline-flex h-13 items-center justify-center rounded-full px-7 text-[16px] font-semibold text-paper ring-1 ring-paper/40 transition-colors hover:bg-paper/10">
              Try the live demo
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="bg-paper px-5 pt-6 pb-10 sm:px-8 lg:px-12">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 border-t border-line pt-10 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-sm">
          <span className="flex items-center gap-2 text-ink">
            <BatonMark />
            <span className="font-display text-[22px] leading-none">baton</span>
          </span>
          <p className="mt-3 text-[14px] text-ink-soft">Lead accountability for service teams of 5 to 30. Every lead has one owner, a visible clock, and an automatic hand-off.</p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-2 text-[14px]">
          <a href="#how" className="text-ink-soft hover:text-ink">How it works</a>
          <Link href="/login" className="text-ink-soft hover:text-ink">Log in</Link>
          <a href="#record" className="text-ink-soft hover:text-ink">Integrations</a>
          <Link href="/signup" className="text-ink-soft hover:text-ink">Create workspace</Link>
          <a href="#managers" className="text-ink-soft hover:text-ink">For managers</a>
          <Link href="/f/northwind" className="text-ink-soft hover:text-ink">Sample lead form</Link>
        </nav>
      </div>
      <p className="mx-auto mt-10 max-w-7xl text-[13px] text-ink-faint">© 2026 Baton · Built for the Web Dev Hackathon</p>
    </footer>
  );
}
