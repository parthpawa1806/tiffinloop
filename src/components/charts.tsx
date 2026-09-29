"use client";

// Small SVG charts for the leadership dashboard. Specs from the dataviz skill: bars <= 24px
// with 4px rounded data-ends, 2px lines, hairline recessive grid, one y-axis per chart,
// text in ink tokens (never the series color), hover tooltip on every mark.

import { type ReactNode, useState } from "react";

// Tooltip positioned inside the nearest [data-tip-root] container. The container is found
// from the event target, so no ref is read during render.
function useTooltip() {
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null);
  const show = (e: React.MouseEvent, body: ReactNode) => {
    const root = (e.currentTarget as Element).closest("[data-tip-root]");
    if (!root) return;
    const r = root.getBoundingClientRect();
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, body });
  };
  const hide = () => setTip(null);
  const node = tip && (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 min-w-32 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-lg border border-black/10 bg-white px-3 py-2 text-xs shadow-sm dark:border-white/15 dark:bg-neutral-900"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.body}
    </div>
  );
  return { show, hide, node };
}

function TipRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-black/55 dark:text-white/55">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;

// Round up to a clean axis maximum.
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= v) return m * mag;
  return 10 * mag;
}

// ── Horizontal bars ─────────────────────────────────────────────────────────
export interface BarItem {
  key: string;
  label: string;
  value: number;
  display: string; // label at the bar tip
  tip: { label: string; value: string }[];
}

export function BarChart({ items, ariaLabel }: { items: BarItem[]; ariaLabel: string }) {
  const t = useTooltip();
  const max = Math.max(...items.map((i) => i.value), 0) || 1;
  return (
    <div data-tip-root className="relative" role="img" aria-label={ariaLabel}>
      <div className="space-y-3">
        {items.map((i) => (
          <div
            key={i.key}
            className="grid grid-cols-[88px_1fr] items-center gap-3"
            onMouseMove={(e) => t.show(e, <><div className="mb-1 font-medium">{i.label}</div>{i.tip.map((r) => <TipRow key={r.label} {...r} />)}</>)}
            onMouseLeave={t.hide}
          >
            <span className="truncate text-sm text-black/70 dark:text-white/70">{i.label}</span>
            <div className="flex items-center gap-2">
              <div
                className="h-5 rounded-r"
                style={{ width: `${Math.max(1, (i.value / max) * 82)}%`, background: "var(--viz-series-1)" }}
              />
              <span className="whitespace-nowrap text-xs tabular-nums text-black/70 dark:text-white/70">{i.display}</span>
            </div>
          </div>
        ))}
      </div>
      {t.node}
    </div>
  );
}

// ── Daily trend: dropouts (line) over total orders (columns), shared x ──────
export interface TrendPoint {
  date: string;
  label: string; // "24 Aug"
  total: number;
  dropouts: number;
  rate: number;
}

