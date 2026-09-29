import type { ReactNode } from "react";

type Tone = "neutral" | "red" | "amber" | "green" | "blue";

const TONES: Record<Tone, string> = {
  neutral: "bg-black/5 text-black/70 dark:bg-white/10 dark:text-white/75",
  red: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200",
  amber: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
  blue: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Section({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-black/10 bg-white p-4 dark:border-white/15 dark:bg-white/[0.03] ${className}`}>
      {children}
    </div>
  );
}

export function Muted({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`text-black/55 dark:text-white/55 ${className}`}>{children}</span>;
}

export function Quote({ children }: { children: ReactNode }) {
  return (
    <blockquote className="border-l-2 border-black/20 pl-3 text-sm italic text-black/75 dark:border-white/25 dark:text-white/75">
      {children}
    </blockquote>
  );
}

export function MessageBubble({ children }: { children: ReactNode }) {
  return (
    <div className="whitespace-pre-wrap rounded-lg bg-emerald-50 p-3 text-sm leading-relaxed text-black/85 dark:bg-emerald-500/10 dark:text-white/85">
      {children}
    </div>
  );
}
