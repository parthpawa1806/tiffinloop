import { Empty, MessageBubble } from "@/components/ui";
import { fmtTime, inr } from "@/lib/format";
import type { Cook, DayModel, LogEntry } from "@/lib/ops-model";
import { scenarioTime } from "@/lib/ops-model";

const LABEL: Record<string, string> = {
  event_created: "Dropout reported",
  orders_decided: "Orders decided",
  messages_sent: "Subscribers messaged",
  cook_briefed: "Backup cook briefed",
  followed_up: "Followed up without phone",
  event_resolved: "Dropout resolved",
  event_reopened: "Dropout reopened",
};

type Dec = { action: string; backup_cook_id: string | null; refund_amount?: number | null };

function describe(l: LogEntry, cooks: Map<string, Cook>, onlyOrder?: string): string {
  const d = l.detail as Record<string, unknown>;
  const cook = (id: string | null) => (id ? (cooks.get(id)?.name ?? id) : "");
  const fmt = (x: Dec) => (x.action === "refund" ? `refund${x.refund_amount ? ` ${inr(x.refund_amount)}` : ""}` : cook(x.backup_cook_id));
  switch (l.action) {
    case "event_created":
      return onlyOrder
        ? `${d.cook_name} reported out (${d.source})`
        : `${(d.affected_orders as string[]).length} orders, ${d.affected_people} people. Source: ${d.source}. Sheet said ${d.sheet_status}.`;
    case "orders_decided": {
      const ds = (d.decisions as { order_id: string; from: Dec | null; to: Dec }[]).filter((x) => !onlyOrder || x.order_id === onlyOrder);
      const how = d.choice === "suggested" ? "Suggestions applied" : "Ops choice";
      if (onlyOrder && ds[0]) return `${how}: ${ds[0].from ? `${fmt(ds[0].from)} → ` : ""}${fmt(ds[0].to)}`;
      const refunds = ds.filter((x) => x.to.action === "refund").length;
      const to = [...new Set(ds.flatMap((x) => (x.to.backup_cook_id ? [cook(x.to.backup_cook_id)] : [])))];
      const rejected = (d.rejected as unknown[]).length;
      return `${how}: ${ds.length} order${ds.length === 1 ? "" : "s"}${to.length ? ` → ${to.join(", ")}` : ""}${refunds ? `, ${refunds} refunded` : ""}${rejected ? `, ${rejected} rejected` : ""}`;
    }
    case "messages_sent":
      return onlyOrder
        ? "Message sent automatically"
        : `${(d.sent as string[]).length} sent automatically${(d.failed_no_phone as string[]).length ? `, ${(d.failed_no_phone as string[]).length} without phone` : ""}`;
    case "cook_briefed":
      return `${d.cook_name}: ${(d.order_ids as string[]).length} extra meals${d.status === "sent" ? "" : " (no phone)"}`;
    case "followed_up":
      return String(d.note);
    case "event_resolved":
      return `All ${d.orders} orders decided, all ${d.people} people told`;
    default:
      return "";
  }
}

// Does this log entry concern the given order?
export function mentionsOrder(l: LogEntry, orderId: string): boolean {
  return JSON.stringify(l.detail).includes(`"${orderId}"`);
}

export function Activity({ log, model, onlyOrder }: { log: LogEntry[]; model: DayModel; onlyOrder?: string }) {
  const entries = onlyOrder ? log.filter((l) => mentionsOrder(l, onlyOrder) || l.action === "event_created") : log;
  if (!entries.length) return <Empty>No activity yet.</Empty>;
  return (
    <ol className="relative ml-2 space-y-5 border-l border-black/10 pl-6 dark:border-white/10">
      {entries.map((l) => (
        <li key={l.id} className="relative">
          <span className="absolute -left-[29px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-black/30 dark:border-neutral-950 dark:bg-white/40" />
          <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
            <span className="font-medium">{LABEL[l.action] ?? l.action}</span>
            <span className="text-xs text-black/45 dark:text-white/45">{fmtTime(scenarioTime(model, l.at))}</span>
          </div>
          <div className="text-sm text-black/60 dark:text-white/60">{describe(l, model.cooks, onlyOrder)}</div>
          {l.action === "cook_briefed" && !onlyOrder && (
            <div className="mt-2 max-w-lg"><MessageBubble muted>{String(l.detail.body)}</MessageBubble></div>
          )}
        </li>
      ))}
    </ol>
  );
}
