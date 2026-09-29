"use server";

// Every ops action writes its decision AND an event_log entry, so each dropout event has a
// complete, append-only history: who was affected, what was decided, who was told.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type AffectedOrder, dietLabel, ineligibleReason } from "@/lib/allocate";
import { TODAY } from "@/lib/config";
import { draftCookBriefs, draftSubscriberMessages } from "@/lib/drafts";
import type { Meal } from "@/lib/normalize";
import { type AffectedRow, type EventView, loadDay } from "@/lib/ops-model";
import { db } from "@/lib/supabase";

const ACTOR = "ops";

async function log(eventId: string, action: string, detail: Record<string, unknown>) {
  const { error } = await db().from("event_log").insert({ event_id: eventId, actor: ACTOR, action, detail });
  if (error) throw new Error(`event_log: ${error.message}`);
}

function str(form: FormData, key: string): string {
  const v = form.get(key);
  if (typeof v !== "string" || !v.trim()) throw new Error(`Missing ${key}`);
  return v.trim();
}

async function findEvent(eventId: string): Promise<{ view: EventView; model: Awaited<ReturnType<typeof loadDay>> }> {
  const model = await loadDay(TODAY);
  const view = model.events.find((e) => e.event.id === eventId);
  if (!view) throw new Error("Dropout event not found");
  return { view, model };
}

