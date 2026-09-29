import "server-only";

// Read queries for the list and detail pages (orders, refunds, chats). Filtering happens in
// Postgres where the table is large (orders), in memory where it's small (cooks).

import { TODAY } from "./config";
import type { City, Meal, OrderStatus } from "./normalize";
import type { Notification } from "./ops-model";
import type { Bucket } from "./status";
import { db } from "./supabase";

export const PAGE_SIZE = 50;

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

type OneOrMany<T> = T | T[];

// PostgREST returns a one-to-one embed as an object, but be tolerant of arrays.
function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── Orders ──────────────────────────────────────────────────────────────────
export interface OrderFilters {
  range: "today" | "7d" | "30d";
  city?: City;
  meal?: Meal;
  status?: Bucket | "reassigned" | "refunded_by_ops";
  cook?: string; // canonical cook id: matches all of that person's records
  q?: string;
  page: number;
}

export interface OrderListRow {
  order_id: string;
  order_date: string;
  meal: Meal;
  status: OrderStatus;
  amount_inr: number;
  subscriber_id: string;
  subscriber_name: string;
  city: City;
  cook_id: string;
  cook_name: string;
  resolution: { action: string; backup_cook_id: string | null; refund_amount: number | null } | null;
}

export async function listOrders(f: OrderFilters, cookNames: Map<string, string>, cookRecords: (canonical: string) => string[]) {
  const needsResolution = f.status === "reassigned" || f.status === "refunded_by_ops";
  let q = db()
    .from("orders")
    .select(
      `order_id,order_date,meal,status,amount_inr,subscriber_id,cook_id,
       subscribers!inner(name,city),
       order_resolutions${needsResolution ? "!inner" : ""}(action,backup_cook_id,refund_amount)`,
      { count: "exact" },
    );

  // Same windows as the dashboard: 7 and 30 days are complete days before today.
  q =
    f.range === "today"
      ? q.eq("order_date", TODAY)
      : q.gte("order_date", addDays(TODAY, f.range === "7d" ? -7 : -30)).lt("order_date", TODAY);
  if (f.city) q = q.eq("subscribers.city", f.city);
  if (f.meal) q = q.eq("meal", f.meal);
  if (f.status === "reassigned") q = q.eq("order_resolutions.action", "reassign");
  else if (f.status === "refunded_by_ops") q = q.eq("order_resolutions.action", "refund");
  else if (f.status === "open") q = q.in("status", ["pending", "in_progress", "unknown"]);
  else if (f.status) q = q.eq("status", f.status);
  if (f.cook) q = q.in("cook_id", cookRecords(f.cook));
  const term = f.q?.trim();
  if (term) {
    if (/^ord\d+$/i.test(term)) q = q.ilike("order_id", `%${term}%`);
    else if (/^sub\d+$/i.test(term)) q = q.ilike("subscriber_id", `%${term}%`);
    else q = q.ilike("subscribers.name", `%${term}%`);
  }

  const res = await q
    .order("order_date", { ascending: false })
    .order("meal", { ascending: true })
    .order("order_id", { ascending: true })
    .range(f.page * PAGE_SIZE, f.page * PAGE_SIZE + PAGE_SIZE - 1);
  if (res.error) throw new Error(`orders: ${res.error.message}`);

  type Raw = Omit<OrderListRow, "subscriber_name" | "city" | "cook_name" | "resolution"> & {
    subscribers: { name: string; city: City } | { name: string; city: City }[];
    order_resolutions: OrderListRow["resolution"] | NonNullable<OrderListRow["resolution"]>[];
  };
  const rows: OrderListRow[] = (res.data as unknown as Raw[]).map((r) => {
    const s = one(r.subscribers)!;
    return {
      order_id: r.order_id,
      order_date: r.order_date,
      meal: r.meal,
      status: r.status,
      amount_inr: r.amount_inr,
      subscriber_id: r.subscriber_id,
      subscriber_name: s.name,
      city: s.city,
      cook_id: r.cook_id,
      cook_name: cookNames.get(r.cook_id) ?? r.cook_id,
      resolution: one(r.order_resolutions),
    };
  });
  return { rows, total: res.count ?? rows.length };
}

// ── Refunds ─────────────────────────────────────────────────────────────────
export interface RefundRow {
  order_id: string;
  order_date: string;
  meal: Meal;
  amount: number;
  subscriber_id: string;
  subscriber_name: string;
  city: City;
  reason: string | null;
  was_suggested: boolean;
  decided_at: string;
  event_id: string;
  dropped_cook_id: string;
}

export async function listRefunds(): Promise<RefundRow[]> {
  type Raw = {
    order_id: string;
    refund_amount: number;
    reason: string | null;
    was_suggested: boolean;
    decided_at: string;
    event_id: string;
    orders: OneOrMany<{ order_date: string; meal: Meal; subscriber_id: string; subscribers: OneOrMany<{ name: string; city: City }> }>;
    dropout_events: OneOrMany<{ cook_id: string }>;
  };
  const res = await db()
    .from("order_resolutions")
    .select("order_id,refund_amount,reason,was_suggested,decided_at,event_id,orders(order_date,meal,subscriber_id,subscribers(name,city)),dropout_events(cook_id)")
    .eq("action", "refund")
    .order("decided_at", { ascending: false });
  if (res.error) throw new Error(`order_resolutions: ${res.error.message}`);
  const data = res.data as unknown as Raw[];
  return data.map((r) => {
    const o = one(r.orders)!;
    const s = one(o.subscribers)!;
    return {
      order_id: r.order_id,
      order_date: o.order_date,
      meal: o.meal,
      amount: r.refund_amount,
      subscriber_id: o.subscriber_id,
      subscriber_name: s.name,
      city: s.city,
      reason: r.reason,
      was_suggested: r.was_suggested,
      decided_at: r.decided_at,
      event_id: r.event_id,
      dropped_cook_id: one(r.dropout_events)!.cook_id,
    };
  });
}

// ── Chats ───────────────────────────────────────────────────────────────────
export async function listMessages(personId?: string): Promise<Notification[]> {
  let q = db().from("notifications").select("*").order("sent_at", { ascending: true });
  if (personId) q = q.eq("canonical_subscriber_id", personId);
  return must<Notification[]>(await q, "notifications");
}

export async function messagesForOrder(orderId: string): Promise<Notification[]> {
  return must<Notification[]>(
    await db().from("notifications").select("*").contains("order_ids", [orderId]).order("sent_at"),
    "notifications",
  );
}

// ── Single order (historical or today) ──────────────────────────────────────
export interface OrderRecord {
  order_id: string;
  order_date: string;
  meal: Meal;
  subscriber_id: string;
  cook_id: string;
  status: OrderStatus;
  raw_status: string;
  amount_inr: number;
}

export async function getOrder(orderId: string): Promise<OrderRecord | null> {
  const res = await db().from("orders").select("*").eq("order_id", orderId).maybeSingle();
  return must<OrderRecord | null>(res, "orders");
}
