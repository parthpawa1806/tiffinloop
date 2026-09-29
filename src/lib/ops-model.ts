import "server-only";

// Loads one day of ops state from Supabase and derives everything the ops pages and actions
// need: which orders each dropout affects, the suggested plan, and who has been notified.
// Pages and server actions both build from this, so they always agree.

import { type AffectedOrder, type BackupCook, type Suggestion, allocate } from "./allocate";
import { NOW, TODAY } from "./config";
import type { City, Cuisine, Diet, Meal, MealPlan, OrderStatus } from "./normalize";
import { db } from "./supabase";
import { type TriagedMessage, dropoutSignals, triageMessages } from "./triage";

export interface Cook {
  cook_id: string;
  canonical_cook_id: string;
  name: string;
  city: City;
  cuisine_specialty: Cuisine;
  serves_veg: boolean;
  serves_non_veg: boolean;
  serves_jain: boolean;
  phone: string | null;
  sheet_status: "active" | "on_leave" | "inactive";
  status_since: string | null;
  max_daily_orders: number;
}

export interface Subscriber {
  subscriber_id: string;
  canonical_subscriber_id: string;
  name: string;
  city: City;
  phone: string | null;
  meal_plan: MealPlan;
  cuisine_pref: Cuisine;
  diet: Diet;
}

export interface Order {
  order_id: string;
  order_date: string;
  meal: Meal;
  subscriber_id: string;
  cook_id: string;
  status: OrderStatus;
  amount_inr: number;
}

export interface DropoutEvent {
  id: string;
  cook_id: string;
  event_date: string;
  meals: Meal[];
  reason: string | null;
  source: "whatsapp" | "call" | "sheet" | "ops";
  source_message_id: number | null;
  reported_at: string;
  status: "open" | "resolved";
  created_at: string;
}

export interface Resolution {
  id: string;
  event_id: string;
  order_id: string;
  action: "reassign" | "refund" | "unresolved";
  backup_cook_id: string | null;
  refund_amount: number | null;
  was_suggested: boolean;
  reason: string | null;
  decided_at: string;
}

export interface Notification {
  id: string;
  event_id: string;
  canonical_subscriber_id: string;
  order_ids: string[];
  phone: string | null;
  body: string;
  status: "sent" | "failed_no_phone" | "followed_up";
  deadline: string;
  sent_at: string | null;
  follow_up_note: string | null;
}

export interface LogEntry {
  id: number;
  event_id: string;
  at: string;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
}

export interface WhatsAppMessage {
  id: number;
  sent_at: string;
  sender: string;
  sender_is_ops: boolean;
  sender_cook_id: string | null;
  body: string;
}

export interface AffectedRow {
  order: Order;
  subscriber: Subscriber;
  person: Subscriber; // canonical record for the same human
  resolution: Resolution | null;
  suggestion: Suggestion | null;
  notification: Notification | null; // latest message that covered this order
  needsMessage: boolean; // decided, but the subscriber hasn't been told this decision yet
}

export interface EventView {
  event: DropoutEvent;
  cook: Cook;
  sourceMessage: WhatsAppMessage | null;
  rows: AffectedRow[];
  notifications: Notification[];
  log: LogEntry[];
  decided: number;
  people: number;
  peopleReached: number; // sent or followed up, for their latest decisions
  peopleNeedFollowUp: number;
  complete: boolean;
}

export type Backup = BackupCook & { max_daily_orders: number; load: number; sheet_status: Cook["sheet_status"] };

export interface SuspectedDropout {
  cook: Cook;
  openOrders: { lunch: number; dinner: number };
  sheet: boolean; // sheet says on_leave/inactive
  message: TriagedMessage | null; // WhatsApp evidence
}

export interface DayModel {
  date: string;
  cooks: Map<string, Cook>;
  subscribers: Map<string, Subscriber>;
  backups: Backup[]; // canonical cooks with today's capacity and 30-day reliability
  events: EventView[];
  suspected: SuspectedDropout[];
  triaged: TriagedMessage[];
  messages: Map<number, WhatsAppMessage>;
  clockAnchor: Date | null; // real time the first event of the day was logged
}

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

