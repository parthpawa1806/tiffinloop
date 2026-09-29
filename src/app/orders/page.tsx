import Link from "next/link";
import { FilterForm } from "@/components/filter-form";
import { Badge, Empty, Muted, PageHeader, inputClass, tableClasses as t } from "@/components/ui";
import { TODAY } from "@/lib/config";
import { fmtDate, inr } from "@/lib/format";
import type { City, Meal } from "@/lib/normalize";
import { loadDay } from "@/lib/ops-model";
import { type OrderFilters, PAGE_SIZE, listOrders } from "@/lib/queries";
import { NO_SHOW_NOTE, ORDER_STATUS, orderStatus } from "@/lib/status";

export default async function OrdersPage(props: PageProps<"/orders">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const model = await loadDay(TODAY);
  const f: OrderFilters = {
    range: sp.range === "30d" ? "30d" : sp.range === "7d" ? "7d" : "today",
    city: (sp.city || undefined) as City | undefined,
    meal: (sp.meal || undefined) as Meal | undefined,
    status: (sp.status || undefined) as OrderFilters["status"],
    cook: sp.cook || undefined,
    q: sp.q || undefined,
    page: Math.max(0, Number(sp.page) || 0),
  };
  const cookNames = new Map([...model.cooks.values()].map((c) => [c.cook_id, c.name]));
  const records = (canonical: string) => [...model.cooks.values()].filter((c) => c.canonical_cook_id === canonical).map((c) => c.cook_id);
  const { rows, total } = await listOrders(f, cookNames, records);
  const canonicalCooks = [...model.cooks.values()].filter((c) => c.cook_id === c.canonical_cook_id).sort((a, b) => a.name.localeCompare(b.name));

  const pageHref = (page: number) => {
    const p = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
    p.set("page", String(page));
    return `/orders?${p}`;
  };
  const from = f.page * PAGE_SIZE + 1;
  const to = Math.min(total, (f.page + 1) * PAGE_SIZE);

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle={`${total.toLocaleString("en-IN")} orders ${f.range === "today" ? "scheduled today" : f.range === "7d" ? "in the last 7 days" : "in the last 30 days"}`}
      />

      <FilterForm action="/orders">
        <select name="range" defaultValue={f.range} className={inputClass} aria-label="Date range">
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
        <select name="city" defaultValue={f.city ?? ""} className={inputClass} aria-label="City">
          <option value="">All cities</option>
          <option value="BLR">Bengaluru</option>
          <option value="MUM">Mumbai</option>
          <option value="PUNE">Pune</option>
        </select>
        <select name="meal" defaultValue={f.meal ?? ""} className={inputClass} aria-label="Meal">
          <option value="">All meals</option>
          <option value="lunch">Lunch</option>
          <option value="dinner">Dinner</option>
        </select>
        <select name="status" defaultValue={f.status ?? ""} className={inputClass} aria-label="Status">
          <option value="">All statuses</option>
          {Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select name="cook" defaultValue={f.cook ?? ""} className={`${inputClass} max-w-[200px]`} aria-label="Cook">
          <option value="">All cooks</option>
          {canonicalCooks.map((c) => <option key={c.cook_id} value={c.cook_id}>{c.name} ({c.city})</option>)}
        </select>
        <input name="q" defaultValue={f.q} placeholder="Search name, ORD…, SUB…" className={`${inputClass} w-56`} />
        {Object.values(sp).some(Boolean) && (
          <Link href="/orders" className="text-sm text-black/55 hover:text-black dark:text-white/55 dark:hover:text-white">Clear</Link>
        )}
      </FilterForm>

      {rows.length === 0 ? (
        <Empty>No orders match these filters.</Empty>
      ) : (
        <>
          <div className={t.wrap}>
            <table className={`${t.table} min-w-[720px]`}>
              <thead className={t.thead}>
                <tr>
                  <th className={t.th}>Order</th>
                  <th className={t.th}>Subscriber</th>
                  <th className={t.th}>Cook</th>
                  <th className={`${t.th} text-right`}>Amount</th>
                  <th className={t.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const s = orderStatus(r.status, r.resolution);
                  const backup = r.resolution?.backup_cook_id ? cookNames.get(r.resolution.backup_cook_id) : null;
                  return (
                    <tr key={r.order_id} className={t.trLink}>
                      <td className={t.td}>
                        <Link href={`/orders/${r.order_id}`} className="font-medium hover:underline">{r.order_id}</Link>
                        <div className="text-xs capitalize text-black/50 dark:text-white/50">{fmtDate(r.order_date)} · {r.meal}</div>
                      </td>
                      <td className={t.td}>
                        {r.subscriber_name}
                        <div className="text-xs text-black/50 dark:text-white/50">{r.subscriber_id} · {r.city}</div>
                      </td>
                      <td className={t.td}>
                        {backup ? (
                          <>
                            <span className="line-through decoration-black/30 dark:decoration-white/30"><Muted>{r.cook_name}</Muted></span> → {backup}
                          </>
                        ) : (
                          r.cook_name
                        )}
                      </td>
                      <td className={`${t.td} text-right tabular-nums`}>{inr(r.amount_inr)}</td>
                      <td className={t.td}><Badge tone={s.tone}>{s.label}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {f.status === "cook_dropout" && <p className="mt-3 text-xs"><Muted>{NO_SHOW_NOTE}</Muted></p>}
          <div className="mt-3 flex items-center justify-between text-sm">
            <Muted>{from}–{to} of {total.toLocaleString("en-IN")}</Muted>
            <div className="flex gap-2">
              {f.page > 0 && <Link href={pageHref(f.page - 1)} className="rounded-md border border-black/15 px-3 py-1 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10">Previous</Link>}
              {to < total && <Link href={pageHref(f.page + 1)} className="rounded-md border border-black/15 px-3 py-1 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10">Next</Link>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