// ── Log a dropout ───────────────────────────────────────────────────────────
export async function logDropout(form: FormData) {
  const model = await loadDay(TODAY);
  const picked = model.cooks.get(str(form, "cook_id"));
  if (!picked) throw new Error("Unknown cook");
  const cookId = picked.canonical_cook_id; // duplicate records resolve to one person

  const meals = form.getAll("meals").filter((m): m is Meal => m === "lunch" || m === "dinner");
  if (!meals.length) throw new Error("Pick at least one meal");
  const source = str(form, "source");
  const reason = (form.get("reason") as string | null)?.trim() || null;
  const messageId = Number(form.get("source_message_id")) || null;
  const message = messageId ? model.messages.get(messageId) : undefined;

  const existing = model.events.find((e) => e.event.cook_id === cookId);
  if (existing) redirect(`/events/${existing.event.id}`);

  const { data, error } = await db()
    .from("dropout_events")
    .insert({
      cook_id: cookId,
      event_date: TODAY,
      meals,
      reason,
      source,
      source_message_id: message?.id ?? null,
      // When ops first had the information: the WhatsApp message time if there is one.
      reported_at: message?.sent_at ?? new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(`dropout_events: ${error.message}`);

  const after = await loadDay(TODAY);
  const view = after.events.find((e) => e.event.id === data.id)!;
  await log(data.id, "event_created", {
    cook_id: cookId,
    cook_name: view.cook.name,
    city: view.cook.city,
    meals,
    source,
    reason,
    source_message: message ? { id: message.id, sender: message.sender, body: message.body, sent_at: message.sent_at } : null,
    sheet_status: view.cook.sheet_status,
    affected_orders: view.rows.map((r) => r.order.order_id),
    affected_people: view.people,
  });
  revalidatePath("/", "layout");
  redirect(`/events/${data.id}`);
}

// ── Decide orders ───────────────────────────────────────────────────────────
export async function acceptSuggestions(form: FormData) {
  const eventId = str(form, "event_id");
  const { view } = await findEvent(eventId);
  const rows = view.rows.filter((r) => !r.resolution && r.suggestion);
  if (!rows.length) return;

  const { error } = await db()
    .from("order_resolutions")
    .insert(
      rows.map((r) => ({
        event_id: eventId,
        order_id: r.order.order_id,
        action: r.suggestion!.action,
        backup_cook_id: r.suggestion!.backup_cook_id,
        refund_amount: r.suggestion!.refund_amount,
        was_suggested: true,
        reason: r.suggestion!.reason,
      })),
    );
  if (error) throw new Error(`order_resolutions: ${error.message}`);
  await log(eventId, "plan_accepted", {
    decisions: rows.map((r) => ({
      order_id: r.order.order_id,
      action: r.suggestion!.action,
      backup_cook_id: r.suggestion!.backup_cook_id,
      refund_amount: r.suggestion!.refund_amount,
      reason: r.suggestion!.reason,
    })),
  });
  revalidatePath("/", "layout");
}

function toAffected(r: AffectedRow, eventId: string): AffectedOrder {
  return {
    order_id: r.order.order_id,
    event_id: eventId,
    meal: r.order.meal,
    amount_inr: r.order.amount_inr,
    city: r.subscriber.city,
    diet: r.subscriber.diet,
    cuisine_pref: r.subscriber.cuisine_pref,
    subscriber_id: r.subscriber.subscriber_id,
    canonical_subscriber_id: r.person.subscriber_id,
  };
}

export type DecideState = { error: string | null };

// Manual decision for one order: "refund" or "cook:<cook_id>". Hard rules still apply, and a
// rejected choice comes back as a message next to the Save button.
export async function decideOrder(_prev: DecideState, form: FormData): Promise<DecideState> {
  const eventId = str(form, "event_id");
  const orderId = str(form, "order_id");
  const choice = str(form, "choice");
  const { view, model } = await findEvent(eventId);
  const row = view.rows.find((r) => r.order.order_id === orderId);
  if (!row) return { error: "This order is not part of this dropout" };

  let decision: { action: "reassign" | "refund"; backup_cook_id: string | null; refund_amount: number | null; reason: string };
  if (choice === "refund") {
    if (row.resolution?.action === "refund") return { error: null };
    decision = { action: "refund", backup_cook_id: null, refund_amount: row.order.amount_inr, reason: "Refund chosen by ops" };
  } else {
    const cookId = choice.replace(/^cook:/, "");
    if (row.resolution?.backup_cook_id === cookId) return { error: null };
    const cook = model.backups.find((c) => c.cook_id === cookId);
    if (!cook) return { error: "Unknown backup cook" };
    const problem = ineligibleReason(toAffected(row, eventId), cook, cook.free_slots);
    if (problem) return { error: `Not saved: ${problem}` };
    decision = {
      action: "reassign",
      backup_cook_id: cookId,
      refund_amount: null,
      reason:
        cook.cuisine_specialty === row.subscriber.cuisine_pref
          ? `Chosen by ops: same cuisine (${cook.cuisine_specialty})`
          : `Chosen by ops: ${cook.cuisine_specialty} cook, serves ${dietLabel(row.subscriber.diet)}`,
    };
  }

  const { error } = await db()
    .from("order_resolutions")
    .upsert(
      { event_id: eventId, order_id: orderId, ...decision, was_suggested: false, decided_at: new Date().toISOString() },
      { onConflict: "order_id" },
    );
  if (error) throw new Error(`order_resolutions: ${error.message}`);
  await log(eventId, row.resolution ? "decision_changed" : "order_decided", {
    order_id: orderId,
    from: row.resolution
      ? { action: row.resolution.action, backup_cook_id: row.resolution.backup_cook_id, refund_amount: row.resolution.refund_amount }
      : null,
    to: decision,
    suggested_was: row.suggestion ? { action: row.suggestion.action, backup_cook_id: row.suggestion.backup_cook_id } : null,
    already_messaged: !!row.notification,
  });
  await syncEventStatus(eventId); // a change after messaging reopens the event
  revalidatePath("/", "layout");
  return { error: null };
}

// ── Send messages (simulated) ───────────────────────────────────────────────
export async function sendMessages(form: FormData) {
  const eventId = str(form, "event_id");
  const { view, model } = await findEvent(eventId);
  const drafts = draftSubscriberMessages(view, model);
  const briefs = draftCookBriefs(view, model);
  if (!drafts.length) return;

  const sentAt = new Date().toISOString();
  const rows = drafts.map((d) => ({
    event_id: eventId,
    canonical_subscriber_id: d.personId,
    order_ids: d.orderIds,
    phone: d.phone,
    body: d.body,
    status: d.phone ? "sent" : "failed_no_phone",
    deadline: d.deadline.toISOString(),
    sent_at: sentAt,
  }));
  const { error } = await db().from("notifications").insert(rows);
  if (error) throw new Error(`notifications: ${error.message}`);
  await log(eventId, "messages_sent", {
    sent: rows.filter((r) => r.status === "sent").map((r) => r.canonical_subscriber_id),
    failed_no_phone: rows.filter((r) => r.status === "failed_no_phone").map((r) => r.canonical_subscriber_id),
    orders: rows.flatMap((r) => r.order_ids),
  });

  // Tell each backup cook what they're now cooking.
  for (const b of briefs) {
    await log(eventId, "cook_briefed", {
      cook_id: b.cookId,
      cook_name: b.cookName,
      phone: b.phone,
      status: b.phone ? "sent" : "failed_no_phone",
      order_ids: b.orderIds,
      body: b.body,
    });
  }

  await syncEventStatus(eventId);
  revalidatePath("/", "layout");
}

export async function markFollowedUp(form: FormData) {
  const eventId = str(form, "event_id");
  const notificationId = str(form, "notification_id");
  const note = str(form, "note");
  const { error } = await db()
    .from("notifications")
    .update({ status: "followed_up", follow_up_note: note })
    .eq("id", notificationId)
    .eq("status", "failed_no_phone");
  if (error) throw new Error(`notifications: ${error.message}`);
  await log(eventId, "followed_up", { notification_id: notificationId, note });
  await syncEventStatus(eventId);
  revalidatePath("/", "layout");
}

async function syncEventStatus(eventId: string) {
  const { view } = await findEvent(eventId);
  const status = view.complete ? "resolved" : "open";
  if (status === view.event.status) return;
  const { error } = await db().from("dropout_events").update({ status }).eq("id", eventId);
  if (error) throw new Error(`dropout_events: ${error.message}`);
  await log(eventId, status === "resolved" ? "event_resolved" : "event_reopened", {
    decided: view.decided,
    orders: view.rows.length,
    people_reached: view.peopleReached,
    people: view.people,
  });
}

// ── Demo reset ──────────────────────────────────────────────────────────────
export async function resetDemo() {
  const { error } = await db().rpc("reset_demo");
  if (error) throw new Error(`reset_demo: ${error.message}`);
  revalidatePath("/", "layout");
  redirect("/");
}
