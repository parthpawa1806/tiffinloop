import Link from "next/link";
import { Badge, Card, Empty, Muted, PageHeader, Quote, Tabs, tableClasses as t } from "@/components/ui";
import { TODAY } from "@/lib/config";
import { fmtDate, fmtTime } from "@/lib/format";
import { type DayModel, loadDay } from "@/lib/ops-model";

const SHEET = { active: "active", on_leave: "on leave", inactive: "inactive" } as const;

export default async function DropoutsPage(props: PageProps<"/dropouts">) {
  const { tab = "needs" } = (await props.searchParams) as { tab?: string };
  const model = await loadDay(TODAY);

  return (
    <div>
      <PageHeader
        title="Cook dropouts"
        subtitle="Spot, report and cover cooks who can't cook today."
        actions={
          <Link href="/dropouts/new" className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-black/85 dark:bg-white dark:text-black">
            Report dropout
          </Link>
        }
      />
      <Tabs
        active={tab}
        tabs={[
          { key: "needs", label: "Needs action", href: "/dropouts?tab=needs", count: model.suspected.length },
          { key: "logged", label: "Logged today", href: "/dropouts?tab=logged", count: model.events.length },
          { key: "whatsapp", label: "WhatsApp feed", href: "/dropouts?tab=whatsapp", count: model.triaged.length },
        ]}
      />
      {tab === "logged" ? <Logged model={model} /> : tab === "whatsapp" ? <WhatsApp model={model} /> : <Needs model={model} />}
    </div>
  );
}

function Needs({ model }: { model: DayModel }) {
  if (!model.suspected.length) return <Empty>Nothing waiting. Every likely dropout has been reported.</Empty>;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {model.suspected.map((s) => {
        const href = `/dropouts/new?cook=${s.cook.cook_id}${s.message ? `&msg=${s.message.id}` : ""}`;
        return (
          <Card key={s.cook.cook_id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">{s.cook.name}</div>
                <Muted className="text-sm">
                  {s.cook.city} · {s.cook.cuisine_specialty} · {s.openOrders.lunch} lunch, {s.openOrders.dinner} dinner
                </Muted>
              </div>
              <Link href={href} className="shrink-0 rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-black/85 dark:bg-white dark:text-black">
                Report
              </Link>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {s.message && <Badge tone="blue">WhatsApp {fmtTime(s.message.sent_at)}</Badge>}
              {s.sheet ? (
                <Badge tone="amber">Sheet: {SHEET[s.cook.sheet_status]}{s.cook.status_since ? ` since ${fmtDate(s.cook.status_since)}` : ""}</Badge>
              ) : (
                <Badge tone="red">Sheet still says active</Badge>
              )}
            </div>
            {s.message && <div className="mt-3"><Quote>{s.message.body}</Quote></div>}
          </Card>
        );
      })}
    </div>
  );
}

function Logged({ model }: { model: DayModel }) {
  if (!model.events.length) return <Empty>No dropouts reported yet today.</Empty>;
  return (
    <div className={t.wrap}>
      <table className={t.table}>
        <thead className={t.thead}>
          <tr>
            <th className={t.th}>Cook</th>
            <th className={t.th}>Meals</th>
            <th className={t.th}>Orders covered</th>
            <th className={t.th}>People told</th>
            <th className={t.th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {model.events.map((v) => (
            <tr key={v.event.id} className={t.trLink}>
              <td className={t.td}>
                <Link href={`/dropouts/${v.event.id}`} className="font-medium hover:underline">{v.cook.name}</Link>
                <Muted className="ml-2 text-xs">{v.cook.city}</Muted>
              </td>
              <td className={`${t.td} capitalize`}>{v.event.meals.join(", ")}</td>
              <td className={t.td}>{v.decided}/{v.rows.length}</td>
              <td className={t.td}>
                {v.peopleReached}/{v.people}
                {v.peopleNeedFollowUp > 0 && <span className="ml-2"><Badge tone="amber">{v.peopleNeedFollowUp} follow-up</Badge></span>}
              </td>
              <td className={t.td}>{v.complete ? <Badge tone="green">Resolved</Badge> : <Badge tone="red">Open</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SIGNAL = {
  dropout: { tone: "red", label: "Dropout" },
  delay: { tone: "amber", label: "Delay" },
  ok: { tone: "green", label: "On track" },
  other: { tone: "neutral", label: "No action" },
} as const;

function WhatsApp({ model }: { model: DayModel }) {
  return (
    <div className={t.wrap}>
      <table className={t.table}>
        <thead className={t.thead}>
          <tr>
            <th className={t.th}>Time</th>
            <th className={t.th}>Message</th>
            <th className={t.th}>Read as</th>
            <th className={t.th}>Cook</th>
          </tr>
        </thead>
        <tbody>
          {model.triaged.map((m) => {
            const s = SIGNAL[m.signal];
            return (
              <tr key={m.id} className={t.tr}>
                <td className={`${t.td} whitespace-nowrap align-top`}><Muted>{fmtTime(m.sent_at)}</Muted></td>
                <td className={`${t.td} align-top`}>
                  <span className="font-medium">{m.sender}</span>
                  <div className="text-black/70 dark:text-white/70">{m.body}</div>
                </td>
                <td className={`${t.td} whitespace-nowrap align-top`}>
                  <Badge tone={s.tone}>{s.label}{m.appliesTo === "tomorrow" ? " · tomorrow" : ""}</Badge>
                </td>
                <td className={`${t.td} whitespace-nowrap align-top`}>
                  <Muted>{m.cookId ? model.cooks.get(m.cookId)?.name : "—"}</Muted>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
