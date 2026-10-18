import Link from "next/link";
import { BatonMark } from "@/components/brand/logo";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-5">
      <BatonMark className="h-10 w-10 text-teal" />
      <h1 className="display mt-8 text-[56px] text-ink sm:text-[84px]">Dropped baton.</h1>
      <p className="mt-5 max-w-md text-lg text-ink-soft">This page doesn&apos;t exist, or it belongs to a workspace you can&apos;t see.</p>
      <Link href="/dashboard" className="mt-8 w-fit rounded-[3px] bg-teal px-5 py-3 font-medium text-on-teal hover:bg-teal-hover">
        Back to your dashboard
      </Link>
    </main>
  );
}