const OPEN_STATUSES: OrderStatus[] = ["pending", "in_progress"];

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function loadDay(date: string = TODAY): Promise<DayModel> {
  const sb = db();
  const [cooksR, subsR, ordersR, eventsR, capR, statsR, msgsR] = await Promise.all([
    sb.from("cooks").select("cook_id,canonical_cook_id,name,city,cuisine_specialty,serves_veg,serves_non_veg,serves_jain,phone,sheet_status,status_since,max_daily_orders"),
    sb.from("subscribers").select("subscriber_id,canonical_subscriber_id,name,city,phone,meal_plan,cuisine_pref,diet"),
    sb.from("orders").select("order_id,order_date,meal,subscriber_id,cook_id,status,amount_inr").eq("order_date", date),
    sb.from("dropout_events").select("*").eq("event_date", date).order("created_at"),
    sb.rpc("cook_capacity", { p_date: date }),
    sb.rpc("cook_dropout_stats", { p_from: addDays(date, -30), p_to: date }),
    sb.from("whatsapp_messages").select("*").order("id"),
  ]);
  const cooks = new Map(must<Cook[]>(cooksR, "cooks").map((c) => [c.cook_id, c]));
  const subscribers = new Map(must<Subscriber[]>(subsR, "subscribers").map((s) => [s.subscriber_id, s]));
  const orders = must<Order[]>(ordersR, "orders");
  const events = must<DropoutEvent[]>(eventsR, "dropout_events");
  const messages = must<WhatsAppMessage[]>(msgsR, "whatsapp_messages");
  const stats = new Map(
    must<{ cook_id: string; total_orders: number; dropout_orders: number }[]>(statsR, "cook_dropout_stats").map((s) => [s.cook_id, s]),
  );

  const eventIds = events.map((e) => e.id);
  const [resR, notR, logR] = eventIds.length
    ? await Promise.all([
        sb.from("order_resolutions").select("*").in("event_id", eventIds),
        sb.from("notifications").select("*").in("event_id", eventIds).order("sent_at"),
        sb.from("event_log").select("*").in("event_id", eventIds).order("at"),
      ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  const resolutions = new Map(must<Resolution[]>(resR, "order_resolutions").map((r) => [r.order_id, r]));
  const notifications = must<Notification[]>(notR, "notifications");
  const log = must<LogEntry[]>(logR, "event_log");

  const backups: Backup[] = must<Omit<Backup, "dropouts_30d" | "orders_30d">[]>(capR, "cook_capacity").map((c) => ({
    ...c,
    dropouts_30d: stats.get(c.cook_id)?.dropout_orders ?? 0,
    orders_30d: stats.get(c.cook_id)?.total_orders ?? 0,
  }));

  const canon = (cookId: string) => cooks.get(cookId)?.canonical_cook_id ?? cookId;

  // Orders each event takes out: the dropped cook's (and their duplicate records') open
  // orders for that day and those meals.
  const affectedByEvent = new Map<string, Order[]>();
  for (const e of events) {
    affectedByEvent.set(
      e.id,
      orders
        .filter((o) => canon(o.cook_id) === e.cook_id && e.meals.includes(o.meal) && OPEN_STATUSES.includes(o.status))
        .sort((a, b) => Number(a.meal === "dinner") - Number(b.meal === "dinner") || a.order_id.localeCompare(b.order_id)),
    );
  }

  // One plan across every open event, over orders still undecided.
  const toAffected = (o: Order, eventId: string): AffectedOrder => {
    const s = subscribers.get(o.subscriber_id)!;
    return {
      order_id: o.order_id,
      event_id: eventId,
      meal: o.meal,
      amount_inr: o.amount_inr,
      city: s.city,
      diet: s.diet,
      cuisine_pref: s.cuisine_pref,
      subscriber_id: s.subscriber_id,
      canonical_subscriber_id: s.canonical_subscriber_id,
    };
  };
  const undecided = events
    .filter((e) => e.status === "open")
    .flatMap((e) => affectedByEvent.get(e.id)!.filter((o) => !resolutions.has(o.order_id)).map((o) => toAffected(o, e.id)));
  const alreadyBackingUp = [...resolutions.values()].flatMap((r) => (r.backup_cook_id ? [canon(r.backup_cook_id)] : []));
  const plan = new Map(allocate(undecided, backups, alreadyBackingUp).map((s) => [s.order_id, s]));

  const eventViews: EventView[] = events.map((e) => {
    const evNotes = notifications.filter((n) => n.event_id === e.id);
    const rows: AffectedRow[] = affectedByEvent.get(e.id)!.map((o) => {
      const subscriber = subscribers.get(o.subscriber_id)!;
      const resolution = resolutions.get(o.order_id) ?? null;
      const covering = evNotes.filter((n) => n.order_ids.includes(o.order_id));
      const notification = covering.at(-1) ?? null;
      // A decision changed after the last message (e.g. an override) needs a fresh message.
      const needsMessage =
        !!resolution &&
        (!notification || new Date(notification.sent_at ?? 0) < new Date(resolution.decided_at));
      return {
        order: o,
        subscriber,
        person: subscribers.get(subscriber.canonical_subscriber_id)!,
        resolution,
        suggestion: resolution ? null : (plan.get(o.order_id) ?? null),
        notification,
        needsMessage,
      };
    });

    const people = new Map<string, AffectedRow[]>();
    for (const r of rows) people.set(r.person.subscriber_id, [...(people.get(r.person.subscriber_id) ?? []), r]);
    let reached = 0;
    let needFollowUp = 0;
    for (const pr of people.values()) {
      const done = pr.every((r) => r.resolution && !r.needsMessage);
      const latest = pr.map((r) => r.notification?.status);
      if (done && latest.every((s) => s === "sent" || s === "followed_up")) reached++;
      else if (latest.includes("failed_no_phone")) needFollowUp++;
    }
    const decided = rows.filter((r) => r.resolution).length;

    return {
      event: e,
      cook: cooks.get(e.cook_id)!,
      sourceMessage: e.source_message_id ? (messages.find((m) => m.id === e.source_message_id) ?? null) : null,
      rows,
      notifications: evNotes,
      log: log.filter((l) => l.event_id === e.id),
      decided,
      people: people.size,
      peopleReached: reached,
      peopleNeedFollowUp: needFollowUp,
      complete: decided === rows.length && reached === people.size,
    };
  });

  // Suspected dropouts not yet logged: the sheet says unavailable but they hold open orders,
  // or the WhatsApp group says they're out today.
  const loggedCooks = new Set(events.map((e) => e.cook_id));
  const canonicalCooks = [...cooks.values()].filter((c) => c.cook_id === c.canonical_cook_id);
  const triaged = triageMessages(messages, canonicalCooks, date);
  const signals = new Map(dropoutSignals(triaged).map((m) => [m.cookId!, m]));
  const openByCook = new Map<string, { lunch: number; dinner: number }>();
  for (const o of orders) {
    if (!OPEN_STATUSES.includes(o.status)) continue;
    const c = canon(o.cook_id);
    const cur = openByCook.get(c) ?? { lunch: 0, dinner: 0 };
    cur[o.meal]++;
    openByCook.set(c, cur);
  }
  const suspected: SuspectedDropout[] = canonicalCooks
    .filter((c) => !loggedCooks.has(c.cook_id))
    .map((c) => ({
      cook: c,
      openOrders: openByCook.get(c.cook_id) ?? { lunch: 0, dinner: 0 },
      sheet: c.sheet_status !== "active",
      message: signals.get(c.cook_id) ?? null,
    }))
    .filter((s) => (s.sheet && s.openOrders.lunch + s.openOrders.dinner > 0) || s.message)
    .sort((a, b) => b.openOrders.lunch - a.openOrders.lunch || a.cook.name.localeCompare(b.cook.name));

  const anchor = events.length ? new Date(events.map((e) => e.created_at).sort()[0]) : null;

  return {
    date,
    cooks,
    subscribers,
    backups,
    events: eventViews,
    suspected,
    triaged,
    messages: new Map(messages.map((m) => [m.id, m])),
    clockAnchor: anchor,
  };
}

// The scenario clock starts at 10:30 AM when the first dropout of the day is logged and then
// runs in real time, so "sent before lunch" is measured honestly during a demo.
export function scenarioTime(model: Pick<DayModel, "clockAnchor">, real: string | Date): Date {
  if (!model.clockAnchor) return NOW;
  return new Date(NOW.getTime() + (new Date(real).getTime() - model.clockAnchor.getTime()));
}
