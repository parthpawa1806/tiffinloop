import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity } from "@/components/activity";
import { DecisionForm } from "@/components/decision-form";
import { Badge, Card, Empty, Fields, MessageBubble, Muted, PageHeader, Tabs } from "@/components/ui";
import { type BackupCook, dietLabel, rankBackups } from "@/lib/allocate";
import { TODAY } from "@/lib/config";
import { fmtDate, fmtTime, inr } from "@/lib/format";
import { mealWindow } from "@/lib/messages";
import { type AffectedRow, type EventView, loadDay, scenarioTime } from "@/lib/ops-model";
import { getOrder, messagesForOrder } from "@/lib/queries";
import { orderStatus } from "@/lib/status";

const PLAN = { lunch: "Lunch", dinner: "Dinner", both: "Lunch + dinner" } as const;

export default async function OrderPage(props: PageProps<"/orders/[id]">) {
  const { id } = await props.params;
  const { tab = "overview" } = (await props.searchParams) as { tab?: string };
  const [order, model] = await Promise.all([getOrder(id), loadDay(TODAY)]);
  if (!order) notFound();

  const subscriber = model.subscribers.get(order.subscriber_id)!;
  const person = model.subscribers.get(subscriber.canonical_subscriber_id)!;
  const cook = model.cooks.get(order.cook_id)!;
  const found = model.events
    .map((view) => ({ view, row: view.rows.find((r) => r.order.order_id === id) }))
    .find((x) => x.row) as { view: EventView; row: AffectedRow } | undefined;
  const row = found?.row;
  const decision = row?.resolution ?? row?.suggestion ?? null;
  const backup = decision?.backup_cook_id ? model.cooks.get(decision.backup_cook_id) : null;
  const status = orderStatus(order.status, row?.resolution ?? null);
  const messages = await messagesForOrder(id);
  const base = `/orders/${id}`;

  return (
    <div className="max-w-4xl">
      <PageHeader
        back={{ href: "/orders", label: "Orders" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {order.order_id} <Badge tone={status.tone}>{status.label}</Badge>
          </span>
        }
        subtitle={`${subscriber.name} · ${fmtDate(order.order_date)} · ${PLAN[order.meal]} ${mealWindow(order.meal)}`}
      />
      <Tabs
        active={tab}
        tabs={[
          { key: "overview", label: "Overview", href: `${base}?tab=overview` },
          { key: "messages", label: "Messages", href: `${base}?tab=messages`, count: messages.length },
          { key: "activity", label: "Activity", href: `${base}?tab=activity` },
        ]}
      />

      {tab === "messages" ? (
        messages.length ? (
          <div className="max-w-xl space-y-4">
            {messages.map((n) => (
              <div key={n.id}>
                <div className="mb-1 flex items-center gap-2 text-xs text-black/50 dark:text-white/50">
                  {fmtTime(scenarioTime(model, n.sent_at ?? new Date()))}
                  {n.status === "sent" && <Badge tone="green">Sent</Badge>}
                  {n.status === "failed_no_phone" && <Badge tone="red">No phone</Badge>}
                  {n.status === "followed_up" && <Badge tone="green">Followed up</Badge>}
                </div>
                <MessageBubble>{n.body}</MessageBubble>
              </div>
            ))}
          </div>
        ) : (
          <Empty>No messages about this order.</Empty>
        )
      ) : tab === "activity" ? (
        found ? (
          <Activity log={found.view.log} model={model} onlyOrder={id} />
        ) : (
          <Card>
            <Fields
              items={[
                { label: "Scheduled", value: `${fmtDate(order.order_date)}, ${order.meal}` },
                { label: "Order log status", value: <code className="text-xs">{order.raw_status}</code> },
              ]}
            />
            <p className="mt-4 text-sm"><Muted>No dropout activity for this order.</Muted></p>
          </Card>
        )
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <Card className="!p-5">
              <h2 className="mb-4 text-sm font-medium">Order</h2>
              <Fields
                items={[
                  { label: "Meal", value: `${PLAN[order.meal]}, ${fmtDate(order.order_date)}, ${mealWindow(order.meal)}` },
                  { label: "Amount", value: inr(order.amount_inr) },
                  { label: "Cook", value: <Link href={`/orders?cook=${cook.canonical_cook_id}`} className="hover:underline">{cook.name}</Link> },
                  { label: "Order log status", value: <code className="text-xs">{order.raw_status}</code> },
                ]}
              />
            </Card>
            <Card className="!p-5">
              <h2 className="mb-4 text-sm font-medium">Subscriber</h2>
              <Fields
                items={[
                  { label: "Name", value: <Link href={`/chats?with=${person.subscriber_id}`} className="hover:underline">{subscriber.name}</Link> },
                  { label: "Phone", value: subscriber.phone ?? person.phone ?? <Badge tone="red">No phone</Badge> },
                  { label: "Diet · cuisine", value: `${dietLabel(subscriber.diet)} · ${subscriber.cuisine_pref}` },
                  { label: "Plan", value: PLAN[subscriber.meal_plan] },
                  ...(person.subscriber_id !== subscriber.subscriber_id
                    ? [{ label: "Duplicate account", value: <Badge tone="amber">Same person as {person.subscriber_id}</Badge> }]
                    : []),
                ]}
              />
            </Card>
          </div>

          {found && (
            <Card className="h-fit !p-5">
              <h2 className="mb-1 text-sm font-medium">Dropout plan</h2>
              <p className="mb-4 text-xs">
                <Muted>
                  <Link href={`/dropouts/${found.view.event.id}`} className="hover:underline">{found.view.cook.name} can&apos;t cook today</Link>
                </Muted>
              </p>
              <div className="mb-1 text-sm font-medium">
                {!decision ? "Not decided" : decision.action === "refund" ? `Refund ${inr(decision.refund_amount ?? order.amount_inr)}` : `→ ${backup?.name}`}
                {decision && !row?.resolution && <span className="ml-2"><Badge tone="blue">suggested</Badge></span>}
              </div>
              {decision?.reason && <p className="mb-4 text-xs"><Muted>{decision.reason}</Muted></p>}
              <DecisionForm
                eventId={found.view.event.id}
                orderId={id}
                current={
                  row?.resolution
                    ? row.resolution.action === "refund"
                      ? "refund"
                      : `cook:${row.resolution.backup_cook_id}`
                    : "suggested"
                }
                options={decisionOptions(row!, found.view, model.backups)}
              />
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function decisionOptions(row: AffectedRow, view: EventView, backups: BackupCook[]) {
  const slots = new Map(backups.map((c) => [c.cook_id, c.free_slots]));
  const ranked = rankBackups(
    {
      order_id: row.order.order_id,
      event_id: view.event.id,
      meal: row.order.meal,
      amount_inr: row.order.amount_inr,
      city: row.subscriber.city,
      diet: row.subscriber.diet,
      cuisine_pref: row.subscriber.cuisine_pref,
      subscriber_id: row.subscriber.subscriber_id,
      canonical_subscriber_id: row.person.subscriber_id,
    },
    backups,
    slots,
  ).slice(0, 12);
  const current = row.resolution?.backup_cook_id;
  const opts = ranked.map((c) => ({ value: `cook:${c.cook_id}`, label: `${c.name} · ${c.cuisine_specialty} · ${c.free_slots} free` }));
  if (current && !ranked.some((c) => c.cook_id === current)) {
    const c = backups.find((b) => b.cook_id === current);
    opts.unshift({ value: `cook:${current}`, label: `${c?.name ?? current} (current)` });
  }
  if (!row.resolution) opts.unshift({ value: "suggested", label: "Use suggestion" });
  opts.push({ value: "refund", label: `Refund ${inr(row.order.amount_inr)}` });
  return opts;
}
