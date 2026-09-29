import Link from "next/link";
import { notFound } from "next/navigation";
import { acceptSuggestions, markFollowedUp, sendMessages } from "@/app/actions";
import { DecisionForm } from "@/components/decision-form";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Card, MessageBubble, Muted, Quote, Section } from "@/components/ui";
import { type BackupCook, dietLabel, isUnreliable, rankBackups } from "@/lib/allocate";
import { TODAY, mealDeadline } from "@/lib/config";
import { draftCookBriefs, draftSubscriberMessages } from "@/lib/drafts";
import { fmtDuration, fmtTime, inr } from "@/lib/format";
import { type AffectedRow, type DayModel, type EventView, type LogEntry, loadDay, scenarioTime } from "@/lib/ops-model";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

export default async function EventPage(props: PageProps<"/events/[id]">) {
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();
  const model = await loadDay(TODAY);
  const view = model.events.find((e) => e.event.id === id);
  if (!view) notFound();

  const now = scenarioTime(model, new Date());
  const loggedAt = scenarioTime(model, view.event.created_at);
  const reportedAt = new Date(view.event.reported_at);
  const lag = loggedAt.getTime() - reportedAt.getTime();
  const undecided = view.rows.filter((r) => !r.resolution);
  const drafts = draftSubscriberMessages(view, model);
  const briefs = draftCookBriefs(view, model);
  const sameCity = model.suspected.filter((s) => s.cook.city === view.cook.city);

  return (
    <div>
      <Link href="/" className="text-sm underline-offset-2 hover:underline">← All dropouts</Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            {view.cook.name} can&apos;t cook today{" "}
            {view.complete ? <Badge tone="green">Resolved</Badge> : <Badge tone="red">Open</Badge>}
          </h1>
          <p className="mt-1 text-sm">
            <Muted>
              {view.cook.cook_id} · {view.cook.city} · {view.cook.cuisine_specialty} · cooks{" "}
              {[view.cook.serves_veg && "Veg", view.cook.serves_non_veg && "Non-Veg", view.cook.serves_jain && "Jain"].filter(Boolean).join(", ")}{" "}
              · out for {view.event.meals.join(" and ")}
            </Muted>
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <Stat label="orders decided" value={`${view.decided}/${view.rows.length}`} good={view.decided === view.rows.length} />
          <Stat label="people told" value={`${view.peopleReached}/${view.people}`} good={view.peopleReached === view.people} />
          <Stat
            label={now < mealDeadline(TODAY, "lunch") ? "until lunch" : "until dinner"}
            value={fmtDuration((now < mealDeadline(TODAY, "lunch") ? mealDeadline(TODAY, "lunch") : mealDeadline(TODAY, "dinner")).getTime() - now.getTime())}
          />
        </div>
      </div>

      <Card className="mt-4 text-sm">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="font-medium">How we heard</div>
            {view.sourceMessage ? (
              <div className="mt-1 space-y-1">
                <Muted>WhatsApp, {fmtTime(view.sourceMessage.sent_at)}, {view.sourceMessage.sender}</Muted>
                <Quote>{view.sourceMessage.body}</Quote>
              </div>
            ) : (
              <div className="mt-1">
                <Muted className="capitalize">{view.event.source}</Muted>
                {view.event.reason && <Quote>{view.event.reason}</Quote>}
              </div>
            )}
          </div>
          <div>
            <div className="font-medium">Response time</div>
            <div className="mt-1">
              First reported {fmtTime(reportedAt)}, logged here {fmtTime(loggedAt)}
              {lag > 60_000 && (
                <>
                  {" "}<Badge tone={lag > 60 * 60_000 ? "red" : "amber"}>{fmtDuration(lag)} after it was first reported</Badge>
                </>
              )}
            </div>
            <Muted>The reason stays internal. Subscribers are only told the cook can&apos;t cook today.</Muted>
          </div>
        </div>
      </Card>

      {sameCity.length > 0 && !view.complete && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
          <b>{sameCity.map((s) => s.cook.name).join(", ")}</b> in {view.cook.city} also look{sameCity.length === 1 ? "s" : ""} out today
          but {sameCity.length === 1 ? "isn't" : "aren't"} logged. Backups are shared across all logged dropouts, lunch first, so{" "}
          <Link href="/" className="font-medium underline">log {sameCity.length === 1 ? "it" : "them"}</Link> before accepting this plan.
        </div>
      )}

      <OrdersSection view={view} model={model} undecided={undecided.length} />
      <MessagesSection view={view} model={model} drafts={drafts} briefs={briefs} />
      <Timeline log={view.log} model={model} />
    </div>
  );
}

