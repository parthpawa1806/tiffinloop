import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { resetDemo } from "@/app/actions";
import { Sidebar } from "@/components/sidebar";
import { SubmitButton } from "@/components/submit-button";
import { TODAY, mealDeadline } from "@/lib/config";
import { fmtDuration, fmtTime } from "@/lib/format";
import { loadDay, scenarioTime } from "@/lib/ops-model";
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

// Every page reads live ops state.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const model = await loadDay(TODAY);
  const now = scenarioTime(model, new Date());
  const toLunch = mealDeadline(TODAY, "lunch").getTime() - now.getTime();
  const toDinner = mealDeadline(TODAY, "dinner").getTime() - now.getTime();

  const footer = (
    <div className="space-y-3 text-xs">
      <div className="text-black/55 dark:text-white/55">
        <div className="font-medium text-black/80 dark:text-white/80">Wed 23 Sep · {fmtTime(now)}</div>
        <div>Lunch {toLunch > 0 ? `in ${fmtDuration(toLunch)}` : "out"} · Dinner {toDinner > 0 ? `in ${fmtDuration(toDinner)}` : "out"}</div>
      </div>
      <form action={resetDemo}>
        <SubmitButton variant="secondary" pendingLabel="Resetting…" className="w-full !text-xs">Reset demo</SubmitButton>
      </form>
    </div>
  );

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full md:flex">
        <Sidebar needsAction={model.suspected.length} footer={footer} />
        <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </body>
    </html>
  );
}
