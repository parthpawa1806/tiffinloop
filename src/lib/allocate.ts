// Suggests a backup cook or a refund for every order affected by a dropout.
//
// Runs over ALL open dropout events for the day at once, not one event at a time. Backup
// capacity is shared: if Lakshmi's event were planned alone first, her dinner orders would take
// Meena Nair's 8 free slots before Geeta's more urgent lunch orders were considered.
//
// Hard rules (never broken, even by a manual override):
//   - same city
//   - backup is available today (active in the sheet, no dropout event of their own)
//   - backup serves the subscriber's diet (Jain subscribers need a Jain-capable cook)
//   - backup has a free slot left (max_daily_orders minus orders already held)
// Soft preferences, in order:
//   1. same cuisine as the subscriber's preference
//   2. reliable: not a repeat dropper in the last 30 days
//   3. has a phone number (ops must be able to reach the backup to confirm)
//   4. already a backup today: fewer cooks to call and fewer pickups to arrange
//   5. most free slots
// Orders are placed lunch first (less time to fix), then by order ID for a stable result.
// If no eligible cook has a slot, the order is refunded.
//
// Duplicate bookings: when one person (merged duplicate accounts) has two orders for the same
// meal, the second is suggested for refund instead of taking a scarce backup slot. Tariq
// Hussain / Tariq Husain has two lunch orders today and complains about duplicate reminders.

import type { City, Cuisine, Diet, Meal } from "./normalize";

export interface AffectedOrder {
  order_id: string;
  event_id: string;
  meal: Meal;
  amount_inr: number;
  city: City;
  diet: Diet;
  cuisine_pref: Cuisine;
  canonical_subscriber_id: string;
  subscriber_id: string;
}

export interface BackupCook {
  cook_id: string;
  name: string;
  city: City;
  cuisine_specialty: Cuisine;
  serves_veg: boolean;
  serves_non_veg: boolean;
  serves_jain: boolean;
  phone: string | null;
  free_slots: number;
  is_available: boolean;
  dropouts_30d: number;
  orders_30d: number;
}

export interface Suggestion {
  order_id: string;
  event_id: string;
  action: "reassign" | "refund";
  backup_cook_id: string | null;
  refund_amount: number | null;
  cuisine_match: boolean;
  reason: string;
}

// A cook is "unreliable" if at least 3 of their orders, and more than 10% of them, were lost
// to their own dropouts in the last 30 days.
export function isUnreliable(c: Pick<BackupCook, "dropouts_30d" | "orders_30d">): boolean {
  return c.dropouts_30d >= 3 && c.orders_30d > 0 && c.dropouts_30d / c.orders_30d > 0.1;
}

export function servesDiet(c: Pick<BackupCook, "serves_veg" | "serves_non_veg" | "serves_jain">, diet: Diet): boolean {
  return diet === "veg" ? c.serves_veg : diet === "jain" ? c.serves_jain : c.serves_non_veg;
}

// Why a cook cannot take an order, or null if they can. Used by the planner and to validate
// manual overrides on the server.
export function ineligibleReason(order: AffectedOrder, cook: BackupCook, freeSlots: number): string | null {
  if (cook.city !== order.city) return `${cook.name} is in a different city`;
  if (!cook.is_available) return `${cook.name} is not available today`;
  if (!servesDiet(cook, order.diet)) return `${cook.name} does not cook ${dietLabel(order.diet)}`;
  if (freeSlots <= 0) return `${cook.name} has no free slots left`;
  return null;
}

export function dietLabel(d: Diet): string {
  return d === "non_veg" ? "Non-Veg" : d === "jain" ? "Jain" : "Veg";
}

// Best-first list of cooks who can take this order, given current free slots.
// `inUse` = cooks already backing up orders today.
export function rankBackups(
  order: AffectedOrder,
  cooks: BackupCook[],
  slots: Map<string, number>,
  inUse: Set<string> = new Set(),
): BackupCook[] {
  return cooks
    .filter((c) => ineligibleReason(order, c, slots.get(c.cook_id) ?? 0) === null)
    .sort(
      (a, b) =>
        Number(b.cuisine_specialty === order.cuisine_pref) - Number(a.cuisine_specialty === order.cuisine_pref) ||
        Number(isUnreliable(a)) - Number(isUnreliable(b)) ||
        Number(!a.phone) - Number(!b.phone) ||
        Number(inUse.has(b.cook_id)) - Number(inUse.has(a.cook_id)) ||
        (slots.get(b.cook_id) ?? 0) - (slots.get(a.cook_id) ?? 0) ||
        a.cook_id.localeCompare(b.cook_id),
    );
}