function Stat({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <Card className="!px-3 !py-2">
      <div className={`text-lg font-semibold ${good === undefined ? "" : good ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>
        {value}
      </div>
      <Muted className="text-xs">{label}</Muted>
    </Card>
  );
}

// ── Orders ──────────────────────────────────────────────────────────────────
function OrdersSection({ view, model, undecided }: { view: EventView; model: DayModel; undecided: number }) {
  const suggested = view.rows.filter((r) => !r.resolution && r.suggestion).length;
  const people = new Map<string, number>();
  for (const r of view.rows) people.set(r.person.subscriber_id, (people.get(r.person.subscriber_id) ?? 0) + 1);

  return (
    <Section
      title={`1. Decide each order (${view.rows.length} orders, ${view.people} people)`}
      aside={
        suggested > 0 && (
          <form action={acceptSuggestions}>
            <input type="hidden" name="event_id" value={view.event.id} />
            <SubmitButton pendingLabel="Saving…">Accept {suggested} suggestion{suggested === 1 ? "" : "s"}</SubmitButton>
          </form>
        )
      }
    >
      {view.rows.length === 0 ? (
        <Card><Muted>This cook has no open orders for these meals today. Nothing to do.</Muted></Card>
      ) : (
        <>
          <p className="mb-3 text-sm">
            <Muted>
              Suggestions follow hard rules (same city, diet the cook can make, free slot) then prefer the same cuisine, reliable
              cooks, and cooks already covering today. Lunch orders get first pick of backups, across every logged dropout.
              {undecided > 0 && ` ${undecided} still undecided.`}
            </Muted>
          </p>
          <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/15">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-black/[0.03] text-left dark:bg-white/5">
                <tr>
                  <th className="px-3 py-2 font-medium">Order</th>
                  <th className="px-3 py-2 font-medium">Subscriber</th>
                  <th className="px-3 py-2 font-medium">Needs</th>
                  <th className="px-3 py-2 font-medium">Decision</th>
                  <th className="px-3 py-2 font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((r) => (
                  <OrderRow key={r.order.order_id} row={r} view={view} model={model} sharedPerson={(people.get(r.person.subscriber_id) ?? 0) > 1} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}

function OrderRow({ row: r, view, model, sharedPerson }: { row: AffectedRow; view: EventView; model: DayModel; sharedPerson: boolean }) {
  const decision = r.resolution ?? r.suggestion;
  const backup = decision?.backup_cook_id ? model.cooks.get(decision.backup_cook_id) : null;
  const sameCuisine = backup?.cuisine_specialty === r.subscriber.cuisine_pref;
  const deadline = mealDeadline(TODAY, r.order.meal);

  const slots = new Map(model.backups.map((c) => [c.cook_id, c.free_slots]));
  const options: BackupCook[] = rankBackups(
    {
      order_id: r.order.order_id,
      event_id: view.event.id,
      meal: r.order.meal,
      amount_inr: r.order.amount_inr,
      city: r.subscriber.city,
      diet: r.subscriber.diet,
      cuisine_pref: r.subscriber.cuisine_pref,
      subscriber_id: r.subscriber.subscriber_id,
      canonical_subscriber_id: r.person.subscriber_id,
    },
    model.backups,
    slots,
  ).slice(0, 12);
  const current = decision?.action === "refund" ? "refund" : decision?.backup_cook_id ? `cook:${decision.backup_cook_id}` : "";
  const currentMissing = decision?.backup_cook_id && !options.some((o) => o.cook_id === decision.backup_cook_id);

  return (
    <tr className="border-t border-black/10 align-top dark:border-white/10">
      <td className="px-3 py-2">
        <div className="font-medium capitalize">{r.order.meal}</div>
        <Muted className="text-xs">{r.order.order_id} · by {fmtTime(deadline)}</Muted>
      </td>
      <td className="px-3 py-2">
        <div>{r.subscriber.name}</div>
        <div className="mt-0.5 flex flex-wrap gap-1">
          <Muted className="text-xs">{r.subscriber.subscriber_id}</Muted>
          {!r.subscriber.phone && !r.person.phone && <Badge tone="red" title="Can't be messaged">No phone</Badge>}
          {r.subscriber.subscriber_id !== r.person.subscriber_id && (
            <Badge tone="amber" title="Duplicate account of the same person">Same person as {r.person.subscriber_id}</Badge>
          )}
          {sharedPerson && r.subscriber.subscriber_id === r.person.subscriber_id && <Badge tone="amber">Has a duplicate account</Badge>}
        </div>
      </td>
      <td className="px-3 py-2">
        <div>{dietLabel(r.subscriber.diet)}</div>
        <Muted className="text-xs">{r.subscriber.cuisine_pref} · {inr(r.order.amount_inr)}</Muted>
      </td>
      <td className="px-3 py-2">
        {!decision ? (
          <Muted>No suggestion</Muted>
        ) : (
          <div className={r.resolution ? "" : "opacity-70"}>
            <div className="flex flex-wrap items-center gap-1.5">
              {decision.action === "refund" ? (
                <span className="font-medium">Refund {inr(decision.refund_amount ?? r.order.amount_inr)}</span>
              ) : (
                <span className="font-medium">→ {backup?.name}</span>
              )}
              {decision.action === "reassign" && (
                <Badge tone={sameCuisine ? "green" : "amber"}>{sameCuisine ? "same cuisine" : backup?.cuisine_specialty}</Badge>
              )}
              {r.resolution ? (
                <Badge tone="neutral">{r.resolution.was_suggested ? "accepted" : "ops choice"}</Badge>
              ) : (
                <Badge tone="blue">suggested</Badge>
              )}
              {r.resolution && r.needsMessage && r.notification && <Badge tone="amber">changed since message</Badge>}
            </div>
            <Muted className="text-xs">{decision.reason}</Muted>
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        <DecisionForm
          eventId={view.event.id}
          orderId={r.order.order_id}
          current={current}
          options={[
            ...(currentMissing && backup ? [{ value: current, label: `${backup.name} (current)` }] : []),
            ...options.map((c) => ({
              value: `cook:${c.cook_id}`,
              label: `${c.name} · ${c.cuisine_specialty} · ${c.free_slots} free${isUnreliable(c) ? " · often drops out" : ""}${c.phone ? "" : " · no phone"}`,
            })),
            { value: "refund", label: `Refund ${inr(r.order.amount_inr)}` },
          ]}
        />
      </td>
    </tr>
  );
}

// ── Messages ────────────────────────────────────────────────────────────────
function MessagesSection({
  view,
  model,
  drafts,
  briefs,
}: {
  view: EventView;
  model: DayModel;
  drafts: ReturnType<typeof draftSubscriberMessages>;
  briefs: ReturnType<typeof draftCookBriefs>;
}) {
  const undecidedPeople = new Set(view.rows.filter((r) => !r.resolution).map((r) => r.person.subscriber_id)).size;
  const cookBriefs = view.log.filter((l) => l.action === "cook_briefed");

  return (
    <Section
      title="2. Tell subscribers and backup cooks"
      aside={
        drafts.length > 0 && (
          <form action={sendMessages}>
            <input type="hidden" name="event_id" value={view.event.id} />
            <SubmitButton pendingLabel="Sending…">
              Send {drafts.length} message{drafts.length === 1 ? "" : "s"}
              {briefs.length > 0 && ` + ${briefs.length} cook brief${briefs.length === 1 ? "" : "s"}`}
            </SubmitButton>
          </form>
        )
      }
    >
      <p className="mb-3 text-sm">
        <Muted>
          Simulated WhatsApp. One message per person, even if they have two accounts.
          {undecidedPeople > 0 && ` ${undecidedPeople} ${undecidedPeople === 1 ? "person is" : "people are"} waiting on an undecided order.`}
        </Muted>
      </p>

      {drafts.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-2 text-sm font-semibold">Ready to send</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {drafts.map((d) => (
              <Card key={d.personId}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{d.personName}</span>
                  {d.phone ? <Muted>{d.phone}</Muted> : <Badge tone="red">No phone: will need follow-up</Badge>}
                </div>
                <MessageBubble>{d.body}</MessageBubble>
              </Card>
            ))}
            {briefs.map((b) => (
              <Card key={b.cookId}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{b.cookName} <Badge tone="blue">backup cook</Badge></span>
                  {b.phone ? <Muted>{b.phone}</Muted> : <Badge tone="red">No phone</Badge>}
                </div>
                <MessageBubble>{b.body}</MessageBubble>
              </Card>
            ))}
          </div>
        </div>
      )}

      {view.notifications.length === 0 && cookBriefs.length === 0 ? (
        drafts.length === 0 && <Card><Muted>Nothing sent yet. Decide orders above to draft messages.</Muted></Card>
      ) : (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Sent</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {[...view.notifications].reverse().map((n) => {
              const person = model.subscribers.get(n.canonical_subscriber_id)!;
              const sent = scenarioTime(model, n.sent_at ?? new Date());
              const ahead = new Date(n.deadline).getTime() - sent.getTime();
              return (
                <Card key={n.id}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{person.name}</span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {n.status === "sent" && <Badge tone="green">Sent {fmtTime(sent)}</Badge>}
                      {n.status === "failed_no_phone" && <Badge tone="red">Not sent: no phone</Badge>}
                      {n.status === "followed_up" && <Badge tone="green">Followed up</Badge>}
                      {n.status === "sent" && (
                        <Badge tone={ahead > 0 ? "neutral" : "red"}>
                          {ahead > 0 ? `${fmtDuration(ahead)} before ${fmtTime(n.deadline)}` : `${fmtDuration(ahead)} late`}
                        </Badge>
                      )}
                    </span>
                  </div>
                  <MessageBubble>{n.body}</MessageBubble>
                  {n.status === "failed_no_phone" && (
                    <form action={markFollowedUp} className="mt-3 flex flex-wrap gap-2">
                      <input type="hidden" name="event_id" value={view.event.id} />
                      <input type="hidden" name="notification_id" value={n.id} />
                      <input
                        name="note"
                        required
                        placeholder="How they were reached, e.g. note left with delivery partner"
                        className="min-w-0 flex-1 rounded-md border border-black/15 bg-white px-2 py-1 text-sm dark:border-white/20 dark:bg-neutral-900"
                      />
                      <SubmitButton variant="secondary" pendingLabel="Saving…">Mark followed up</SubmitButton>
                    </form>
                  )}
                  {n.follow_up_note && <p className="mt-2 text-sm"><Muted>Follow-up: {n.follow_up_note}</Muted></p>}
                </Card>
              );
            })}
            {cookBriefs.map((l) => (
              <Card key={l.id}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{String(l.detail.cook_name)} <Badge tone="blue">backup cook</Badge></span>
                  {l.detail.status === "sent" ? (
                    <Badge tone="green">Sent {fmtTime(scenarioTime(model, l.at))}</Badge>
                  ) : (
                    <Badge tone="red">No phone: call via ops</Badge>
                  )}
                </div>
                <MessageBubble>{String(l.detail.body)}</MessageBubble>
              </Card>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

// ── Timeline ────────────────────────────────────────────────────────────────
const ACTION_LABEL: Record<string, string> = {
  event_created: "Dropout logged",
  plan_accepted: "Suggested plan accepted",
  order_decided: "Order decided by ops",
  decision_changed: "Decision changed",
  messages_sent: "Messages sent",
  cook_briefed: "Backup cook briefed",
  followed_up: "Followed up without phone",
  event_resolved: "Event resolved",
  event_reopened: "Event reopened",
};

function summarize(l: LogEntry, model: DayModel): string {
  const d = l.detail as Record<string, unknown>;
  const cook = (id: unknown) => (typeof id === "string" ? (model.cooks.get(id)?.name ?? id) : "");
  switch (l.action) {
    case "event_created":
      return `${(d.affected_orders as string[]).length} orders, ${d.affected_people} people affected. Source: ${d.source}. Sheet said: ${d.sheet_status}.`;
    case "plan_accepted": {
      const ds = d.decisions as { action: string; backup_cook_id: string | null }[];
      const refunds = ds.filter((x) => x.action === "refund").length;
      const cooks = [...new Set(ds.flatMap((x) => (x.backup_cook_id ? [cook(x.backup_cook_id)] : [])))];
      return `${ds.length} orders: ${ds.length - refunds} to ${cooks.join(", ") || "none"}; ${refunds} refunded.`;
    }
    case "order_decided":
    case "decision_changed": {
      const to = d.to as { action: string; backup_cook_id: string | null; refund_amount: number | null };
      const from = d.from as { action: string; backup_cook_id: string | null } | null;
      const fmt = (x: { action: string; backup_cook_id: string | null; refund_amount?: number | null }) =>
        x.action === "refund" ? `refund${x.refund_amount ? ` ${inr(x.refund_amount)}` : ""}` : cook(x.backup_cook_id);
      return `${d.order_id}: ${from ? `${fmt(from)} → ` : ""}${fmt(to)}${d.already_messaged ? " (subscriber needs an update)" : ""}`;
    }
    case "messages_sent":
      return `${(d.sent as string[]).length} sent, ${(d.failed_no_phone as string[]).length} not sent (no phone).`;
    case "cook_briefed":
      return `${d.cook_name}: ${(d.order_ids as string[]).length} extra meals${d.status === "sent" ? "" : " (no phone)"}.`;
    case "followed_up":
      return String(d.note);
    case "event_resolved":
      return `All ${d.orders} orders decided, all ${d.people} people told.`;
    default:
      return "";
  }
}

function Timeline({ log, model }: { log: LogEntry[]; model: DayModel }) {
  return (
    <Section title="3. What happened" aside={<Muted className="text-sm">Append-only log for this dropout</Muted>}>
      <Card>
        <ol className="space-y-3 text-sm">
          {log.map((l) => (
            <li key={l.id} className="grid grid-cols-[5.5rem_1fr] gap-3">
              <Muted>{fmtTime(scenarioTime(model, l.at))}</Muted>
              <div>
                <span className="font-medium">{ACTION_LABEL[l.action] ?? l.action}</span>{" "}
                <Muted>{summarize(l, model)}</Muted>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </Section>
  );
}
