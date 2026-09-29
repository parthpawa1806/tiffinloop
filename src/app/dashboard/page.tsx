import Link from "next/link";
import { BarChart, Heatmap, TrendChart } from "@/components/charts";
import { FilterForm } from "@/components/filter-form";
import { Badge, Kpi, Muted, PageHeader, Panel, Tabs, inputClass, tableClasses as t } from "@/components/ui";
import { TODAY } from "@/lib/config";
import { loadDashboard } from "@/lib/dashboard-data";
import { fmtDate, fmtDuration, inr } from "@/lib/format";
import { type Dashboard, type DashFilters, addDays } from "@/lib/metrics";
import type { City, Meal } from "@/lib/normalize";
import { NO_SHOW_NOTE } from "@/lib/status";

const FIRST_DAY = "2026-08-24"; // earliest order in the data
const CITY_NAME: Record<string, string> = { BLR: "Bengaluru", MUM: "Mumbai", PUNE: "Pune" };
const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const compactInr = (n: number) => (n >= 100_000 ? `₹${(n / 100_000).toFixed(2)}L` : inr(n));

type Sp = Record<string, string | undefined>;

// Date windows. 7 and 30 days are complete days before today; today is still in progress
// (every order is open), so it would drag every rate down.
function resolveRange(sp: Sp): { f: DashFilters; label: string; range: string } {
  const range = ["today", "7d", "30d", "custom"].includes(sp.range ?? "") ? sp.range! : "30d";
  const city = (["BLR", "MUM", "PUNE"].includes(sp.city ?? "") ? sp.city : undefined) as City | undefined;
  const meal = (sp.meal === "lunch" || sp.meal === "dinner" ? sp.meal : undefined) as Meal | undefined;
  let from = addDays(TODAY, -30);
  let to = addDays(TODAY, -1);
  if (range === "today") from = to = TODAY;
  if (range === "7d") from = addDays(TODAY, -7);
  if (range === "custom") {
    const clamp = (d: string | undefined, fallback: string) =>
      d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? (d < FIRST_DAY ? FIRST_DAY : d > TODAY ? TODAY : d) : fallback;
    from = clamp(sp.from, from);
    to = clamp(sp.to, to);
    if (from > to) [from, to] = [to, from];
  }
  const label = from === to ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`;
  return { f: { from, to, city, meal }, label, range };
}

export default async function DashboardPage(props: PageProps<"/dashboard">) {
  const sp = (await props.searchParams) as Sp;
  const tab = sp.tab ?? "overview";
  const { f, label, range } = resolveRange(sp);
  const { dashboard: d, quality } = await loadDashboard(f);

  const keep = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "tab") as [string, string][]);
  const tabHref = (key: string) => `/dashboard?${new URLSearchParams([...keep, ["tab", key]])}`;

  return (
    <div>
      <PageHeader
        title="Leadership dashboard"
        subtitle={`Cook dropouts · ${label} · ${f.city ? CITY_NAME[f.city] : "All cities"} · ${f.meal ? (f.meal === "lunch" ? "Lunch" : "Dinner") : "All meals"}`}
      />

      <FilterForm action="/dashboard">
        <input type="hidden" name="tab" value={tab} />
        <select name="range" defaultValue={range} className={inputClass} aria-label="Date range">
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="custom">Custom</option>
        </select>
        {range === "custom" && (
          <>
            <input type="date" name="from" defaultValue={f.from} min={FIRST_DAY} max={TODAY} className={inputClass} aria-label="From" />
            <input type="date" name="to" defaultValue={f.to} min={FIRST_DAY} max={TODAY} className={inputClass} aria-label="To" />
            <button type="submit" className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10">Apply</button>
          </>
        )}
        <select name="city" defaultValue={f.city ?? ""} className={inputClass} aria-label="City">
          <option value="">All cities</option>
          <option value="BLR">Bengaluru</option>
          <option value="MUM">Mumbai</option>
          <option value="PUNE">Pune</option>
        </select>
        <select name="meal" defaultValue={f.meal ?? ""} className={inputClass} aria-label="Meal">
          <option value="">All meals</option>
          <option value="lunch">Lunch</option>
          <option value="dinner">Dinner</option>
        </select>
      </FilterForm>

      <Tabs
        active={tab}
        tabs={[
          { key: "overview", label: "Overview", href: tabHref("overview") },
          { key: "orders", label: "Orders", href: tabHref("orders") },
          { key: "cooks", label: "Cooks", href: tabHref("cooks") },
          { key: "subscribers", label: "Subscribers", href: tabHref("subscribers") },
          { key: "cities", label: "Cities", href: tabHref("cities") },
          { key: "events", label: "Dropout events", href: tabHref("events") },
        ]}
      />

      {tab === "orders" ? <OrdersTab d={d} /> : tab === "cooks" ? <CooksTab d={d} /> : tab === "subscribers" ? <SubscribersTab d={d} /> : tab === "cities" ? <CitiesTab d={d} /> : tab === "events" ? <EventsTab d={d} /> : <Overview d={d} quality={quality} cooksHref={tabHref("cooks")} subsHref={tabHref("subscribers")} />}

      <p className="mt-8 text-xs leading-relaxed text-black/45 dark:text-white/45">
        Statuses are grouped into 5 buckets (delivered, open, cancelled, refunded, cook dropout). {NO_SHOW_NOTE} Orders on a dropout
        logged in the ops tool count as cook dropouts even when a backup covered them. Duplicate cook and subscriber records are
        merged before counting.
      </p>
    </div>
  );
}

// ── Overview: the leadership view ───────────────────────────────────────────
function Overview({ d, quality, cooksHref, subsHref }: { d: Dashboard; quality: Awaited<ReturnType<typeof loadDashboard>>["quality"]; cooksHref: string; subsHref: string }) {
  const h = d.headline;
  const cityBars = [...d.cities].sort((a, b) => b.rate - a.rate).map((c) => ({
    key: c.city,
    label: CITY_NAME[c.city],
    value: c.rate,
    display: `${pct(c.rate)} · ${c.dropouts}`,
    tip: [
      { label: "Dropout rate", value: pct(c.rate) },
      { label: "Dropped orders", value: String(c.dropouts) },
      { label: "Cook-days lost", value: String(c.dropoutDays) },
      { label: "Orders", value: c.orders.toLocaleString("en-IN") },
    ],
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="col-span-2 lg:col-span-1"><Kpi hero label="Dropout rate" value={pct(h.dropoutRate)} sub={`of ${d.orders.total.toLocaleString("en-IN")} orders`} /></div>
        <Kpi label="Total dropouts" value={h.dropouts} sub={`orders · ${h.dropoutDays} cook-days`} />
        <Kpi label="Revenue lost" value={compactInr(h.revenueLost)} sub={`${compactInr(h.lostToDropouts)} to dropouts`} />
        <Kpi label="Subscribers affected" value={h.subscribersAffected} sub={`${d.subscribers.repeatAffected} hit twice or more`} />
        <Kpi label="Repeat-offender cooks" value={h.repeatOffenders} sub="3+ dropout days" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
        <Panel title="Dropout rate by city" aside="rate · dropped orders">
          <BarChart items={cityBars} ariaLabel="Dropout rate by city" />
        </Panel>
        <Panel title="Daily dropouts vs orders" aside={`${d.days} days`}>
          <TrendChart points={d.orders.daily.map((p) => ({ ...p, label: fmtDate(p.date) }))} />
        </Panel>
      </div>

      <Panel title="Cook leaderboard" aside={<Link href={cooksHref} className="hover:underline">All cooks →</Link>}>
        <Leaderboard rows={d.cooks.leaderboard.slice(0, 10)} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Panel title="At-risk subscribers" aside={<Link href={subsHref} className="hover:underline">{d.subscribers.repeatAffected} hit by 2+ dropouts →</Link>}>
          <AtRisk rows={d.subscribers.atRisk.slice(0, 8)} />
        </Panel>
        <Panel title="Data quality">
          <ul className="divide-y divide-black/[0.06] text-sm dark:divide-white/[0.06]">
            <QualityRow label="Past orders still open" value={d.orders.staleOpen} note="never closed out in the log" />
            <QualityRow label="Subscribers with no phone" value={`${d.subscribers.missingPhone} (${pct(d.subscribers.missingPhoneRate, 0)})`} note="can't be messaged" />
            <QualityRow label="Cooks with no phone" value={d.cooks.missingPhone} note="can't confirm as backups" />
            <QualityRow label="Duplicate cook records" value={quality.duplicateCooks} note={d.cooks.duplicates.slice(0, 2).map((x) => x.ids.join("/")).join(", ")} />
            <QualityRow label="Duplicate subscriber accounts" value={quality.duplicateSubscribers} note="merged by phone or name" />
            <QualityRow label="Non-standard dates parsed" value={quality.nonstandardDates} note="dd/mm/yyyy, dd-Mon-yyyy" />
            <QualityRow label="City spellings normalized" value={quality.cityVariants} note="to 3 cities" />
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function QualityRow({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-2">
      <span>
        {label}
        {note && <span className="block text-xs text-black/45 dark:text-white/45">{note}</span>}
      </span>
      <span className="font-medium tabular-nums">{value}</span>
    </li>
  );
}

const COOK_STATUS = {
  active: { label: "Active", tone: "green" },
  on_leave: { label: "On leave", tone: "amber" },
  inactive: { label: "Inactive", tone: "neutral" },
  out_today: { label: "Out today", tone: "red" },
} as const;

function Leaderboard({ rows, full }: { rows: Dashboard["cooks"]["leaderboard"]; full?: boolean }) {
  if (!rows.length) return <Muted className="text-sm">No dropouts in this range.</Muted>;
  return (
    <div className="overflow-x-auto">
      <table className={`${t.table} min-w-[640px]`}>
        <thead className="text-left text-xs text-black/50 dark:text-white/50">
          <tr>
            <th className="pb-2 font-medium">Cook</th>
            <th className="pb-2 text-right font-medium">Dropout days</th>
            <th className="pb-2 text-right font-medium">Orders lost</th>
            <th className="pb-2 text-right font-medium">Rate</th>
            {full && <th className="pb-2 text-right font-medium">Utilization</th>}
            {full && <th className="pb-2 text-right font-medium">Subscribers</th>}
            <th className="pb-2 pl-4 font-medium">Last dropout</th>
            <th className="pb-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = COOK_STATUS[r.status];
            return (
              <tr key={r.cook_id} className="border-t border-black/[0.06] dark:border-white/[0.06]">
                <td className="py-2">
                  <Link href={`/orders?range=30d&cook=${r.cook_id}&status=cook_dropout`} className="font-medium hover:underline">{r.name}</Link>
                  <span className="ml-2 text-xs text-black/45 dark:text-white/45">{r.city} · {r.cuisine}</span>
                </td>
                <td className="py-2 text-right tabular-nums">{r.dropoutDays}{r.dropoutDays >= 3 && <span className="ml-2"><Badge tone="red">repeat</Badge></span>}</td>
                <td className="py-2 text-right tabular-nums">{r.dropoutOrders}</td>
                <td className="py-2 text-right tabular-nums">{pct(r.rate)}</td>
                {full && <td className="py-2 text-right tabular-nums">{pct(r.utilization, 0)}</td>}
                {full && <td className="py-2 text-right tabular-nums">{r.subscribers}</td>}
                <td className="py-2 pl-4">{r.lastDropout ? fmtDate(r.lastDropout) : "—"}</td>
                <td className="py-2"><Badge tone={s.tone}>{s.label}</Badge></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AtRisk({ rows }: { rows: Dashboard["subscribers"]["atRisk"] }) {
  if (!rows.length) return <Muted className="text-sm">Nobody was hit twice in this range.</Muted>;
  return (
    <table className={t.table}>
      <thead className="text-left text-xs text-black/50 dark:text-white/50">
        <tr>
          <th className="pb-2 font-medium">Subscriber</th>
          <th className="pb-2 text-right font-medium">Dropouts</th>
          <th className="pb-2 pl-4 font-medium">Last</th>
          <th className="pb-2 font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.subscriber_id} className="border-t border-black/[0.06] dark:border-white/[0.06]">
            <td className="py-2">
              <Link href={`/chats?with=${r.subscriber_id}`} className="font-medium hover:underline">{r.name}</Link>
              <span className="ml-2 text-xs text-black/45 dark:text-white/45">{r.city}{r.hasPhone ? "" : " · no phone"}</span>
            </td>
            <td className="py-2 text-right tabular-nums">{r.dropouts}</td>
            <td className="py-2 pl-4">{fmtDate(r.lastDropout)}</td>
            <td className="py-2">{r.status === "paused" ? <Badge tone="amber">Paused</Badge> : <Badge tone="green">Active</Badge>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Orders ──────────────────────────────────────────────────────────────────
function OrdersTab({ d }: { d: Dashboard }) {
  const o = d.orders;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Total orders" value={o.total.toLocaleString("en-IN")} sub={`${o.lunch.toLocaleString("en-IN")} lunch · ${o.dinner.toLocaleString("en-IN")} dinner`} />
        <Kpi label="Dropout rate" value={pct(o.dropoutRate)} sub={`${o.counts.cook_dropout} orders`} />
        <Kpi label="Delivery rate" value={pct(o.deliveryRate)} sub={`${o.counts.delivered.toLocaleString("en-IN")} delivered`} />
        <Kpi label="Cancellation · refund rate" value={`${pct(o.cancellationRate)} · ${pct(o.refundRate)}`} />
        <Kpi label="GMV" value={compactInr(o.gmv)} sub="delivered orders" />
        <Kpi label="Revenue lost" value={compactInr(o.revenueLost)} sub={`dropouts ${compactInr(o.lostByCause.cook_dropout)} · cancelled ${compactInr(o.lostByCause.cancelled)} · refunded ${compactInr(o.lostByCause.refunded)}`} />
        <Kpi label="Average order value" value={inr(Math.round(o.aov))} sub="delivered orders" />
        <Kpi label="Stale open orders" value={o.staleOpen} sub={o.staleOpenOldest ? `past dates still open, oldest ${fmtDate(o.staleOpenOldest)}` : "none"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Dropout rate by day of week" aside="rate · dropped orders">
          <BarChart
            ariaLabel="Dropout rate by day of week"
            items={o.weekday.map((w) => ({
              key: w.label,
              label: w.label,
              value: w.rate,
              display: `${pct(w.rate)} · ${w.dropouts}`,
              tip: [
                { label: "Dropout rate", value: pct(w.rate) },
                { label: "Dropouts", value: String(w.dropouts) },
                { label: "Orders", value: String(w.total) },
              ],
            }))}
          />
        </Panel>
        <Panel title="Orders by status">
          <ul className="divide-y divide-black/[0.06] text-sm dark:divide-white/[0.06]">
            {([["delivered", "Delivered"], ["open", "Open"], ["cancelled", "Cancelled"], ["refunded", "Refunded"], ["cook_dropout", "Cook dropout"]] as const).map(([k, l]) => (
              <QualityRow key={k} label={l} value={`${o.counts[k].toLocaleString("en-IN")} · ${pct(o.counts[k] / Math.max(1, o.total))}`} />
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

// ── Cooks ───────────────────────────────────────────────────────────────────
function CooksTab({ d }: { d: Dashboard }) {
  const c = d.cooks;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Active today" value={c.counts.active} sub={`${c.counts.out_today} out today · ${c.counts.on_leave} on leave · ${c.counts.inactive} inactive`} />
        <Kpi label="Repeat offenders" value={c.repeatOffenders.length} sub="3+ dropout days in range" />
        <Kpi label="Avg utilization" value={pct(c.avgUtilization, 0)} sub="daily orders ÷ daily limit" />
        <Kpi label="New cooks" value={c.newCooks} sub="joined in range" />
      </div>
      <Panel title="Dropouts per cook" aside="ranked by dropout days">
        <Leaderboard rows={c.leaderboard} full />
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Do new cooks drop out more?" aside="by tenure today">
          <table className={t.table}>
            <thead className="text-left text-xs text-black/50 dark:text-white/50">
              <tr><th className="pb-2 font-medium">Tenure</th><th className="pb-2 text-right font-medium">Cooks</th><th className="pb-2 text-right font-medium">Orders</th><th className="pb-2 text-right font-medium">Dropout rate</th></tr>
            </thead>
            <tbody>
              {c.tenure.map((b) => (
                <tr key={b.label} className="border-t border-black/[0.06] dark:border-white/[0.06]">
                  <td className="py-2">{b.label}</td>
                  <td className="py-2 text-right tabular-nums">{b.cooks}</td>
                  <td className="py-2 text-right tabular-nums">{b.assigned.toLocaleString("en-IN")}</td>
                  <td className="py-2 text-right tabular-nums">{pct(b.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Spare capacity today" aside="free slots, available cooks">
          <div className="max-h-72 overflow-y-auto">
            <table className={t.table}>
              <tbody>
                {c.spareToday.map((s) => (
                  <tr key={`${s.city}${s.cuisine}`} className="border-t border-black/[0.06] first:border-t-0 dark:border-white/[0.06]">
                    <td className="py-1.5">{s.cuisine}<span className="ml-2 text-xs text-black/45 dark:text-white/45">{s.city}</span></td>
                    <td className="py-1.5 text-right text-xs text-black/50 dark:text-white/50">{s.cooks} cook{s.cooks === 1 ? "" : "s"}</td>
                    <td className="py-1.5 text-right font-medium tabular-nums">{s.slots}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Most subscribers per cook" aside="concentration risk">
          <table className={t.table}>
            <tbody>
              {c.concentration.map((r) => (
                <tr key={r.cook_id} className="border-t border-black/[0.06] first:border-t-0 dark:border-white/[0.06]">
                  <td className="py-1.5">{r.name}<span className="ml-2 text-xs text-black/45 dark:text-white/45">{r.city}</span></td>
                  <td className="py-1.5 text-right tabular-nums">{r.subscribers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Leave and inactive, in range" aside="from status_since">
          {c.leaveEvents.length ? (
            <table className={t.table}>
              <tbody>
                {c.leaveEvents.map((e) => (
                  <tr key={e.cook_id} className="border-t border-black/[0.06] first:border-t-0 dark:border-white/[0.06]">
                    <td className="py-1.5">{e.name}<span className="ml-2 text-xs text-black/45 dark:text-white/45">{e.cook_id} · {e.city}</span></td>
                    <td className="py-1.5"><Badge tone={e.status === "on_leave" ? "amber" : "neutral"}>{e.status === "on_leave" ? "On leave" : "Inactive"}</Badge></td>
                    <td className="py-1.5 text-right">{fmtDate(e.since)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Muted className="text-sm">None in this range.</Muted>
          )}
          {c.duplicates.length > 0 && (
            <p className="mt-4 text-xs text-black/50 dark:text-white/50">
              Duplicate records merged: {c.duplicates.map((x) => `${x.name} (${x.ids.join("/")})`).join(", ")}. {c.missingPhone} cooks have no phone.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ── Subscribers ─────────────────────────────────────────────────────────────
function MixList({ title, items, labels }: { title: string; items: { key: string; count: number }[]; labels?: Record<string, string> }) {
  const total = items.reduce((s, i) => s + i.count, 0) || 1;
  return (
    <div>
      <div className="mb-2 text-xs text-black/50 dark:text-white/50">{title}</div>
      <ul className="space-y-1.5 text-sm">
        {items.map((i) => (
          <li key={i.key} className="grid grid-cols-[1fr_auto] items-center gap-2">
            <span className="flex items-center gap-2">
              <span className="h-1.5 rounded-full" style={{ width: `${Math.max(4, (i.count / total) * 100)}%`, background: "var(--viz-series-1)" }} />
              <span className="whitespace-nowrap">{labels?.[i.key] ?? i.key}</span>
            </span>
            <span className="tabular-nums text-black/60 dark:text-white/60">{i.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SubscribersTab({ d }: { d: Dashboard }) {
  const s = d.subscribers;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Active · paused" value={`${s.active} · ${s.paused}`} sub={`${s.duplicateAccounts} duplicate accounts merged`} />
        <Kpi label="New subscribers" value={s.newInRange} sub="started in range" />
        <Kpi label="Affected by a dropout" value={s.affected} sub={`${s.repeatAffected} hit twice or more`} />
        <Kpi label="Missing phone" value={pct(s.missingPhoneRate, 0)} sub={`${s.missingPhone} can't be notified`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Panel title="At-risk subscribers" aside="2+ dropouts in range">
          <AtRisk rows={s.atRisk} />
        </Panel>
        <div className="space-y-4">
          <Panel title="Paused after a dropout" aside="last order was a dropout">
            {s.pausedAfterDropout.length ? (
              <ul className="text-sm">{s.pausedAfterDropout.map((p) => <li key={p.subscriber_id} className="py-1">{p.name} <Muted className="text-xs">{p.city}</Muted></li>)}</ul>
            ) : (
              <Muted className="text-sm">None.</Muted>
            )}
          </Panel>
          <Panel title="Orphaned subscribers" aside="assigned cook on leave or inactive">
            {s.orphaned.length ? (
              <ul className="text-sm">{s.orphaned.map((p) => <li key={p.subscriber_id} className="py-1">{p.name} <Muted className="text-xs">{p.city} · cook {p.cook}</Muted></li>)}</ul>
            ) : (
              <Muted className="text-sm">None.</Muted>
            )}
          </Panel>
        </div>
      </div>
      <Panel title="Active subscriber mix">
        <div className="grid gap-6 md:grid-cols-3">
          <MixList title="Plan" items={s.mix.plan} labels={{ lunch: "Lunch only", dinner: "Dinner only", both: "Lunch + dinner" }} />
          <MixList title="Diet" items={s.mix.diet} labels={{ veg: "Veg", non_veg: "Non-Veg", jain: "Jain" }} />
          <MixList title="Cuisine" items={s.mix.cuisine} />
        </div>
      </Panel>
    </div>
  );
}

