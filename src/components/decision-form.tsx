"use client";

import { useActionState } from "react";
import { type DecideState, decideOrder } from "@/app/actions";
import { SubmitButton } from "./submit-button";

export function DecisionForm({
  eventId,
  orderId,
  current,
  options,
}: {
  eventId: string;
  orderId: string;
  current: string;
  options: { value: string; label: string }[];
}) {
  const [state, action] = useActionState<DecideState, FormData>(decideOrder, { error: null });
  return (
    <form action={action}>
      <div className="flex gap-1.5">
        <input type="hidden" name="event_id" value={eventId} />
        <input type="hidden" name="order_id" value={orderId} />
        <select
          name="choice"
          defaultValue={current}
          aria-label={`Decision for ${orderId}`}
          className="max-w-[240px] rounded-md border border-black/15 bg-white px-1.5 py-1 text-xs dark:border-white/20 dark:bg-neutral-900"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <SubmitButton variant="secondary" pendingLabel="…" className="!px-2 !py-1 text-xs">Save</SubmitButton>
      </div>
      {state.error && <p role="alert" className="mt-1 max-w-[280px] text-xs text-red-700 dark:text-red-300">{state.error}</p>}
    </form>
  );
}
