import type { Metadata } from "next";
import { LeadForm } from "./lead-form";

export const metadata: Metadata = { title: "Get in touch", robots: { index: false } };

export default async function PublicFormPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <LeadForm slug={slug} />;
}
