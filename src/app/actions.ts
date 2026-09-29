"use server";

// Every ops action writes its decision AND an event_log entry, so each dropout event has a
// complete, append-only history: who was affected, what was decided, who was told.
//
// Automation: deciding an order (accept, assign, refund, change) messages the affected
// subscribers and briefs the backup cooks straight away. There is no separate "send" step.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type AffectedOrder, dietLabel, ineligibleReason } from "@/lib/allocate";
import { TODAY } from "@/lib/config";
import { draftCookBriefs, draftSubscriberMessages } from "@/lib/drafts";
import type { Meal } from "@/lib/normalize";
import { type AffectedRow, loadDayFresh as loadDay, scenarioTime } from "@/lib/ops-model";
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

async function findEvent(eventId: string) {
  const model = await loadDay(TODAY);
  const view = model.events.find((e) => e.event.id === eventId);
  if (!view) throw new Error("Dropout event not found");
  return { view, model };
}

// ── Step 1: report a dropout ────────────────────────────────────────────────
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
  if (existing) redirect(`/dropouts/${existing.event.id}`);

  const { data, error } = await db()
    .from("dropout_events")
    .insert({
      cook_id: cookId,
      event_date: TODAY,
      meals,
      reason,
      source,
      source_message_id: message?.id ?? null,
      // When ops first had the information: the WhatsApp message time if there is one,
      // otherwise now on the scenario clock (never the real clock: the scenario is 23 Sep).
      reported_at: message?.sent_at ?? scenarioTime(model, new Date()).toISOString(),
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
  redirect(`/dropouts/${data.id}`);
}

// ── Step 2: decide orders (bulk or single) ──────────────────────────────────
export type DecideState = { message: string | null; errors: { order_id: string; reason: string }[] };

type Decision = {
  action: "reassign" | "refund";
  backup_cook_id: string | null;
  refund_amount: number | null;
  reason: string;
};

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

// choice: "suggested" | "refund" | "cook:<cook_id>". Hard rules are re-checked per order;
// orders that break one are skipped and reported back, the rest are saved and messaged.
export async function decideOrders(_prev: DecideState, form: FormData): Promise<DecideState> {
  const eventId = str(form, "event_id");
  const choice = str(form, "choice");
  const ids = new Set(form.getAll("order_ids").map(String));
  if (!ids.size) return { message: null, errors: [{ order_id: "", reason: "Select at least one order" }] };

  const { view, model } = await findEvent(eventId);
  const rows = view.rows
    .filter((r) => ids.has(r.order.order_id))
    .sort((a, b) => Number(a.order.meal === "dinner") - Number(b.order.meal === "dinner") || a.order.order_id.localeCompare(b.order.order_id));

  const errors: DecideState["errors"] = [];
  const decided: { row: AffectedRow; decision: Decision; suggested: boolean }[] = [];

  if (choice === "suggested") {
    for (const r of rows) {
      if (!r.suggestion) {
        errors.push({ order_id: r.order.order_id, reason: r.resolution ? "Already decided" : "No suggestion available" });
        continue;
      }
      const s = r.suggestion;
      decided.push({ row: r, suggested: true, decision: { action: s.action, backup_cook_id: s.backup_cook_id, refund_amount: s.refund_amount, reason: s.reason } });
    }
  } else if (choice === "refund") {
    for (const r of rows) {
      if (r.resolution?.action === "refund") continue;
      decided.push({ row: r, suggested: false, decision: { action: "refund", backup_cook_id: null, refund_amount: r.order.amount_inr, reason: "Refund chosen by ops" } });
    }
  } else {
    const cookId = choice.replace(/^cook:/, "");
    const cook = model.backups.find((c) => c.cook_id === cookId);
    if (!cook) return { message: null, errors: [{ order_id: "", reason: "Unknown backup cook" }] };
    let slots = cook.free_slots;
    for (const r of rows) {
      if (r.resolution?.backup_cook_id === cookId) continue;
      const problem = ineligibleReason(toAffected(r, eventId), cook, slots);
      if (problem) {
        errors.push({ order_id: r.order.order_id, reason: problem });
        continue;
      }
      slots--;
      decided.push({
        row: r,
        suggested: false,
        decision: {
          action: "reassign",
          backup_cook_id: cookId,
          refund_amount: null,
          reason:
            cook.cuisine_specialty === r.subscriber.cuisine_pref
              ? `Chosen by ops: same cuisine (${cook.cuisine_specialty})`
              : `Chosen by ops: ${cook.cuisine_specialty} cook, makes ${dietLabel(r.subscriber.diet)}`,
        },
      });
    }
  }

  if (!decided.length) return { message: null, errors };

  const now = new Date().toISOString();
  const { error } = await db()
    .from("order_resolutions")
    .upsert(
      decided.map(({ row, decision, suggested }) => ({
        event_id: eventId,
        order_id: row.order.order_id,
        ...decision,
        was_suggested: suggested,
        decided_at: now,
      })),
      { onConflict: "order_id" },
    );
  if (error) throw new Error(`order_resolutions: ${error.message}`);

  await log(eventId, "orders_decided", {
    choice,
    decisions: decided.map(({ row, decision }) => ({
      order_id: row.order.order_id,
      from: row.resolution
        ? { action: row.resolution.action, backup_cook_id: row.resolution.backup_cook_id, refund_amount: row.resolution.refund_amount }
        : null,
      to: decision,
      already_messaged: !!row.notification,
    })),
    rejected: errors,
  });

  const sent = await autoNotify(eventId);
  await syncEventStatus(eventId);
  revalidatePath("/", "layout");
  return {
    message: `${decided.length} order${decided.length === 1 ? "" : "s"} saved · ${sent} message${sent === 1 ? "" : "s"} sent`,
    errors,
  };
}

// Messages every person whose decision they haven't heard yet, and briefs backup cooks on
// newly assigned orders. Returns the number of subscriber messages created.
async function autoNotify(eventId: string): Promise<number> {
  const { view, model } = await findEvent(eventId);
  const drafts = draftSubscriberMessages(view, model);
  const briefs = draftCookBriefs(view, model);
  if (!drafts.length) return 0;

  const sentAt = new Date().toISOString();
  const rows = drafts.map((d) => ({
    event_id: eventId,
    kind: "dropout",
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
    automatic: true,
    sent: rows.filter((r) => r.status === "sent").map((r) => r.canonical_subscriber_id),
    failed_no_phone: rows.filter((r) => r.status === "failed_no_phone").map((r) => r.canonical_subscriber_id),
    orders: rows.flatMap((r) => r.order_ids),
  });
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
  return rows.length;
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

// ── Chats ───────────────────────────────────────────────────────────────────
export type ChatState = { error: string | null };

export async function sendChatMessage(_prev: ChatState, form: FormData): Promise<ChatState> {
  const personId = str(form, "subscriber_id");
  const body = (form.get("body") as string | null)?.trim();
  if (!body) return { error: "Write a message first" };
  const { data: accounts, error: e1 } = await db()
    .from("subscribers")
    .select("subscriber_id,phone")
    .eq("canonical_subscriber_id", personId);
  if (e1) throw new Error(`subscribers: ${e1.message}`);
  if (!accounts?.length) return { error: "Unknown subscriber" };
  const phone = accounts.find((a) => a.subscriber_id === personId)?.phone ?? accounts.find((a) => a.phone)?.phone ?? null;

  const { error } = await db().from("notifications").insert({
    kind: "manual",
    canonical_subscriber_id: personId,
    phone,
    body,
    status: phone ? "sent" : "failed_no_phone",
    sent_at: new Date().toISOString(),
  });
  if (error) throw new Error(`notifications: ${error.message}`);
  revalidatePath("/chats");
  return { error: phone ? null : "No phone on file: saved, but not delivered" };
}

// ── Demo reset ──────────────────────────────────────────────────────────────
export async function resetDemo() {
  const { error } = await db().rpc("reset_demo");
  if (error) throw new Error(`reset_demo: ${error.message}`);
  revalidatePath("/", "layout");
  redirect("/dropouts");
}

