import Link from "next/link";
import type { ReactNode } from "react";

type Tone = "neutral" | "red" | "amber" | "green" | "blue";

const TONES: Record<Tone, string> = {
  neutral: "bg-black/5 text-black/70 dark:bg-white/10 dark:text-white/75",
  red: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-500/30",
  amber: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/30",
  green: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-500/30",
  blue: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200 dark:bg-sky-500/15 dark:text-sky-200 dark:ring-sky-500/30",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6">
      {back && (
        <Link href={back.href} className="mb-3 inline-block text-sm text-black/55 hover:text-black dark:text-white/55 dark:hover:text-white">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-black/55 dark:text-white/55">{subtitle}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export interface TabItem {
  key: string;
  label: string;
  href: string;
  count?: number;
}

export function Tabs({ tabs, active }: { tabs: TabItem[]; active: string }) {
  return (
    <div className="mb-5 flex gap-6 overflow-x-auto overflow-y-hidden border-b border-black/10 [scrollbar-width:none] dark:border-white/10">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            scroll={false}
            className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 pb-2.5 text-sm transition ${
              on
                ? "border-black font-medium text-black dark:border-white dark:text-white"
                : "border-transparent text-black/55 hover:text-black dark:text-white/55 dark:hover:text-white"
            }`}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={`rounded-full px-1.5 text-xs ${on ? "bg-black text-white dark:bg-white dark:text-black" : "bg-black/5 dark:bg-white/10"}`}>
                {t.count}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03] ${className}`}>
      {children}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "good" | "bad" }) {
  const color = tone === "good" ? "text-emerald-700 dark:text-emerald-300" : tone === "bad" ? "text-red-700 dark:text-red-300" : "";
  return (
    <div className="rounded-xl border border-black/10 px-4 py-3 dark:border-white/10">
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
      <div className="text-xs text-black/55 dark:text-white/55">{label}</div>
    </div>
  );
}

// Stat tile: label · value · optional context line.
export function Kpi({ label, value, sub, hero }: { label: string; value: ReactNode; sub?: ReactNode; hero?: boolean }) {
  return (
    <div className="rounded-xl border border-black/10 px-4 py-3 dark:border-white/10">
      <div className="text-xs text-black/55 dark:text-white/55">{label}</div>
      <div className={`mt-1 font-semibold tracking-tight ${hero ? "text-3xl" : "text-xl"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-black/50 dark:text-white/50">{sub}</div>}
    </div>
  );
}

export function Panel({ title, aside, children, className = "" }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-black/10 p-4 dark:border-white/10 ${className}`}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">{title}</h2>
        {aside && <div className="text-xs text-black/50 dark:text-white/50">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-black/15 px-4 py-10 text-center text-sm text-black/55 dark:border-white/15 dark:text-white/55">
      {children}
    </div>
  );
}

export function Muted({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`text-black/55 dark:text-white/55 ${className}`}>{children}</span>;
}

export function Quote({ children }: { children: ReactNode }) {
  return (
    <blockquote className="border-l-2 border-black/15 pl-3 text-sm text-black/70 dark:border-white/20 dark:text-white/70">
      {children}
    </blockquote>
  );
}

export function MessageBubble({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <div
      className={`whitespace-pre-wrap rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed ${
        muted ? "bg-black/[0.04] text-black/80 dark:bg-white/[0.06] dark:text-white/80" : "bg-emerald-50 text-black/85 dark:bg-emerald-500/10 dark:text-white/85"
      }`}
    >
      {children}
    </div>
  );
}

// Key/value list for detail pages.
export function Fields({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label}>
          <dt className="text-xs text-black/50 dark:text-white/50">{i.label}</dt>
          <dd className="mt-0.5 text-sm">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="mb-6 flex flex-wrap items-center gap-3 text-sm">
      {steps.map((s, i) => {
        const done = i < current;
        const on = i === current;
        return (
          <li key={s} className="flex items-center gap-3">
            <span className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                  done
                    ? "bg-emerald-600 text-white"
                    : on
                      ? "bg-black text-white dark:bg-white dark:text-black"
                      : "bg-black/5 text-black/50 dark:bg-white/10 dark:text-white/50"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              <span className={on ? "font-medium" : "text-black/55 dark:text-white/55"}>{s}</span>
            </span>
            {i < steps.length - 1 && <span className="h-px w-8 bg-black/15 dark:bg-white/15" />}
          </li>
        );
      })}
    </ol>
  );
}

export const tableClasses = {
  wrap: "overflow-x-auto rounded-xl border border-black/10 dark:border-white/10",
  table: "w-full text-sm",
  thead: "bg-black/[0.02] text-left text-xs text-black/55 dark:bg-white/[0.03] dark:text-white/55",
  th: "px-4 py-2.5 font-medium",
  tr: "border-t border-black/[0.06] dark:border-white/[0.06]",
  trLink: "border-t border-black/[0.06] transition hover:bg-black/[0.02] dark:border-white/[0.06] dark:hover:bg-white/[0.03]",
  td: "px-4 py-3",
};

export const inputClass =
  "rounded-md border border-black/15 bg-white px-2.5 py-1.5 text-sm dark:border-white/20 dark:bg-neutral-900";
