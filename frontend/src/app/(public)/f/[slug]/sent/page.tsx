"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";

const STEPS = [
  { title: "Received", body: "Your message is in." },
  { title: "One person is responsible", body: "A named teammate now owns your request and has a short window to pick it up." },
  { title: "If they can't, someone else will", body: "When the window passes, it moves to the next person automatically. You don't have to chase anyone." },
];

function Sent() {
  const { slug } = useParams<{ slug: string }>();
  const params = useSearchParams();
  const name = params.get("name");
  const ref = params.get("ref");
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-5 py-16 sm:px-10">
      <motion.h1 initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} className="display text-[52px] text-ink sm:text-[80px]">
        Thanks{name ? `, ${name}` : ""}.
      </motion.h1>
      <p className="mt-5 max-w-xl text-lg text-ink-soft">We&apos;ll reply on the phone number or email you left. {ref && <>Your reference is <span className="tabular font-semibold text-ink">{ref}</span>.</>}</p>
      <ol className="mt-12 flex flex-col">
        {STEPS.map((s, i) => (
          <motion.li
            key={s.title}
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 + i * 0.35, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="grid grid-cols-[10px_minmax(0,1fr)] gap-5 pb-8"
          >
            <motion.span
              aria-hidden
              className="w-[10px] origin-top bg-teal"
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ delay: 0.5 + i * 0.35, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            />
            <div>
              <p className="text-xl font-semibold text-ink">{s.title}</p>
              <p className="mt-1 max-w-lg text-[17px] text-ink-soft">{s.body}</p>
            </div>
          </motion.li>
        ))}
      </ol>
      <Link href={`/f/${slug}`} className="mt-4 w-fit text-sm font-medium text-teal underline underline-offset-4">
        Send another message
      </Link>
    </main>
  );
}

export default function SentPage() {
  return (
    <Suspense>
      <Sent />
    </Suspense>
  );
}
