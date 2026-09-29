import Link from "next/link";
import { logDropout, resetDemo } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Card, Muted, Quote, Section } from "@/components/ui";
import { MEAL_WINDOWS, TODAY, mealDeadline } from "@/lib/config";
import { fmtDate, fmtDuration, fmtTime } from "@/lib/format";
import { type DayModel, loadDay, scenarioTime } from "@/lib/ops-model";

export const dynamic = "force-dynamic";

const SHEET_LABEL = { active: "active", on_leave: "on leave", inactive: "inactive" } as const;

export default async function OpsHome() {
  const model = await loadDay(TODAY);
  const now = scenarioTime(model, new Date());

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Cook dropouts today</h1>
          <p className="mt-1 text-sm">
            <Muted>Log a dropout, pick backups or refunds, and message every affected subscriber before their meal.</Muted>
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          {(["lunch", "dinner"] as const).map((meal) => {
            const left = mealDeadline(TODAY, meal).getTime() - now.getTime();
            return (
              <Card key={meal} className="!px-3 !py-2">
                <div className="font-medium">{meal === "lunch" ? "Lunch" : "Dinner"} goes out {fmtTime(mealDeadline(TODAY, meal))}</div>
                <Muted>{left > 0 ? `${fmtDuration(left)} left` : `started ${fmtDuration(left)} ago`}</Muted>
              </Card>
            );
          })}
        </div>
      </div>

      <SuspectedList model={model} />
      <EventsTable model={model} />
      <ReportForm model={model} />
      <Triage model={model} />

      <Section title="Demo controls">
        <Card>
          <form action={resetDemo} className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <Muted>
                Clears every dropout event, decision and message so the scenario starts fresh at 10:30 AM. The seed data is not
                touched.
              </Muted>
            </p>
            <SubmitButton variant="danger" pendingLabel="Resetting…">Reset demo</SubmitButton>
          </form>
        </Card>
      </Section>
    </div>
  );
}

