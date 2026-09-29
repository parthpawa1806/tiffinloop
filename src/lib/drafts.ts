import "server-only";

// Drafts the messages a "Send" would deliver right now. The event page previews exactly these,
// and the send action stores exactly these, so what ops reviews is what goes out.

import { NOW, TIMEZONE, TODAY, mealDeadline } from "./config";
import { type MessageOrder, backupCookBrief, subscriberMessage } from "./messages";
import type { AffectedRow, DayModel, EventView } from "./ops-model";

export const DATE_LABEL = NOW.toLocaleDateString("en-IN", { timeZone: TIMEZONE, weekday: "short", day: "numeric", month: "short" });

export interface SubscriberDraft {
  personId: string;
  personName: string;
  orderIds: string[];
  phone: string | null;
  body: string;
  deadline: Date;
}

export interface CookDraft {
  cookId: string;
  cookName: string;
  phone: string | null;
  orderIds: string[];
  body: string;
}

export function draftSubscriberMessages(view: EventView, model: DayModel): SubscriberDraft[] {
  const pending = view.rows.filter((r) => r.resolution && r.needsMessage);
  // One message per person: orders from duplicate accounts go together.
  const byPerson = new Map<string, AffectedRow[]>();
  for (const r of pending) byPerson.set(r.person.subscriber_id, [...(byPerson.get(r.person.subscriber_id) ?? []), r]);

  return [...byPerson.values()].map((rs) => {
    const person = rs[0].person;
    const orders: MessageOrder[] = rs.map((r) => {
      const res = r.resolution!;
      const backup = res.backup_cook_id ? model.cooks.get(res.backup_cook_id) : null;
      return {
        order_id: r.order.order_id,
        meal: r.order.meal,
        action: res.action === "refund" ? "refund" : "reassign",
        backup_cook_name: backup?.name ?? null,
        backup_cuisine: backup?.cuisine_specialty ?? null,
        cuisine_pref: r.subscriber.cuisine_pref,
        diet: r.subscriber.diet,
        amount_inr: res.refund_amount ?? r.order.amount_inr,
        duplicate_booking: res.reason?.startsWith("Duplicate booking") ?? false,
      };
    });
    return {
      personId: person.subscriber_id,
      personName: person.name,
      orderIds: rs.map((r) => r.order.order_id),
      // Any phone on file across the person's accounts.
      phone: person.phone ?? rs.map((r) => r.subscriber.phone).find(Boolean) ?? null,
      body: subscriberMessage({
        name: person.name,
        cookName: view.cook.name,
        dateLabel: DATE_LABEL,
        orders,
        isUpdate: rs.some((r) => r.notification !== null),
      }),
      deadline: mealDeadline(TODAY, rs.some((r) => r.order.meal === "lunch") ? "lunch" : "dinner"),
    };
  });
}

// Briefs for backup cooks, covering orders assigned to them that they haven't been told about.
export function draftCookBriefs(view: EventView, model: DayModel): CookDraft[] {
  const briefed = new Set(
    view.log.filter((l) => l.action === "cook_briefed").flatMap((l) => (l.detail.order_ids as string[]) ?? []),
  );
  const byCook = new Map<string, AffectedRow[]>();
  for (const r of view.rows) {
    const c = r.resolution?.backup_cook_id;
    if (c && r.needsMessage && !briefed.has(r.order.order_id)) byCook.set(c, [...(byCook.get(c) ?? []), r]);
  }
  return [...byCook.entries()].map(([cookId, rs]) => {
    const cook = model.cooks.get(cookId)!;
    return {
      cookId,
      cookName: cook.name,
      phone: cook.phone,
      orderIds: rs.map((r) => r.order.order_id),
      body: backupCookBrief({
        cookName: cook.name,
        dateLabel: DATE_LABEL,
        orders: rs.map((r) => ({ meal: r.order.meal, subscriber_name: r.subscriber.name, diet: r.subscriber.diet })),
      }),
    };
  });
}
