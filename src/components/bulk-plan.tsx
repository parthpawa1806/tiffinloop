"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { type DecideState, decideOrders } from "@/app/actions";
import { SubmitButton } from "./submit-button";

export interface PlanRow {
  orderId: string;
  meal: "lunch" | "dinner";
  by: string;
  subscriberName: string;
  subscriberId: string;
  needs: string; // "Veg · South Indian"
  flags: string[];
  decision: {
    state: "suggested" | "decided";
    label: string;
    isRefund: boolean;
    sameCuisine: boolean;
    reason: string;
  } | null;
  message: "sent" | "no_phone" | "followed_up" | "needs_update" | null;
}

export interface BackupOption {
  value: string;
  label: string;
}

const MESSAGE: Record<NonNullable<PlanRow["message"]>, { label: string; cls: string }> = {
  sent: { label: "Sent", cls: "text-emerald-700 dark:text-emerald-300" },
  followed_up: { label: "Followed up", cls: "text-emerald-700 dark:text-emerald-300" },
  no_phone: { label: "No phone", cls: "text-red-700 dark:text-red-300" },
  needs_update: { label: "Update due", cls: "text-amber-700 dark:text-amber-300" },
};

export function BulkPlan({ eventId, rows, backups }: { eventId: string; rows: PlanRow[]; backups: BackupOption[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cook, setCook] = useState(backups[0]?.value ?? "");
  const [state, action] = useActionState<DecideState, FormData>(async (prev, form) => {
    const res = await decideOrders(prev, form);
    if (res.message) setSelected(new Set()); // clear the selection after a successful save
    return res;
  }, { message: null, errors: [] });

  const suggestedIds = rows.filter((r) => r.decision?.state === "suggested").map((r) => r.orderId);
  const allOn = selected.size === rows.length && rows.length > 0;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const btn = "rounded-md px-3 py-1.5 text-sm font-medium";

  return (
    <div>
      {/* Action bar */}
      <form action={action} className="sticky top-14 z-10 mb-3 flex min-h-12 flex-wrap items-center gap-2 rounded-xl border border-black/10 bg-white/95 px-3 py-2 backdrop-blur md:top-2 dark:border-white/10 dark:bg-neutral-950/95">
        <input type="hidden" name="event_id" value={eventId} />
        {selected.size === 0 ? (
          <>
            {suggestedIds.map((id) => <input key={id} type="hidden" name="order_ids" value={id} />)}
            <input type="hidden" name="choice" value="suggested" />
            <span className="text-sm text-black/55 dark:text-white/55">
              {suggestedIds.length ? "Select orders to act on them, or" : "All orders have a decision. Select any to change it."}
            </span>
            {suggestedIds.length > 0 && (
              <SubmitButton pendingLabel="Saving…" className="!py-1">
                Apply all {suggestedIds.length} suggestions
              </SubmitButton>
            )}
          </>
        ) : (
          <>
            {[...selected].map((id) => <input key={id} type="hidden" name="order_ids" value={id} />)}
            <span className="mr-1 text-sm font-medium">{selected.size} selected</span>
            <button type="submit" name="choice" value="suggested" className={`${btn} bg-black text-white hover:bg-black/85 dark:bg-white dark:text-black`}>
              Apply suggestions
            </button>
            <span className="mx-1 h-5 w-px bg-black/10 dark:bg-white/15" />
            <select value={cook} onChange={(e) => setCook(e.target.value)} aria-label="Backup cook" className="max-w-[260px] rounded-md border border-black/15 bg-white px-2 py-1.5 text-sm dark:border-white/20 dark:bg-neutral-900">
              {backups.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
            <button type="submit" name="choice" value={cook} className={`${btn} border border-black/15 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10`}>
              Assign
            </button>
            <span className="mx-1 h-5 w-px bg-black/10 dark:bg-white/15" />
            <button type="submit" name="choice" value="refund" className={`${btn} border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10`}>
              Refund
            </button>
            <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-sm text-black/55 hover:text-black dark:text-white/55 dark:hover:text-white">
              Clear
            </button>
          </>
        )}
      </form>

      {(state.message || state.errors.length > 0) && (
        <div className="mb-3 space-y-1 text-sm" role="status">
          {state.message && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">{state.message}. Messages go out automatically.</div>}
          {state.errors.map((e) => (
            <div key={e.order_id + e.reason} className="rounded-lg bg-red-50 px-3 py-2 text-red-800 dark:bg-red-500/10 dark:text-red-200">
              {e.order_id ? `${e.order_id}: ` : ""}{e.reason}
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-black/[0.02] text-left text-xs text-black/55 dark:bg-white/[0.03] dark:text-white/55">
            <tr>
              <th className="w-10 px-4 py-2.5">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allOn}
                  onChange={() => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.orderId)))}
                  className="h-4 w-4"
                />
              </th>
              <th className="px-4 py-2.5 font-medium">Order</th>
              <th className="px-4 py-2.5 font-medium">Subscriber</th>
              <th className="px-4 py-2.5 font-medium">Plan</th>
              <th className="px-4 py-2.5 font-medium">Message</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const on = selected.has(r.orderId);
              return (
                <tr key={r.orderId} className={`border-t border-black/[0.06] dark:border-white/[0.06] ${on ? "bg-sky-50/60 dark:bg-sky-500/5" : ""}`}>
                  <td className="px-4 py-3 align-top">
                    <input type="checkbox" aria-label={`Select ${r.orderId}`} checked={on} onChange={() => toggle(r.orderId)} className="h-4 w-4" />
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="font-medium capitalize">{r.meal}</div>
                    <Link href={`/orders/${r.orderId}`} className="text-xs text-black/50 hover:underline dark:text-white/50">
                      {r.orderId} · by {r.by}
                    </Link>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div>{r.subscriberName}</div>
                    <div className="text-xs text-black/50 dark:text-white/50">{r.needs}</div>
                    {r.flags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {r.flags.map((f) => (
                          <span key={f} className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/30">{f}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top" title={r.decision?.reason}>
                    {!r.decision ? (
                      <span className="text-black/40 dark:text-white/40">—</span>
                    ) : (
                      <div className={r.decision.state === "suggested" ? "text-black/55 dark:text-white/55" : ""}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={r.decision.state === "decided" ? "font-medium" : ""}>
                            {r.decision.isRefund ? r.decision.label : `→ ${r.decision.label}`}
                          </span>
                          {!r.decision.isRefund && !r.decision.sameCuisine && (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">other cuisine</span>
                          )}
                          {r.decision.state === "suggested" && (
                            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700 dark:bg-sky-500/15 dark:text-sky-200">suggested</span>
                          )}
                        </div>
                        <div className="mt-0.5 max-w-[320px] truncate text-xs text-black/45 dark:text-white/45">{r.decision.reason}</div>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {r.message ? <span className={`text-xs font-medium ${MESSAGE[r.message].cls}`}>{MESSAGE[r.message].label}</span> : <span className="text-xs text-black/40 dark:text-white/40">Not yet</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