function SuspectedList({ model }: { model: DayModel }) {
  return (
    <Section
      title={
        <>
          Needs action <Badge tone={model.suspected.length ? "red" : "green"}>{model.suspected.length}</Badge>
        </>
      }
      aside={<Muted className="text-sm">Likely dropouts from the sheet and the ops WhatsApp group that nobody has logged yet</Muted>}
    >
      {model.suspected.length === 0 ? (
        <Card><Muted>Nothing waiting. Every suspected dropout has been logged.</Muted></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {model.suspected.map((s) => {
            const total = s.openOrders.lunch + s.openOrders.dinner;
            const meals = (["lunch", "dinner"] as const).filter((m) => s.openOrders[m] > 0);
            return (
              <Card key={s.cook.cook_id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="font-semibold">
                    {s.cook.name} <Muted className="text-sm font-normal">{s.cook.cook_id}</Muted>
                  </div>
                  <Muted className="text-sm">{s.cook.city} · {s.cook.cuisine_specialty}</Muted>
                </div>
                <div className="mt-1 text-sm">
                  <b>{total}</b> open orders today: {s.openOrders.lunch} lunch, {s.openOrders.dinner} dinner
                </div>
                <ul className="mt-3 space-y-2 text-sm">
                  {s.message && (
                    <li>
                      <div className="mb-1">
                        <Badge tone="blue">WhatsApp</Badge>{" "}
                        <Muted>{fmtTime(s.message.sent_at)}, {s.message.sender}</Muted>
                      </div>
                      <Quote>{s.message.body}</Quote>
                    </li>
                  )}
                  <li>
                    <Badge tone={s.sheet ? "amber" : "red"}>Sheet</Badge>{" "}
                    {s.sheet ? (
                      <Muted>
                        {SHEET_LABEL[s.cook.sheet_status]}
                        {s.cook.status_since ? ` since ${fmtDate(s.cook.status_since)}` : ""}
                      </Muted>
                    ) : (
                      <span className="text-red-700 dark:text-red-300">still says active: the sheet hasn&apos;t been updated</span>
                    )}
                  </li>
                </ul>
                <form action={logDropout} className="mt-4 flex items-center gap-3">
                  <input type="hidden" name="cook_id" value={s.cook.cook_id} />
                  {(meals.length ? meals : (["lunch", "dinner"] as const)).map((m) => (
                    <input key={m} type="hidden" name="meals" value={m} />
                  ))}
                  <input type="hidden" name="source" value={s.message ? "whatsapp" : "sheet"} />
                  <input type="hidden" name="reason" value={s.message?.body ?? `Sheet: ${SHEET_LABEL[s.cook.sheet_status]}`} />
                  {s.message && <input type="hidden" name="source_message_id" value={s.message.id} />}
                  <SubmitButton pendingLabel="Logging…">Log dropout and plan backups</SubmitButton>
                </form>
              </Card>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function EventsTable({ model }: { model: DayModel }) {
  return (
    <Section title="Logged dropouts">
      {model.events.length === 0 ? (
        <Card><Muted>No dropouts logged yet today.</Muted></Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/15">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-black/[0.03] text-left dark:bg-white/5">
              <tr>
                <th className="px-3 py-2 font-medium">Cook</th>
                <th className="px-3 py-2 font-medium">Meals out</th>
                <th className="px-3 py-2 font-medium">Orders decided</th>
                <th className="px-3 py-2 font-medium">People told</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {model.events.map((v) => (
                <tr key={v.event.id} className="border-t border-black/10 dark:border-white/10">
                  <td className="px-3 py-2">
                    <Link href={`/events/${v.event.id}`} className="font-medium underline-offset-2 hover:underline">
                      {v.cook.name}
                    </Link>{" "}
                    <Muted>{v.cook.city}</Muted>
                  </td>
                  <td className="px-3 py-2 capitalize">{v.event.meals.join(", ")}</td>
                  <td className="px-3 py-2">{v.decided}/{v.rows.length}</td>
                  <td className="px-3 py-2">
                    {v.peopleReached}/{v.people}
                    {v.peopleNeedFollowUp > 0 && <> <Badge tone="amber">{v.peopleNeedFollowUp} need follow-up</Badge></>}
                  </td>
                  <td className="px-3 py-2">
                    {v.complete ? <Badge tone="green">Resolved</Badge> : <Badge tone="red">Open</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function ReportForm({ model }: { model: DayModel }) {
  const logged = new Set(model.events.map((e) => e.event.cook_id));
  const cooks = [...model.cooks.values()]
    .filter((c) => c.cook_id === c.canonical_cook_id && !logged.has(c.cook_id))
    .sort((a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name));
  const openOrders = new Map(model.backups.map((b) => [b.cook_id, b.load]));
  const cities = [...new Set(cooks.map((c) => c.city))];

  return (
    <Section title="Report a dropout" aside={<Muted className="text-sm">For a call or message not in the list above</Muted>}>
      <Card>
        <form action={logDropout} className="grid gap-4 md:grid-cols-[2fr_1fr_1fr] md:items-end">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Cook</span>
            <select name="cook_id" required defaultValue="" className="rounded-md border border-black/15 bg-white px-2 py-1.5 dark:border-white/20 dark:bg-neutral-900">
              <option value="" disabled>Choose a cook…</option>
              {cities.map((city) => (
                <optgroup key={city} label={city}>
                  {cooks.filter((c) => c.city === city).map((c) => (
                    <option key={c.cook_id} value={c.cook_id}>
                      {c.name} · {c.cuisine_specialty} · {openOrders.get(c.cook_id) ?? 0} order{openOrders.get(c.cook_id) === 1 ? "" : "s"} today
                      {c.sheet_status !== "active" ? ` (sheet: ${SHEET_LABEL[c.sheet_status]})` : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <fieldset className="grid gap-1 text-sm">
            <legend className="mb-1 font-medium">Meals affected</legend>
            <div className="flex gap-4">
              {(["lunch", "dinner"] as const).map((m) => (
                <label key={m} className="flex items-center gap-1.5 capitalize">
                  <input type="checkbox" name="meals" value={m} defaultChecked /> {m}
                  <Muted className="text-xs">({MEAL_WINDOWS[m].start})</Muted>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Heard via</span>
            <select name="source" defaultValue="call" className="rounded-md border border-black/15 bg-white px-2 py-1.5 dark:border-white/20 dark:bg-neutral-900">
              <option value="call">Phone call</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="ops">Other</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm md:col-span-2">
            <span className="font-medium">Note <Muted className="font-normal">(internal, never sent to subscribers)</Muted></span>
            <input name="reason" placeholder="e.g. called at 10:15, unwell" className="rounded-md border border-black/15 bg-white px-2 py-1.5 dark:border-white/20 dark:bg-neutral-900" />
          </label>
          <div>
            <SubmitButton pendingLabel="Logging…">Log dropout</SubmitButton>
          </div>
        </form>
      </Card>
    </Section>
  );
}

const SIGNAL = {
  dropout: { tone: "red", label: "Dropout" },
  delay: { tone: "amber", label: "Delay" },
  ok: { tone: "green", label: "On track" },
  other: { tone: "neutral", label: "No action" },
} as const;

function Triage({ model }: { model: DayModel }) {
  return (
    <Section title="This morning's ops WhatsApp, read for you" aside={<Muted className="text-sm">How each message was classified</Muted>}>
      <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/15">
        <table className="w-full min-w-[640px] text-sm">
          <tbody>
            {model.triaged.map((m) => {
              const cook = m.cookId ? model.cooks.get(m.cookId) : null;
              const s = SIGNAL[m.signal];
              return (
                <tr key={m.id} className="border-t border-black/10 first:border-t-0 dark:border-white/10">
                  <td className="whitespace-nowrap px-3 py-2 align-top"><Muted>{fmtTime(m.sent_at)}</Muted></td>
                  <td className="px-3 py-2 align-top">
                    <span className="font-medium">{m.sender}:</span> {m.body}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 align-top">
                    <Badge tone={s.tone}>{s.label}{m.appliesTo === "tomorrow" ? " (tomorrow)" : ""}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 align-top"><Muted>{cook ? cook.name : ""}</Muted></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