// Second and later orders for the same person and meal, mapped to the order kept.
// The kept order is the one on the person's canonical account, else the lowest order ID.
export function duplicateBookings(orders: AffectedOrder[]): Map<string, string> {
  const groups = new Map<string, AffectedOrder[]>();
  for (const o of orders) {
    const k = `${o.canonical_subscriber_id}|${o.meal}`;
    groups.set(k, [...(groups.get(k) ?? []), o]);
  }
  const dupes = new Map<string, string>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const [keep, ...rest] = [...g].sort(
      (a, b) =>
        Number(a.subscriber_id !== a.canonical_subscriber_id) - Number(b.subscriber_id !== b.canonical_subscriber_id) ||
        a.order_id.localeCompare(b.order_id),
    );
    for (const o of rest) dupes.set(o.order_id, keep.order_id);
  }
  return dupes;
}

// Why no same-cuisine cook could take the order: nobody available, nobody makes the diet,
// or they're all full.
export function whyNotSameCuisine(order: AffectedOrder, cooks: BackupCook[], slots: Map<string, number>): string {
  const same = cooks.filter((c) => c.city === order.city && c.cuisine_specialty === order.cuisine_pref && c.is_available);
  if (!same.length) return `No ${order.cuisine_pref} cook is available in ${order.city} today`;
  const canMake = same.filter((c) => servesDiet(c, order.diet));
  if (!canMake.length) return `No available ${order.cuisine_pref} cook makes ${dietLabel(order.diet)}`;
  if (canMake.every((c) => (slots.get(c.cook_id) ?? 0) <= 0)) {
    return `${order.cuisine_pref} backups are full${order.meal === "dinner" ? " (lunch orders went first)" : ""}`;
  }
  return `A ${order.cuisine_pref} cook is free but ranked lower`;
}

// `alreadyBackingUp` = cooks holding reassigned orders from decisions already saved today.
export function allocate(
  orders: AffectedOrder[],
  cooks: BackupCook[],
  alreadyBackingUp: Iterable<string> = [],
): Suggestion[] {
  const slots = new Map(cooks.map((c) => [c.cook_id, c.free_slots]));
  const inUse = new Set(alreadyBackingUp);
  const dupes = duplicateBookings(orders);
  const queue = [...orders].sort(
    (a, b) => Number(a.meal === "dinner") - Number(b.meal === "dinner") || a.order_id.localeCompare(b.order_id),
  );

  return queue.map((order) => {
    const keptOrder = dupes.get(order.order_id);
    if (keptOrder) {
      return {
        order_id: order.order_id,
        event_id: order.event_id,
        action: "refund",
        backup_cook_id: null,
        refund_amount: order.amount_inr,
        cuisine_match: false,
        reason: `Duplicate booking: same person already has ${keptOrder} for ${order.meal} (two accounts)`,
      };
    }
    const [best] = rankBackups(order, cooks, slots, inUse);
    if (!best) {
      return {
        order_id: order.order_id,
        event_id: order.event_id,
        action: "refund",
        backup_cook_id: null,
        refund_amount: order.amount_inr,
        cuisine_match: false,
        reason: `No available cook in ${order.city} who makes ${dietLabel(order.diet)} has a free slot`,
      };
    }
    const match = best.cuisine_specialty === order.cuisine_pref;
    const reason = match
      ? `Same cuisine (${best.cuisine_specialty})`
      : `${whyNotSameCuisine(order, cooks, slots)}; ${best.name} makes ${dietLabel(order.diet)} ${best.cuisine_specialty}`;
    slots.set(best.cook_id, (slots.get(best.cook_id) ?? 0) - 1);
    inUse.add(best.cook_id);
    return {
      order_id: order.order_id,
      event_id: order.event_id,
      action: "reassign",
      backup_cook_id: best.cook_id,
      refund_amount: null,
      cuisine_match: match,
      reason,
    };
  });
}
