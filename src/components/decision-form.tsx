"use client";

import { useActionState } from "react";
import { type DecideState, decideOrders } from "@/app/actions";
import { SubmitButton } from "./submit-button";

// Change the decision for a single order. Uses the same action as bulk planning, so the same
// hard rules apply and the subscriber is messaged automatically.
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
  const [state, action] = useActionState<DecideState, FormData>(decideOrders, { message: null, errors: [] });
  return (
    <form action={action}>
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="order_ids" value={orderId} />
      <div className="flex flex-wrap gap-2">
        <select
          name="choice"
          defaultValue={current}
          aria-label="Decision"
          className="min-w-0 max-w-full flex-1 rounded-md border border-black/15 bg-white px-2.5 py-1.5 text-sm dark:border-white/20 dark:bg-neutral-900"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <SubmitButton pendingLabel="Saving…">Save and notify</SubmitButton>
      </div>
      {state.message && <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">{state.message}</p>}
      {state.errors.map((e) => (
        <p key={e.reason} role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{e.reason}</p>
      ))}
    </form>
  );
}
