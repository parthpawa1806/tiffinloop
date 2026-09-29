import Link from "next/link";
import { notFound } from "next/navigation";
import { markFollowedUp } from "@/app/actions";
import { Activity } from "@/components/activity";
import { type BackupOption, BulkPlan, type PlanRow } from "@/components/bulk-plan";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Card, Empty, MessageBubble, PageHeader, Stat, Stepper, Tabs, inputClass } from "@/components/ui";
import { dietLabel, isUnreliable } from "@/lib/allocate";
import { TODAY, mealDeadline } from "@/lib/config";
import { fmtDuration, fmtTime, inr } from "@/lib/format";
import { type AffectedRow, type DayModel, type EventView, loadDay, scenarioTime } from "@/lib/ops-model";

const UUID = /^[0-9a-f-]{36}$/i;
const SOURCE = { whatsapp: "WhatsApp", call: "phone call", sheet: "the sheet", ops: "ops" } as const;

export default async function DropoutPage(props: PageProps<"/dropouts/[id]">) {
  const { id } = await props.params;
  const { tab = "orders" } = (await props.searchParams) as { tab?: string };
  if (!UUID.test(id)) notFound();
  const model = await loadDay(TODAY);
  const view = model.events.find((e) => e.event.id === id);
  if (!view) notFound();

  const { cook, event } = view;
  const loggedAt = scenarioTime(model, event.created_at);
  const lag = loggedAt.getTime() - new Date(event.reported_at).getTime();
  const step = view.decided < view.rows.length ? 1 : view.complete ? 3 : 2;
  const unlogged = model.suspected.filter((s) => s.cook.city === cook.city);
  const base = `/dropouts/${id}`;

  return (
    <div>
      <PageHeader
        back={{ href: "/dropouts?tab=logged", label: "Cook dropouts" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {cook.name}
            {view.complete ? <Badge tone="green">Resolved</Badge> : <Badge tone="red">Open</Badge>}
          </span>
        }
        subtitle={
          <>
            {cook.city} · {cook.cuisine_specialty} · out for {event.meals.join(" and ")} · reported {fmtTime(event.reported_at)} via {SOURCE[event.source]}
            {lag > 60_000 && <>, picked up {fmtDuration(lag)} later</>}
          </>
        }
      />

      <Stepper steps={["Report", "Plan backups", "Everyone told"]} current={step} />

      <div className="mb-6 grid grid-cols-3 gap-3 sm:max-w-lg">
        <Stat label="orders covered" value={`${view.decided}/${view.rows.length}`} tone={view.decided === view.rows.length ? "good" : "bad"} />
        <Stat label="people told" value={`${view.peopleReached}/${view.people}`} tone={view.peopleReached === view.people ? "good" : "bad"} />
        <Stat label="need follow-up" value={view.peopleNeedFollowUp} tone={view.peopleNeedFollowUp ? "bad" : undefined} />
      </div>

      <Tabs
        active={tab}
        tabs={[
          { key: "orders", label: "Orders", href: `${base}?tab=orders`, count: view.rows.length },
          { key: "messages", label: "Messages", href: `${base}?tab=messages`, count: view.notifications.length },
          { key: "activity", label: "Activity", href: `${base}?tab=activity` },
        ]}
      />

      {tab === "messages" ? (
        <Messages view={view} model={model} />
      ) : tab === "activity" ? (
        <Activity log={view.log} model={model} />
      ) : (
        <>
          {unlogged.length > 0 && !view.complete && (
            <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              {unlogged.map((s) => s.cook.name).join(", ")} in {cook.city} also look{unlogged.length === 1 ? "s" : ""} out.{" "}
              <Link href="/dropouts" className="font-medium underline">Report first</Link> so backups are shared fairly.
            </div>
          )}
          {view.rows.length === 0 ? (
            <Empty>No open orders for these meals today.</Empty>
          ) : (
            <BulkPlan eventId={id} rows={view.rows.map((r) => planRow(r, model))} backups={backupOptions(view, model)} />
          )}
        </>
      )}
    </div>
  );
}

function planRow(r: AffectedRow, model: DayModel): PlanRow {
  const d = r.resolution ?? r.suggestion;
  const backup = d?.backup_cook_id ? model.cooks.get(d.backup_cook_id) : null;
  const flags: string[] = [];
  if (!r.subscriber.phone && !r.person.phone) flags.push("No phone");
  if (r.subscriber.subscriber_id !== r.person.subscriber_id) flags.push(`Same person as ${r.person.subscriber_id}`);
  const n = r.notification;
  return {
    orderId: r.order.order_id,
    meal: r.order.meal,
    by: fmtTime(mealDeadline(TODAY, r.order.meal)),
    subscriberName: r.subscriber.name,
    subscriberId: r.subscriber.subscriber_id,
    needs: `${dietLabel(r.subscriber.diet)} · ${r.subscriber.cuisine_pref} · ${inr(r.order.amount_inr)}`,
    flags,
    decision: d
      ? {
          state: r.resolution ? "decided" : "suggested",
          label: d.action === "refund" ? `Refund ${inr(d.refund_amount ?? r.order.amount_inr)}` : (backup?.name ?? ""),
          isRefund: d.action === "refund",
          sameCuisine: backup?.cuisine_specialty === r.subscriber.cuisine_pref,
          reason: d.reason ?? "",
        }
      : null,
    message: !r.resolution
      ? null
      : r.needsMessage && n
        ? "needs_update"
        : n?.status === "sent"
          ? "sent"
          : n?.status === "followed_up"
            ? "followed_up"
            : n?.status === "failed_no_phone"
              ? "no_phone"
              : null,
  };
}

// Cooks in the same city who could take extra orders today, same cuisine first.
function backupOptions(view: EventView, model: DayModel): BackupOption[] {
  return model.backups
    .filter((c) => c.city === view.cook.city && c.is_available && c.free_slots > 0)
    .sort(
      (a, b) =>
        Number(b.cuisine_specialty === view.cook.cuisine_specialty) - Number(a.cuisine_specialty === view.cook.cuisine_specialty) ||
        b.free_slots - a.free_slots,
    )
    .map((c) => ({
      value: `cook:${c.cook_id}`,
      label: `${c.name} · ${c.cuisine_specialty} · ${c.free_slots} free · ${[c.serves_veg && "Veg", c.serves_non_veg && "NV", c.serves_jain && "Jain"].filter(Boolean).join("/")}${isUnreliable(c) ? " · unreliable" : ""}`,
    }));
}

function Messages({ view, model }: { view: EventView; model: DayModel }) {
  if (!view.notifications.length) return <Empty>Messages are sent automatically as soon as orders are decided.</Empty>;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {[...view.notifications].reverse().map((n) => {
        const person = model.subscribers.get(n.canonical_subscriber_id)!;
        return (
          <Card key={n.id}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <Link href={`/chats?with=${person.subscriber_id}`} className="font-medium hover:underline">{person.name}</Link>
              <span className="flex items-center gap-2">
                <span className="text-xs text-black/45 dark:text-white/45">{fmtTime(scenarioTime(model, n.sent_at ?? new Date()))}</span>
                {n.status === "sent" && <Badge tone="green">Sent</Badge>}
                {n.status === "failed_no_phone" && <Badge tone="red">No phone</Badge>}
                {n.status === "followed_up" && <Badge tone="green">Followed up</Badge>}
              </span>
            </div>
            <MessageBubble>{n.body}</MessageBubble>
            {n.status === "failed_no_phone" && (
              <form action={markFollowedUp} className="mt-3 flex flex-wrap gap-2">
                <input type="hidden" name="event_id" value={view.event.id} />
                <input type="hidden" name="notification_id" value={n.id} />
                <input name="note" required placeholder="How they were reached" className={`${inputClass} min-w-0 flex-1`} />
                <SubmitButton variant="secondary" pendingLabel="Saving…">Mark followed up</SubmitButton>
              </form>
            )}
            {n.follow_up_note && <p className="mt-2 text-xs text-black/55 dark:text-white/55">Follow-up: {n.follow_up_note}</p>}
          </Card>
        );
      })}
    </div>
  );
}
