import Link from "next/link";
import { FilterForm } from "@/components/filter-form";
import { Badge, Empty, Muted, PageHeader, inputClass, tableClasses as t } from "@/components/ui";
import { isUnreliable } from "@/lib/allocate";
import { TODAY } from "@/lib/config";
import { CUISINES } from "@/lib/normalize";
import { type Backup, loadDay } from "@/lib/ops-model";

function status(c: Backup): { key: string; label: string; tone: "green" | "amber" | "red" | "neutral" } {
  if (c.has_dropout_event) return { key: "out", label: "Out today", tone: "red" };
  if (c.sheet_status === "on_leave") return { key: "on_leave", label: "On leave", tone: "amber" };
  if (c.sheet_status === "inactive") return { key: "inactive", label: "Inactive", tone: "neutral" };
  return { key: "available", label: "Available", tone: "green" };
}

export default async function CooksPage(props: PageProps<"/cooks">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const model = await loadDay(TODAY);
  const records = new Map<string, number>();
  for (const c of model.cooks.values()) records.set(c.canonical_cook_id, (records.get(c.canonical_cook_id) ?? 0) + 1);

  const q = sp.q?.trim().toLowerCase();
  const cooks = model.backups
    .filter((c) => !sp.city || c.city === sp.city)
    .filter((c) => !sp.cuisine || c.cuisine_specialty === sp.cuisine)
    .filter((c) => !sp.status || status(c).key === sp.status)
    .filter((c) => !sp.diet || (sp.diet === "jain" ? c.serves_jain : sp.diet === "non_veg" ? c.serves_non_veg : c.serves_veg))
    .filter((c) => !sp.reliability || (sp.reliability === "unreliable" ? isUnreliable(c) : !isUnreliable(c)))
    .filter((c) => !q || c.name.toLowerCase().includes(q) || c.cook_id.toLowerCase().includes(q))
    .sort((a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name));

  return (
    <div>
      <PageHeader title="Cooks" subtitle={`${cooks.length} of ${model.backups.length} cooks · duplicate sheet records merged`} />

      <FilterForm action="/cooks">
        <select name="city" defaultValue={sp.city ?? ""} className={inputClass} aria-label="City">
          <option value="">All cities</option>
          <option value="BLR">Bengaluru</option>
          <option value="MUM">Mumbai</option>
          <option value="PUNE">Pune</option>
        </select>
        <select name="cuisine" defaultValue={sp.cuisine ?? ""} className={inputClass} aria-label="Cuisine">
          <option value="">All cuisines</option>
          {CUISINES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select name="status" defaultValue={sp.status ?? ""} className={inputClass} aria-label="Status">
          <option value="">Any status</option>
          <option value="available">Available</option>
          <option value="out">Out today</option>
          <option value="on_leave">On leave</option>
          <option value="inactive">Inactive</option>
        </select>
        <select name="diet" defaultValue={sp.diet ?? ""} className={inputClass} aria-label="Cooks diet">
          <option value="">Any diet</option>
          <option value="veg">Cooks Veg</option>
          <option value="jain">Cooks Jain</option>
          <option value="non_veg">Cooks Non-Veg</option>
        </select>
        <select name="reliability" defaultValue={sp.reliability ?? ""} className={inputClass} aria-label="Reliability">
          <option value="">Any reliability</option>
          <option value="unreliable">Often drops out</option>
          <option value="reliable">Reliable</option>
        </select>
        <input name="q" defaultValue={sp.q} placeholder="Search name or CK…" className={`${inputClass} w-48`} />
        {Object.values(sp).some(Boolean) && (
          <Link href="/cooks" className="text-sm text-black/55 hover:text-black dark:text-white/55 dark:hover:text-white">Clear</Link>
        )}
      </FilterForm>

      {cooks.length === 0 ? (
        <Empty>No cooks match these filters.</Empty>
      ) : (
        <div className={t.wrap}>
          <table className={`${t.table} min-w-[760px]`}>
            <thead className={t.thead}>
              <tr>
                <th className={t.th}>Cook</th>
                <th className={t.th}>Cuisine</th>
                <th className={t.th}>Cooks</th>
                <th className={t.th}>Today</th>
                <th className={t.th}>Dropouts, 30 days</th>
                <th className={t.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {cooks.map((c) => {
                const s = status(c);
                const pct = c.orders_30d ? Math.round((c.dropouts_30d / c.orders_30d) * 100) : 0;
                const fill = Math.min(100, Math.round((c.load / c.max_daily_orders) * 100));
                return (
                  <tr key={c.cook_id} className={t.trLink}>
                    <td className={t.td}>
                      <Link href={`/orders?cook=${c.cook_id}`} className="font-medium hover:underline">{c.name}</Link>
                      <div className="text-xs text-black/50 dark:text-white/50">
                        {c.cook_id} · {c.city}
                        {(records.get(c.cook_id) ?? 1) > 1 && ` · ${records.get(c.cook_id)} sheet records`}
                        {!c.phone && " · no phone"}
                      </div>
                    </td>
                    <td className={t.td}>{c.cuisine_specialty}</td>
                    <td className={t.td}>
                      <Muted>{[c.serves_veg && "Veg", c.serves_non_veg && "Non-Veg", c.serves_jain && "Jain"].filter(Boolean).join(", ")}</Muted>
                    </td>
                    <td className={t.td}>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                          <div className={`h-full ${fill >= 100 ? "bg-red-500" : "bg-black/60 dark:bg-white/60"}`} style={{ width: `${fill}%` }} />
                        </div>
                        <span className="text-xs tabular-nums">{c.load}/{c.max_daily_orders}</span>
                      </div>
                    </td>
                    <td className={t.td}>
                      {c.dropouts_30d === 0 ? (
                        <Muted>None</Muted>
                      ) : (
                        <span className="flex items-center gap-2">
                          <span className="tabular-nums">{c.dropouts_30d} orders · {pct}%</span>
                          {isUnreliable(c) && <Badge tone="red">Often drops out</Badge>}
                        </span>
                      )}
                    </td>
                    <td className={t.td}><Badge tone={s.tone}>{s.label}</Badge></td>
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
