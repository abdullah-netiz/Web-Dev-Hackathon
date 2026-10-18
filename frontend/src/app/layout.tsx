import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk } from "next/font/google";
import localFont from "next/font/local";
import { Providers } from "@/components/providers";
import { themeBootScript } from "@/lib/theme";
import "./globals.css";

const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const zodiak = localFont({
  variable: "--font-zodiak",
  src: [
    { path: "./fonts/Zodiak-Light.woff2", weight: "300", style: "normal" },
    { path: "./fonts/Zodiak-Regular.woff2", weight: "400", style: "normal" },
  ],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  openGraph: { siteName: "Baton", type: "website" },
  twitter: { card: "summary_large_image" },
  title: {
    default: "Baton — every lead has one owner",
    template: "%s · Baton",
  },
  description:
    "Baton is the CRM for service teams where every inbound lead has exactly one accountable owner, a visible response clock, and an automatic hand-off when it is ignored.",
  applicationName: "Baton",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f9f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1719" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${hanken.variable} ${zodiak.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
