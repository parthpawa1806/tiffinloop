import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { NOW, TIMEZONE } from "@/lib/config";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TiffinLoop Ops",
  description: "Handle cook dropouts before meal time, and spot dropout patterns.",
};

const nowLabel = NOW.toLocaleString("en-IN", {
  timeZone: TIMEZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-black/10 dark:border-white/15">
          <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
            <span className="font-semibold">TiffinLoop</span>
            <Link href="/" className="hover:underline">Ops: dropouts</Link>
            <Link href="/leadership" className="hover:underline">Leadership</Link>
            <span className="ml-auto text-black/60 dark:text-white/60" title="The clock starts when the first dropout is logged, then runs in real time">
              Scenario starts {nowLabel} IST
            </span>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
