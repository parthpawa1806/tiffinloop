// Simulated WhatsApp/SMS messages for subscribers and backup cooks.
//
// One message per real person: duplicate accounts (Tariq Hussain / Tariq Husain) get a single
// message covering all their orders. The cook's reason for dropping out is never shared.

import { MEAL_WINDOWS } from "./config";
import type { Cuisine, Diet, Meal } from "./normalize";
import { dietLabel } from "./allocate";

export interface MessageOrder {
  order_id: string;
  meal: Meal;
  action: "reassign" | "refund";
  backup_cook_name: string | null;
  backup_cuisine: Cuisine | null;
  cuisine_pref: Cuisine;
  diet: Diet;
  amount_inr: number;
  duplicate_booking?: boolean; // refunded because the person was booked twice for this meal
}

function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function mealWindow(meal: Meal): string {
  const w = MEAL_WINDOWS[meal];
  return `${to12h(w.start)}–${to12h(w.end)}`;
}

// Latest time a subscriber can reply to swap a different-cuisine backup for a refund:
// one hour before the delivery window opens, so ops can still tell the backup cook.
export function replyBy(meal: Meal): string {
  const [h, m] = MEAL_WINDOWS[meal].start.split(":").map(Number);
  return to12h(`${h - 1}:${m}`);
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function orderLine(o: MessageOrder): string {
  const meal = `${cap(o.meal)} (${mealWindow(o.meal)})`;
  if (o.action === "refund" && o.duplicate_booking) {
    return `Extra ${o.meal}: you were booked twice today under two accounts, so we've cancelled the extra booking. ₹${o.amount_inr} will be refunded within 3–5 working days. We'll merge your accounts so you only get one set of reminders.`;
  }
  if (o.action === "refund") {
    return `${meal}: cancelled for today. ₹${o.amount_inr} will be refunded to your original payment method within 3–5 working days.`;
  }
  if (o.backup_cuisine === o.cuisine_pref) {
    return `${meal}: cooked by ${o.backup_cook_name} instead, same ${o.cuisine_pref} food, same delivery time. Nothing to do.`;
  }
  return (
    `${meal}: we couldn't find a ${o.cuisine_pref} cook in time, so ${o.backup_cook_name} will cook ` +
    `${dietLabel(o.diet)} ${o.backup_cuisine} food for you instead, same delivery time. ` +
    `Prefer a ₹${o.amount_inr} refund? Reply REFUND by ${replyBy(o.meal)}.`
  );
}

// `isUpdate`: the person already got a message about this dropout and the plan changed since.
export function subscriberMessage(args: {
  name: string;
  cookName: string;
  dateLabel: string;
  orders: MessageOrder[];
  isUpdate?: boolean;
}): string {
  const first = args.name.split(" ")[0];
  const cookFirst = args.cookName.split(" ")[0];
  const ordered = [...args.orders].sort(
    (a, b) =>
      Number(a.meal === "dinner") - Number(b.meal === "dinner") ||
      Number(!!a.duplicate_booking) - Number(!!b.duplicate_booking),
  );
  const s = ordered.length > 1 ? "s" : "";
  return [
    args.isUpdate
      ? `Hi ${first}, an update to our earlier message about ${cookFirst} not cooking today (${args.dateLabel}). Here's the new plan for your meal${s}:`
      : `Hi ${first}, this is TiffinLoop. Your cook ${cookFirst} can't cook today (${args.dateLabel}). Here's what happens to your meal${s}:`,
    ...ordered.map((o) => `• ${orderLine(o)}`),
    `Sorry for the change. Reply HELP to talk to us.`,
  ].join("\n");
}

export interface CookBriefOrder {
  meal: Meal;
  subscriber_name: string;
  diet: Diet;
}

export function backupCookBrief(args: { cookName: string; dateLabel: string; orders: CookBriefOrder[] }): string {
  const first = args.cookName.split(" ")[0];
  const lines: string[] = [];
  for (const meal of ["lunch", "dinner"] as const) {
    const os = args.orders.filter((o) => o.meal === meal);
    if (!os.length) continue;
    const byDiet = new Map<string, number>();
    for (const o of os) byDiet.set(dietLabel(o.diet), (byDiet.get(dietLabel(o.diet)) ?? 0) + 1);
    const mix = [...byDiet.entries()].map(([d, n]) => `${n} ${d}`).join(", ");
    lines.push(`• ${cap(meal)}, ready by ${to12h(MEAL_WINDOWS[meal].start)}: ${os.length} extra (${mix}) for ${os.map((o) => o.subscriber_name).join(", ")}`);
  }
  return [
    `Hi ${first}, TiffinLoop here. Can you cook these extra meals today (${args.dateLabel})?`,
    ...lines,
    `Pickup is from your place as usual. Please reply YES to confirm.`,
  ].join("\n");
}