// ── Cities ──────────────────────────────────────────────────────────────────
function CitiesTab({ d }: { d: Dashboard }) {
  return (
    <div className="space-y-4">
      <div className={t.wrap}>
        <table className={`${t.table} min-w-[760px]`}>
          <thead className={t.thead}>
            <tr>
              <th className={t.th}>City</th>
              <th className={`${t.th} text-right`}>Dropout rate</th>
              <th className={`${t.th} text-right`}>Dropouts</th>
              <th className={`${t.th} text-right`}>GMV</th>
              <th className={`${t.th} text-right`}>Revenue lost</th>
              <th className={`${t.th} text-right`}>Subscribers per cook</th>
              <th className={`${t.th} text-right`}>Spare today vs demand</th>
            </tr>
          </thead>
          <tbody>
            {d.cities.map((c) => (
              <tr key={c.city} className={t.tr}>
                <td className={`${t.td} font-medium`}>{CITY_NAME[c.city]}</td>
                <td className={`${t.td} text-right tabular-nums`}>{pct(c.rate)}</td>
                <td className={`${t.td} text-right tabular-nums`}>{c.dropouts} <Muted className="text-xs">/ {c.orders.toLocaleString("en-IN")}</Muted></td>
                <td className={`${t.td} text-right tabular-nums`}>{compactInr(c.gmv)}</td>
                <td className={`${t.td} text-right tabular-nums`}>{compactInr(c.lost)}</td>
                <td className={`${t.td} text-right tabular-nums`}>{c.subsPerCook.toFixed(1)} <Muted className="text-xs">({c.activeSubs}/{c.activeCooks})</Muted></td>
                <td className={`${t.td} text-right tabular-nums`}>{c.spareToday} <Muted className="text-xs">slots / {c.demandToday} orders</Muted></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Panel title="Dropout rate by city and week" aside="darker = higher rate">
        <Heatmap rows={d.heatmap.rows.map((r) => ({ city: CITY_NAME[r.city], cells: r.cells.map((c) => ({ ...c, label: fmtDate(c.week) })) }))} />
      </Panel>
    </div>
  );
}

// ── Dropout events (ops tool) ───────────────────────────────────────────────
function EventsTab({ d }: { d: Dashboard }) {
  const e = d.events;
  if (!e.count) {
    return <Muted className="text-sm">No dropouts were logged in the ops tool in this range. The ops tool went live today; pick &quot;Today&quot; to see its events.</Muted>;
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Kpi label="Dropouts logged" value={e.count} sub={`${e.affectedOrders} orders · avg ${e.avgPeople.toFixed(1)} people each`} />
        <Kpi label="Time to detect" value={fmtDuration(e.avgDetectMinutes * 60_000)} sub="cook's message → logged, average" />
        <Kpi label="Told before their meal" value={pct(e.notifiedOnTimeRate, 0)} sub={`${e.messages} messages`} />
        <Kpi label="Backup coverage" value={pct(e.coverageRate, 0)} sub="affected orders given a backup cook" />
        <Kpi label="Backup vs refund" value={`${pct(e.backupRate, 0)} · ${pct(e.refundRate, 0)}`} sub="of decided orders" />
      </div>
      <div className={t.wrap}>
        <table className={t.table}>
          <thead className={t.thead}>
            <tr>
              <th className={t.th}>Cook</th>
              <th className={`${t.th} text-right`}>Orders</th>
              <th className={`${t.th} text-right`}>People</th>
              <th className={`${t.th} text-right`}>Time to detect</th>
            </tr>
          </thead>
          <tbody>
            {e.list.map((x) => (
              <tr key={x.id} className={t.tr}>
                <td className={t.td}><Link href={`/dropouts/${x.id}`} className="font-medium hover:underline">{x.cook}</Link> <Muted className="text-xs">{x.city}</Muted></td>
                <td className={`${t.td} text-right tabular-nums`}>{x.orders}</td>
                <td className={`${t.td} text-right tabular-nums`}>{x.people}</td>
                <td className={`${t.td} text-right tabular-nums`}>{fmtDuration(x.detectMinutes * 60_000)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
