import { logDropout } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Card, Muted, PageHeader, Quote, Stepper, inputClass } from "@/components/ui";
import { MEAL_WINDOWS, TODAY } from "@/lib/config";
import { fmtTime } from "@/lib/format";
import { loadDay } from "@/lib/ops-model";

const SHEET = { active: "active", on_leave: "on leave", inactive: "inactive" } as const;

export default async function NewDropoutPage(props: PageProps<"/dropouts/new">) {
  const sp = (await props.searchParams) as { cook?: string; msg?: string };
  const model = await loadDay(TODAY);

  const logged = new Set(model.events.map((e) => e.event.cook_id));
  const cooks = [...model.cooks.values()]
    .filter((c) => c.cook_id === c.canonical_cook_id && !logged.has(c.cook_id))
    .sort((a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name));
  const load = new Map(model.backups.map((b) => [b.cook_id, b.load]));
  const cities = [...new Set(cooks.map((c) => c.city))];

  const suspect = model.suspected.find((s) => s.cook.cook_id === sp.cook);
  const message = sp.msg ? model.messages.get(Number(sp.msg)) : suspect?.message ?? undefined;
  const preCook = cooks.find((c) => c.cook_id === sp.cook);
  const preMeals = suspect
    ? (["lunch", "dinner"] as const).filter((m) => suspect.openOrders[m] > 0)
    : (["lunch", "dinner"] as const);
  const preSource = message ? "whatsapp" : suspect?.sheet ? "sheet" : "call";
  const preNote = message?.body ?? (suspect?.sheet ? `Sheet: ${SHEET[suspect.cook.sheet_status]}` : "");

  return (
    <div className="max-w-3xl">
      <PageHeader title="Report a dropout" back={{ href: "/dropouts", label: "Cook dropouts" }} />
      <Stepper steps={["Report", "Plan backups"]} current={0} />

      <div className="grid gap-4 md:grid-cols-[1fr_260px]">
        <Card className="!p-5">
          <form action={logDropout} className="grid gap-5">
            {message && <input type="hidden" name="source_message_id" value={message.id} />}

            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Cook</span>
              <select name="cook_id" required defaultValue={preCook?.cook_id ?? ""} className={inputClass}>
                <option value="" disabled>Choose a cook…</option>
                {cities.map((city) => (
                  <optgroup key={city} label={city}>
                    {cooks.filter((c) => c.city === city).map((c) => (
                      <option key={c.cook_id} value={c.cook_id}>
                        {c.name} · {c.cuisine_specialty} · {load.get(c.cook_id) ?? 0} today
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            <fieldset className="grid gap-1.5 text-sm">
              <legend className="mb-1.5 font-medium">Meals they can&apos;t cook</legend>
              <div className="flex gap-5">
                {(["lunch", "dinner"] as const).map((m) => (
                  <label key={m} className="flex items-center gap-2 capitalize">
                    <input type="checkbox" name="meals" value={m} defaultChecked={preMeals.includes(m)} className="h-4 w-4" />
                    {m} <Muted className="text-xs">{MEAL_WINDOWS[m].start}</Muted>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">How did you hear?</span>
              <select name="source" defaultValue={preSource} className={inputClass}>
                <option value="call">Phone call</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="sheet">Sheet update</option>
                <option value="ops">Other</option>
              </select>
            </label>

            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Internal note</span>
              <textarea name="reason" rows={2} defaultValue={preNote} placeholder="e.g. called at 10:15, unwell" className={inputClass} />
              <Muted className="text-xs">Never shown to subscribers.</Muted>
            </label>

            <div>
              <SubmitButton pendingLabel="Saving…">Continue to plan backups</SubmitButton>
            </div>
          </form>
        </Card>

        {(message || suspect) && (
          <Card className="h-fit !p-4 text-sm">
            <div className="mb-2 font-medium">Why this was flagged</div>
            <div className="flex flex-wrap gap-1.5">
              {message && <Badge tone="blue">WhatsApp {fmtTime(message.sent_at)}</Badge>}
              {suspect && (suspect.sheet ? <Badge tone="amber">Sheet: {SHEET[suspect.cook.sheet_status]}</Badge> : <Badge tone="red">Sheet still active</Badge>)}
            </div>
            {message && (
              <div className="mt-3 space-y-1">
                <Muted className="text-xs">{message.sender}</Muted>
                <Quote>{message.body}</Quote>
              </div>
            )}
            {suspect && (
              <p className="mt-3 text-xs">
                <Muted>{suspect.openOrders.lunch + suspect.openOrders.dinner} open orders today</Muted>
              </p>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
