// Leadership dashboard metrics. Pure: rows in, numbers out, so every figure is unit-tested
// against the real seed data (metrics.test.ts).
//
// Which date each entity is filtered by:
//   orders       order_date (both source formats already parsed to ISO at seed time)
//   cooks        dropout orders by order_date; leave/inactive by status_since (3 formats,
//                parsed at seed); new cooks by joined_date
//   subscribers  new signups by start_date; activity (affected by a dropout) by order_date
// City: an order's city is its subscriber's city; a cook's is their own. Both normalized.
// People: duplicate records are merged (canonical IDs) before counting cooks or subscribers.

import type { City, Cuisine, Diet, Meal, MealPlan, OrderStatus } from "./normalize";
import { type Bucket, statusBucket } from "./status";

export interface DOrder {
  order_id: string;
  order_date: string;
  meal: Meal;
  subscriber_id: string;
  cook_id: string;
  status: OrderStatus;
  amount_inr: number;
}

export interface DCook {
  cook_id: string;
  canonical_cook_id: string;
  name: string;
  city: City;
  cuisine_specialty: Cuisine;
  phone: string | null;
  sheet_status: "active" | "on_leave" | "inactive";
  status_since: string | null;
  joined_date: string | null;
  max_daily_orders: number;
}

export interface DSub {
  subscriber_id: string;
  canonical_subscriber_id: string;
  name: string;
  city: City;
  phone: string | null;
  assigned_cook_id: string | null;
  meal_plan: MealPlan;
  diet: Diet;
  cuisine_pref: Cuisine;
  subscription_status: "active" | "paused";
  start_date: string | null;
}

// A dropout logged in the ops tool, reduced to what the dashboard needs.
export interface DEvent {
  id: string;
  cook_id: string; // canonical
  event_date: string;
  reported_at: Date;
  logged_at: Date; // on the scenario clock
  affected_order_ids: string[];
  people: number;
  decisions: { order_id: string; action: "reassign" | "refund" | "unresolved" }[];
  messages: { sent_at: Date; deadline: Date | null; status: string }[];
}

export interface DCapacity {
  cook_id: string;
  city: City;
  cuisine_specialty: Cuisine;
  free_slots: number;
  is_available: boolean;
}

export interface DashFilters {
  from: string; // inclusive, ISO date
  to: string; // inclusive
  city?: City;
  meal?: Meal;
}

export interface DashInput {
  today: string;
  orders: DOrder[];
  cooks: DCook[];
  subscribers: DSub[];
  events: DEvent[];
  capacity: DCapacity[];
}

const CITIES: City[] = ["BLR", "MUM", "PUNE"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// Monday of the ISO week.
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return addDays(date, -((d.getUTCDay() + 6) % 7));
}

const rate = (n: number, d: number) => (d ? n / d : 0);

function group<T, K>(xs: T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of xs) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}

