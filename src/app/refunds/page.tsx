import Link from "next/link";
import { Badge, Empty, Muted, PageHeader, Stat, tableClasses as t } from "@/components/ui";
import { TODAY } from "@/lib/config";
import { fmtTime, inr } from "@/lib/format";
import { loadDay, scenarioTime } from "@/lib/ops-model";
import { listRefunds } from "@/lib/queries";

function why(reason: string | null): { label: string; tone: "amber" | "neutral" | "red" } {
  if (reason?.startsWith("Duplicate booking")) return { label: "Duplicate booking", tone: "amber" };
  if (reason?.startsWith("Refund chosen by ops")) return { label: "Ops choice", tone: "neutral" };
  return { label: "No backup available", tone: "red" };
}

export default async function RefundsPage() {
  const [model, refunds] = await Promise.all([loadDay(TODAY), listRefunds()]);
  const total = refunds.reduce((s, r) => s + r.amount, 0);

  return (
    <div>
      <PageHeader title="Refunds" subtitle="Refunds issued for orders hit by a cook dropout." />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:max-w-md">
        <Stat label="refunded today" value={inr(total)} />
        <Stat label="orders" value={refunds.length} />
      </div>
      {refunds.length === 0 ? (
        <Empty>No refunds yet. Orders refunded while planning backups will show up here.</Empty>
      ) : (
        <div className={t.wrap}>
          <table className={`${t.table} min-w-[720px]`}>
            <thead className={t.thead}>
              <tr>
                <th className={t.th}>Order</th>
                <th className={t.th}>Subscriber</th>
                <th className={t.th}>Why</th>
                <th className={t.th}>Dropout</th>
                <th className={`${t.th} text-right`}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {refunds.map((r) => {
                const w = why(r.reason);
                return (
                  <tr key={r.order_id} className={t.tr}>
                    <td className={t.td}>
                      <Link href={`/orders/${r.order_id}`} className="font-medium hover:underline">{r.order_id}</Link>
                      <div className="text-xs capitalize text-black/50 dark:text-white/50">{r.meal} · {fmtTime(scenarioTime(model, r.decided_at))}</div>
                    </td>
                    <td className={t.td}>
                      {r.subscriber_name}
                      <div className="text-xs text-black/50 dark:text-white/50">{r.subscriber_id} · {r.city}</div>
                    </td>
                    <td className={t.td}>
                      <Badge tone={w.tone}>{w.label}</Badge>
                      <div className="mt-1 text-xs"><Muted>{r.was_suggested ? "Suggested" : "Chosen by ops"}</Muted></div>
                    </td>
                    <td className={t.td}>
                      <Link href={`/dropouts/${r.event_id}`} className="hover:underline">{model.cooks.get(r.dropped_cook_id)?.name}</Link>
                    </td>
                    <td className={`${t.td} text-right tabular-nums`}>{inr(r.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
