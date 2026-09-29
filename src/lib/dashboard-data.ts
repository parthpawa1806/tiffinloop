import "server-only";

// Loads everything the leadership dashboard needs, then hands it to the pure metrics module.

import { TODAY } from "./config";
import { type DCapacity, type DCook, type DEvent, type DOrder, type DSub, type DashFilters, computeDashboard } from "./metrics";
import { loadDay, scenarioTime } from "./ops-model";
import { db } from "./supabase";

const PAGE = 1000; // PostgREST response cap

async function allOrders(): Promise<DOrder[]> {
  const cols = "order_id,order_date,meal,subscriber_id,cook_id,status,amount_inr";
  const first = await db().from("orders").select(cols, { count: "exact" }).order("order_id").range(0, PAGE - 1);
  if (first.error) throw new Error(`orders: ${first.error.message}`);
  const total = first.count ?? 0;
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, Math.ceil(total / PAGE) - 1) }, (_, i) =>
      db().from("orders").select(cols).order("order_id").range((i + 1) * PAGE, (i + 2) * PAGE - 1),
    ),
  );
  for (const r of rest) if (r.error) throw new Error(`orders: ${r.error.message}`);
  return [first, ...rest].flatMap((r) => r.data as DOrder[]);
}

export async function loadDashboard(f: DashFilters) {
  const [orders, cooksR, subsR, issuesR, model] = await Promise.all([
    allOrders(),
    db().from("cooks").select("cook_id,canonical_cook_id,name,city,cuisine_specialty,phone,sheet_status,status_since,joined_date,max_daily_orders"),
    db().from("subscribers").select("subscriber_id,canonical_subscriber_id,name,city,phone,assigned_cook_id,meal_plan,diet,cuisine_pref,subscription_status,start_date"),
    db().from("data_issues").select("entity,issue,raw_value,row_count"),
    loadDay(TODAY),
  ]);
  if (cooksR.error) throw new Error(`cooks: ${cooksR.error.message}`);
  if (subsR.error) throw new Error(`subscribers: ${subsR.error.message}`);
  if (issuesR.error) throw new Error(`data_issues: ${issuesR.error.message}`);

  const events: DEvent[] = model.events.map((v) => ({
    id: v.event.id,
    cook_id: v.event.cook_id,
    event_date: v.event.event_date,
    reported_at: new Date(v.event.reported_at),
    logged_at: scenarioTime(model, v.event.created_at),
    affected_order_ids: v.rows.map((r) => r.order.order_id),
    people: v.people,
    decisions: v.rows.flatMap((r) => (r.resolution ? [{ order_id: r.order.order_id, action: r.resolution.action }] : [])),
    messages: v.notifications.map((n) => ({
      sent_at: scenarioTime(model, n.sent_at ?? new Date()),
      deadline: n.deadline ? new Date(n.deadline) : null,
      status: n.status,
    })),
  }));
  const capacity: DCapacity[] = model.backups.map((b) => ({
    cook_id: b.cook_id,
    city: b.city,
    cuisine_specialty: b.cuisine_specialty,
    free_slots: b.free_slots,
    is_available: b.is_available,
  }));

  const dashboard = computeDashboard(
    { today: TODAY, orders, cooks: cooksR.data as DCook[], subscribers: subsR.data as DSub[], events, capacity },
    f,
  );
  const issues = issuesR.data as { entity: string; issue: string; raw_value: string | null; row_count: number }[];
  const count = (issue: string, entity?: string) =>
    issues.filter((i) => i.issue === issue && (!entity || i.entity === entity)).reduce((s, i) => s + i.row_count, 0);
  return {
    dashboard,
    quality: {
      nonstandardDates: count("nonstandard_date"),
      cityVariants: new Set(issues.filter((i) => i.issue === "city_mapped").map((i) => i.raw_value)).size,
      duplicateSubscribers: count("duplicate_of", "subscribers"),
      duplicateCooks: count("duplicate_of", "cooks"),
    },
  };
}