export function computeDashboard(input: DashInput, f: DashFilters) {
  const { today } = input;
  const subs = new Map(input.subscribers.map((s) => [s.subscriber_id, s]));
  const cooks = new Map(input.cooks.map((c) => [c.cook_id, c]));
  const canonCook = (id: string) => cooks.get(id)?.canonical_cook_id ?? id;
  const canonSub = (id: string) => subs.get(id)?.canonical_subscriber_id ?? id;
  const cityOf = (o: DOrder) => subs.get(o.subscriber_id)!.city;

  // Orders taken out by a dropout logged today count as cook dropouts, even if a backup
  // rescued them; the rescue is reported separately (backup coverage).
  const loggedDropouts = new Set(input.events.flatMap((e) => e.affected_order_ids));
  const bucket = (o: DOrder): Bucket => (loggedDropouts.has(o.order_id) ? "cook_dropout" : statusBucket(o.status));

  const inRange = (d: string | null) => !!d && d >= f.from && d <= f.to;
  const cityOk = (c: City) => !f.city || c === f.city;
  const orders = input.orders.filter((o) => inRange(o.order_date) && cityOk(cityOf(o)) && (!f.meal || o.meal === f.meal));
  const dropouts = orders.filter((o) => bucket(o) === "cook_dropout");
  const days = dateRange(f.from, f.to);

  // ── 1. Orders ────────────────────────────────────────────────────────────
  const byBucket = Object.fromEntries(
    (["delivered", "open", "cancelled", "refunded", "cook_dropout"] as Bucket[]).map((b) => [b, orders.filter((o) => bucket(o) === b)]),
  ) as Record<Bucket, DOrder[]>;
  const sum = (os: DOrder[]) => os.reduce((s, o) => s + o.amount_inr, 0);
  const gmv = sum(byBucket.delivered);
  const lostDropout = sum(byBucket.cook_dropout);
  const lostCancelled = sum(byBucket.cancelled);
  const lostRefunded = sum(byBucket.refunded);

  const perDay = group(orders, (o) => o.order_date);
  const daily = days.map((d) => {
    const os = perDay.get(d) ?? [];
    const drops = os.filter((o) => bucket(o) === "cook_dropout").length;
    return { date: d, total: os.length, dropouts: drops, rate: rate(drops, os.length) };
  });

  const weekday = WEEKDAYS.map((label, i) => {
    const os = orders.filter((o) => (new Date(`${o.order_date}T00:00:00Z`).getUTCDay() + 6) % 7 === i);
    const drops = os.filter((o) => bucket(o) === "cook_dropout").length;
    return { label, total: os.length, dropouts: drops, rate: rate(drops, os.length) };
  });

  // Past orders still Pending / In Progress: the log was never closed out.
  const stale = orders.filter((o) => o.order_date < today && statusBucket(o.status) === "open");

  const ordersSection = {
    total: orders.length,
    lunch: orders.filter((o) => o.meal === "lunch").length,
    dinner: orders.filter((o) => o.meal === "dinner").length,
    counts: Object.fromEntries(Object.entries(byBucket).map(([k, v]) => [k, v.length])) as Record<Bucket, number>,
    deliveryRate: rate(byBucket.delivered.length, orders.length),
    dropoutRate: rate(byBucket.cook_dropout.length, orders.length),
    cancellationRate: rate(byBucket.cancelled.length, orders.length),
    refundRate: rate(byBucket.refunded.length, orders.length),
    gmv,
    revenueLost: lostDropout + lostCancelled + lostRefunded,
    lostByCause: { cook_dropout: lostDropout, cancelled: lostCancelled, refunded: lostRefunded },
    aov: rate(gmv, byBucket.delivered.length),
    daily,
    weekday,
    staleOpen: stale.length,
    staleOpenOldest: stale.map((o) => o.order_date).sort()[0] ?? null,
  };

  // ── 2. Cooks ─────────────────────────────────────────────────────────────
  const canonicalCooks = input.cooks.filter((c) => c.cook_id === c.canonical_cook_id && cityOk(c.city));
  const outToday = new Set(input.events.filter((e) => e.event_date === today).map((e) => e.cook_id));
  const ordersByCook = group(orders, (o) => canonCook(o.cook_id));
  const nDays = days.length;

  const cookRows = canonicalCooks.map((c) => {
    const os = ordersByCook.get(c.cook_id) ?? [];
    const ds = os.filter((o) => bucket(o) === "cook_dropout");
    const dropoutDays = new Set(ds.map((o) => o.order_date));
    const tenureDays = c.joined_date ? daysBetween(c.joined_date, today) - 1 : null;
    return {
      cook_id: c.cook_id,
      name: c.name,
      city: c.city,
      cuisine: c.cuisine_specialty,
      status: outToday.has(c.cook_id) ? ("out_today" as const) : c.sheet_status,
      assigned: os.length,
      dropoutOrders: ds.length,
      dropoutDays: dropoutDays.size,
      rate: rate(ds.length, os.length),
      lastDropout: [...dropoutDays].sort().at(-1) ?? null,
      utilization: rate(os.length / nDays, c.max_daily_orders),
      tenureDays,
      phone: c.phone,
      subscribers: 0,
    };
  });

  // Active people per cook: concentration risk if that cook drops.
  const activePeople = input.subscribers.filter(
    (s) => s.subscriber_id === s.canonical_subscriber_id && s.subscription_status === "active" && cityOk(s.city),
  );
  const subsPerCook = group(activePeople.filter((s) => s.assigned_cook_id), (s) => canonCook(s.assigned_cook_id!));
  for (const r of cookRows) r.subscribers = subsPerCook.get(r.cook_id)?.length ?? 0;

  const leaderboard = cookRows
    .filter((r) => r.dropoutOrders > 0)
    .sort((a, b) => b.dropoutDays - a.dropoutDays || b.dropoutOrders - a.dropoutOrders || b.rate - a.rate);
  const repeatOffenders = leaderboard.filter((r) => r.dropoutDays >= 3);

  const TENURE = [
    { label: "Under 2 months", max: 60 },
    { label: "2–6 months", max: 182 },
    { label: "6–12 months", max: 365 },
    { label: "Over a year", max: Infinity },
  ];
  const tenure = TENURE.map((b, i) => {
    const min = i === 0 ? -Infinity : TENURE[i - 1].max;
    const rs = cookRows.filter((r) => r.tenureDays !== null && r.tenureDays >= min && r.tenureDays < b.max);
    const assigned = rs.reduce((s, r) => s + r.assigned, 0);
    const drops = rs.reduce((s, r) => s + r.dropoutOrders, 0);
    return { label: b.label, cooks: rs.length, assigned, dropouts: drops, rate: rate(drops, assigned) };
  });

  const spare = group(
    input.capacity.filter((c) => c.is_available && c.free_slots > 0 && cityOk(c.city)),
    (c) => `${c.city}|${c.cuisine_specialty}`,
  );
  const spareToday = [...spare.entries()]
    .map(([k, cs]) => {
      const [city, cuisine] = k.split("|");
      return { city: city as City, cuisine, cooks: cs.length, slots: cs.reduce((s, c) => s + c.free_slots, 0) };
    })
    .sort((a, b) => a.city.localeCompare(b.city) || b.slots - a.slots);

  const recordsPerCook = group(input.cooks.filter((c) => cityOk(c.city)), (c) => c.canonical_cook_id);
  const cooksSection = {
    counts: {
      active: canonicalCooks.filter((c) => c.sheet_status === "active" && !outToday.has(c.cook_id)).length,
      on_leave: canonicalCooks.filter((c) => c.sheet_status === "on_leave").length,
      inactive: canonicalCooks.filter((c) => c.sheet_status === "inactive").length,
      out_today: canonicalCooks.filter((c) => outToday.has(c.cook_id)).length,
    },
    rows: cookRows,
    leaderboard,
    repeatOffenders,
    avgUtilization: rate(
      cookRows.filter((r) => r.status === "active").reduce((s, r) => s + r.utilization, 0),
      cookRows.filter((r) => r.status === "active").length,
    ),
    spareToday,
    concentration: [...cookRows].filter((r) => r.subscribers > 0).sort((a, b) => b.subscribers - a.subscribers).slice(0, 8),
    tenure,
    leaveEvents: input.cooks
      .filter((c) => c.sheet_status !== "active" && inRange(c.status_since) && cityOk(c.city))
      .map((c) => ({ cook_id: c.cook_id, name: c.name, city: c.city, status: c.sheet_status, since: c.status_since! }))
      .sort((a, b) => b.since.localeCompare(a.since)),
    newCooks: canonicalCooks.filter((c) => inRange(c.joined_date)).length,
    missingPhone: canonicalCooks.filter((c) => !c.phone).length,
    duplicates: [...recordsPerCook.entries()]
      .filter(([, rs]) => rs.length > 1)
      .map(([id, rs]) => ({ canonical: id, name: cooks.get(id)!.name, ids: rs.map((r) => r.cook_id) })),
  };

  // ── 3. Subscribers ───────────────────────────────────────────────────────
  const people = input.subscribers.filter((s) => s.subscriber_id === s.canonical_subscriber_id && cityOk(s.city));
  const accounts = group(input.subscribers, (s) => s.canonical_subscriber_id);
  const hasPhone = (personId: string) => (accounts.get(personId) ?? []).some((a) => a.phone);
  const dropsByPerson = group(dropouts, (o) => canonSub(o.subscriber_id));
  const affected = [...dropsByPerson.entries()].map(([id, os]) => {
    const p = subs.get(id)!;
    return {
      subscriber_id: id,
      name: p.name,
      city: p.city,
      status: p.subscription_status,
      dropouts: os.length,
      lastDropout: os.map((o) => o.order_date).sort().at(-1)!,
      hasPhone: hasPhone(id),
    };
  });
  const atRisk = affected.filter((a) => a.dropouts >= 2).sort((a, b) => b.dropouts - a.dropouts || b.lastDropout.localeCompare(a.lastDropout));

  // Last order ever (up to today) per person, to spot pauses that followed a dropout.
  const lastOrder = new Map<string, DOrder>();
  for (const o of input.orders) {
    if (o.order_date > today) continue;
    const id = canonSub(o.subscriber_id);
    const cur = lastOrder.get(id);
    if (!cur || o.order_date > cur.order_date || (o.order_date === cur.order_date && o.meal === "dinner")) lastOrder.set(id, o);
  }
  const pausedAfterDropout = people.filter((p) => {
    const lo = lastOrder.get(p.subscriber_id);
    return p.subscription_status === "paused" && lo && bucket(lo) === "cook_dropout";
  });

  const unavailable = new Set(input.cooks.filter((c) => c.sheet_status !== "active").map((c) => c.canonical_cook_id));
  const active = people.filter((p) => p.subscription_status === "active");
  const mix = <K extends string>(key: (s: DSub) => K) =>
    [...group(active, key).entries()].map(([k, v]) => ({ key: k, count: v.length })).sort((a, b) => b.count - a.count);

  const subscribersSection = {
    active: active.length,
    paused: people.length - active.length,
    newInRange: people.filter((p) => inRange(p.start_date)).length,
    affected: affected.length,
    repeatAffected: atRisk.length,
    atRisk,
    pausedAfterDropout: pausedAfterDropout.map((p) => ({ subscriber_id: p.subscriber_id, name: p.name, city: p.city })),
    mix: { plan: mix((s) => s.meal_plan), diet: mix((s) => s.diet), cuisine: mix((s) => s.cuisine_pref) },
    orphaned: active
      .filter((p) => p.assigned_cook_id && unavailable.has(canonCook(p.assigned_cook_id)))
      .map((p) => ({ subscriber_id: p.subscriber_id, name: p.name, city: p.city, cook: cooks.get(canonCook(p.assigned_cook_id!))!.name })),
    missingPhoneRate: rate(people.filter((p) => !hasPhone(p.subscriber_id)).length, people.length),
    missingPhone: people.filter((p) => !hasPhone(p.subscriber_id)).length,
    duplicateAccounts: input.subscribers.filter((s) => s.subscriber_id !== s.canonical_subscriber_id && cityOk(s.city)).length,
  };

  // ── 4. Cities ────────────────────────────────────────────────────────────
  const todayOrders = input.orders.filter((o) => o.order_date === today && (!f.meal || o.meal === f.meal));
  const cities = CITIES.filter(cityOk).map((city) => {
    const os = orders.filter((o) => cityOf(o) === city);
    const ds = os.filter((o) => bucket(o) === "cook_dropout");
    const cityCooks = input.cooks.filter((c) => c.cook_id === c.canonical_cook_id && c.city === city);
    const activeCooks = cityCooks.filter((c) => c.sheet_status === "active" && !outToday.has(c.cook_id)).length;
    const activeSubs = input.subscribers.filter(
      (s) => s.subscriber_id === s.canonical_subscriber_id && s.city === city && s.subscription_status === "active",
    ).length;
    return {
      city,
      orders: os.length,
      dropouts: ds.length,
      dropoutDays: new Set(ds.map((o) => `${canonCook(o.cook_id)}|${o.order_date}`)).size,
      rate: rate(ds.length, os.length),
      gmv: sum(os.filter((o) => bucket(o) === "delivered")),
      lost: sum(os.filter((o) => ["cook_dropout", "cancelled", "refunded"].includes(bucket(o)))),
      activeCooks,
      activeSubs,
      subsPerCook: rate(activeSubs, activeCooks),
      spareToday: input.capacity.filter((c) => c.city === city && c.is_available).reduce((s, c) => s + Math.max(0, c.free_slots), 0),
      demandToday: todayOrders.filter((o) => cityOf(o) === city).length,
    };
  });
  const weeks = [...new Set(days.map(weekStart))];
  const heatmap = cities.map((c) => ({
    city: c.city,
    cells: weeks.map((w) => {
      const os = orders.filter((o) => cityOf(o) === c.city && weekStart(o.order_date) === w);
      const drops = os.filter((o) => bucket(o) === "cook_dropout").length;
      return { week: w, orders: os.length, dropouts: drops, rate: rate(drops, os.length) };
    }),
  }));

  // ── 5. Dropout events (ops tool) ─────────────────────────────────────────
  const evs = input.events.filter((e) => inRange(e.event_date) && cityOk(cooks.get(e.cook_id)!.city));
  // Reported after it was logged can't happen; clamp so bad input never shows a negative delay.
  const detect = (e: DEvent) => Math.max(0, (e.logged_at.getTime() - e.reported_at.getTime()) / 60_000);
  const decisions = evs.flatMap((e) => e.decisions);
  const affectedOrders = evs.reduce((s, e) => s + e.affected_order_ids.length, 0);
  const msgs = evs.flatMap((e) => e.messages);
  const onTime = msgs.filter((m) => (m.status === "sent" || m.status === "followed_up") && m.deadline && m.sent_at <= m.deadline);
  const eventsSection = {
    count: evs.length,
    list: evs.map((e) => ({
      id: e.id,
      cook: cooks.get(e.cook_id)!.name,
      city: cooks.get(e.cook_id)!.city,
      orders: e.affected_order_ids.length,
      people: e.people,
      detectMinutes: Math.round(detect(e)),
    })),
    avgPeople: rate(evs.reduce((s, e) => s + e.people, 0), evs.length),
    avgDetectMinutes: rate(evs.reduce((s, e) => s + detect(e), 0), evs.length),
    notifiedOnTimeRate: rate(onTime.length, msgs.length),
    messages: msgs.length,
    backupRate: rate(decisions.filter((d) => d.action === "reassign").length, decisions.length),
    refundRate: rate(decisions.filter((d) => d.action === "refund").length, decisions.length),
    coverageRate: rate(decisions.filter((d) => d.action === "reassign").length, affectedOrders),
    affectedOrders,
  };

  // ── Headline ─────────────────────────────────────────────────────────────
  return {
    filters: f,
    days: nDays,
    headline: {
      dropoutRate: ordersSection.dropoutRate,
      dropouts: dropouts.length,
      dropoutDays: new Set(dropouts.map((o) => `${canonCook(o.cook_id)}|${o.order_date}`)).size,
      revenueLost: ordersSection.revenueLost,
      lostToDropouts: lostDropout,
      subscribersAffected: affected.length,
      repeatOffenders: repeatOffenders.length,
    },
    orders: ordersSection,
    cooks: cooksSection,
    subscribers: subscribersSection,
    cities,
    heatmap: { weeks, rows: heatmap },
    events: eventsSection,
  };
}

export type Dashboard = ReturnType<typeof computeDashboard>;