export function TrendChart({ points }: { points: TrendPoint[] }) {
  const t = useTooltip();
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const L = 36;
  const R = 8;
  const H1 = 150; // dropouts panel
  const H2 = 64; // orders panel
  const GAP = 26;
  const n = points.length;
  const band = (W - L - R) / Math.max(1, n);
  const x = (i: number) => L + band * i + band / 2;
  const maxD = niceMax(Math.max(...points.map((p) => p.dropouts), 1));
  const maxT = niceMax(Math.max(...points.map((p) => p.total), 1));
  const y1 = (v: number) => 8 + (H1 - 8) * (1 - v / maxD);
  const y2 = (v: number) => H1 + GAP + H2 * (1 - v / maxT);
  const base2 = H1 + GAP + H2;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y1(p.dropouts).toFixed(1)}`).join("");
  const labelEvery = Math.ceil(n / 8);
  const colW = Math.min(12, band - 2);

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.floor((px - L) / band)));
    setHover(i);
    const p = points[i];
    t.show(e, (
      <>
        <div className="mb-1 font-medium">{p.label}</div>
        <TipRow label="Dropouts" value={p.dropouts} />
        <TipRow label="Orders" value={p.total} />
        <TipRow label="Dropout rate" value={pct(p.rate)} />
      </>
    ));
  };

  return (
    <div data-tip-root className="relative">
      <div className="mb-2 flex gap-4 text-xs text-black/60 dark:text-white/60">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: "var(--viz-series-1)" }} />Dropouts per day</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--viz-axis)" }} />Orders per day</span>
      </div>
      <svg viewBox={`0 0 ${W} ${base2 + 20}`} className="w-full" role="img" aria-label="Daily dropouts and total orders">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={y1(maxD * f)} y2={y1(maxD * f)} stroke="var(--viz-grid)" strokeWidth={1} />
            <text x={L - 6} y={y1(maxD * f)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--viz-muted)">{Math.round(maxD * f)}</text>
          </g>
        ))}
        <text x={L - 6} y={H1 + GAP} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--viz-muted)">{maxT}</text>
        <line x1={L} x2={W - R} y1={base2} y2={base2} stroke="var(--viz-axis)" strokeWidth={1} />
        {points.map((p, i) => (
          <rect
            key={p.date}
            x={x(i) - colW / 2}
            y={y2(p.total)}
            width={colW}
            height={Math.max(0, base2 - y2(p.total))}
            rx={2}
            fill="var(--viz-axis)"
            opacity={hover === null || hover === i ? 1 : 0.6}
          />
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={8} y2={base2} stroke="var(--viz-axis)" strokeWidth={1} />}
        <path d={line} fill="none" stroke="var(--viz-series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && (
          <circle cx={x(hover)} cy={y1(points[hover].dropouts)} r={4.5} fill="var(--viz-series-1)" stroke="var(--viz-surface)" strokeWidth={2} />
        )}
        {points.map((p, i) =>
          i % labelEvery === 0 ? (
            <text key={p.date} x={x(i)} y={base2 + 14} textAnchor="middle" fontSize={10} fill="var(--viz-muted)">{p.label}</text>
          ) : null,
        )}
        <rect x={L} y={0} width={W - L - R} height={base2} fill="transparent" onMouseMove={onMove} onMouseLeave={() => { setHover(null); t.hide(); }} />
      </svg>
      {t.node}
    </div>
  );
}

// ── City x week heatmap (sequential: one hue, opacity by rate) ──────────────
export interface HeatCell {
  week: string;
  label: string;
  orders: number;
  dropouts: number;
  rate: number;
}

export function Heatmap({ rows }: { rows: { city: string; cells: HeatCell[] }[] }) {
  const t = useTooltip();
  const max = Math.max(...rows.flatMap((r) => r.cells.map((c) => c.rate)), 0.0001);
  const weeks = rows[0]?.cells ?? [];
  return (
    <div data-tip-root className="relative overflow-x-auto">
      <table className="w-full border-separate border-spacing-0.5 text-xs">
        <thead>
          <tr>
            <th />
            {weeks.map((c) => <th key={c.week} className="px-1 pb-1 text-center font-normal text-black/50 dark:text-white/50">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.city}>
              <th className="pr-2 text-left font-normal text-black/70 dark:text-white/70">{r.city}</th>
              {r.cells.map((c) => {
                const a = c.orders ? 0.08 + 0.92 * (c.rate / max) : 0;
                return (
                  <td
                    key={c.week}
                    className="h-10 min-w-14 rounded text-center tabular-nums"
                    style={{
                      background: c.orders ? `color-mix(in srgb, var(--viz-series-1) ${Math.round(a * 100)}%, transparent)` : "transparent",
                      color: a > 0.55 ? "#fff" : undefined,
                    }}
                    onMouseMove={(e) => t.show(e, (
                      <>
                        <div className="mb-1 font-medium">{r.city} · week of {c.label}</div>
                        <TipRow label="Dropout rate" value={pct(c.rate)} />
                        <TipRow label="Dropouts" value={c.dropouts} />
                        <TipRow label="Orders" value={c.orders} />
                      </>
                    ))}
                    onMouseLeave={t.hide}
                  >
                    {c.orders ? pct(c.rate, 1) : "–"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {t.node}
    </div>
  );
}
