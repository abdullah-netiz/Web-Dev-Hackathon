"use client";

import { useGSAP } from "@gsap/react";
import { ArrowRightIcon, CalendarBlankIcon, CreditCardIcon, PaperPlaneTiltIcon, WhatsappLogoIcon } from "@phosphor-icons/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { BatonMark } from "@/components/brand/logo";
import { HeroDemo } from "./hero-demo";
import { RelayStory } from "./relay-story";
import { Footer, FinalCta, Managers, RecordBento, Trust } from "./sections";
import { SmoothScroll } from "./smooth-scroll";
import { WaitCost } from "./wait-cost";

gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText);

const NAV = [
  { href: "#why", label: "Why" },
  { href: "#how", label: "How it works" },
  { href: "#record", label: "Integrations" },
  { href: "#managers", label: "For managers" },
];

function Header() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 transition-[background-color,box-shadow,backdrop-filter] duration-300",
        scrolled ? "bg-paper/85 shadow-[0_1px_0_0_var(--line)] backdrop-blur-md" : "bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8 lg:px-12">
        <Link href="/" className="flex items-center gap-2 text-ink" aria-label="Baton home">
          <BatonMark />
          <span className="font-display text-[24px] leading-none tracking-[-0.02em]">baton</span>
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-8 md:flex">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="text-[15px] text-ink-soft transition-colors hover:text-ink">
              {n.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2 sm:gap-3">
          <Link href="/login" className="px-2 text-[15px] font-medium text-ink hover:text-teal">
            Log in
          </Link>
          <Link href="/signup" className="inline-flex h-10 items-center rounded-full bg-teal px-5 text-[15px] font-semibold text-on-teal transition-colors hover:bg-teal-hover">
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden px-5 pt-32 pb-24 sm:px-8 lg:px-12 lg:pt-40 lg:pb-32">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(6,82,92,0.13)_1px,transparent_0)] bg-[length:24px_24px] [mask-image:radial-gradient(ellipse_70%_60%_at_70%_40%,black,transparent)]"
      />
      <div aria-hidden className="pointer-events-none absolute -top-40 right-[-10%] h-[520px] w-[520px] rounded-full bg-teal/[0.07] blur-3xl" />
      <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="min-w-0">
          <p className="js-hero-fade inline-flex items-center gap-2 rounded-full bg-teal-tint px-3 py-1 text-[13px] font-semibold text-teal">
            <span className="h-1.5 w-1.5 rounded-full bg-teal" /> The CRM that never drops a lead
          </p>
          <h1 className="js-hero-title mt-6 text-[46px] leading-[1.02] font-semibold tracking-[-0.035em] text-ink sm:text-[64px] xl:text-[72px]">
            Every lead gets an owner. Instantly.
          </h1>
          <p className="js-hero-fade mt-6 max-w-xl text-[19px] leading-relaxed text-ink-soft">
            Baton is the CRM for service teams that can&apos;t afford slow replies. New leads from your website, WhatsApp and phone are assigned in a second, timed in plain sight, and handed on
            automatically when nobody answers.
          </p>
          <div className="js-hero-fade mt-9 flex flex-wrap items-center gap-3">
            <Link href="/signup" className="group inline-flex h-12 items-center gap-2 rounded-full bg-teal px-7 text-[16px] font-semibold text-on-teal transition-[background-color,transform] hover:bg-teal-hover active:scale-[0.98]">
              Create your workspace <ArrowRightIcon size={18} className="transition-transform group-hover:translate-x-1" />
            </Link>
            <Link href="/login" className="inline-flex h-12 items-center rounded-full px-6 text-[16px] font-semibold text-ink ring-1 ring-line transition-colors hover:bg-surface">
              Try the live demo
            </Link>
          </div>
          <p className="js-hero-fade mt-5 text-[14px] text-ink-soft">Demo company included · Owner, manager and sales logins · Light and dark mode</p>
        </div>
        <div className="js-hero-demo relative min-w-0 lg:pl-4">
          <HeroDemo />
        </div>
      </div>

      <div className="js-hero-fade relative mx-auto mt-24 max-w-7xl">
        <p className="text-center text-[14px] text-ink-soft">Connected to the services your team already uses</p>
        <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-ink-soft">
          {[
            { i: WhatsappLogoIcon, n: "WhatsApp · Twilio" },
            { i: CreditCardIcon, n: "Lemon Squeezy" },
            { i: CalendarBlankIcon, n: "Google Calendar" },
            { i: PaperPlaneTiltIcon, n: "Slack" },
          ].map((x) => (
            <li key={x.n} className="flex items-center gap-2 text-[17px] font-semibold tracking-[-0.01em]">
              <x.i size={22} weight="duotone" className="text-teal" /> {x.n}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Landing() {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const split = SplitText.create(".js-hero-title", { type: "words" });
        const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
        tl.from(split.words, { yPercent: 40, autoAlpha: 0, duration: 1.1, stagger: 0.06 })
          .from(".js-hero-fade", { y: 18, autoAlpha: 0, duration: 0.9, stagger: 0.08 }, 0.25)
          .from(".js-hero-demo", { y: 40, autoAlpha: 0, scale: 0.97, duration: 1.2 }, 0.35);
        gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
          gsap.from(el, { y: 32, autoAlpha: 0, duration: 1, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 85%", once: true } });
        });
        gsap.utils.toArray<HTMLElement>("[data-bento]").forEach((grid) => {
          gsap.from(grid.querySelectorAll("[data-tile]"), {
            y: 40,
            autoAlpha: 0,
            duration: 0.9,
            stagger: 0.09,
            ease: "power3.out",
            scrollTrigger: { trigger: grid, start: "top 82%", once: true },
          });
        });
        return () => split.revert();
      });
    },
    { scope: root },
  );

  return (
    <div ref={root} data-theme="light" className="bg-paper text-ink">
      <SmoothScroll />
      <Header />
      <main>
        <Hero />
        <WaitCost />
        <RelayStory />
        <RecordBento />
        <Managers />
        <Trust />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
