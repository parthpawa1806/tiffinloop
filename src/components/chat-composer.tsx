"use client";

import { useActionState, useRef } from "react";
import { type ChatState, sendChatMessage } from "@/app/actions";
import { SubmitButton } from "./submit-button";

export function ChatComposer({ subscriberId }: { subscriberId: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, action] = useActionState<ChatState, FormData>(async (prev, form) => {
    const res = await sendChatMessage(prev, form);
    if (!res.error) ref.current?.reset();
    return res;
  }, { error: null });

  return (
    <form ref={ref} action={action} className="border-t border-black/10 p-3 dark:border-white/10">
      <input type="hidden" name="subscriber_id" value={subscriberId} />
      <div className="flex gap-2">
        <input
          name="body"
          autoComplete="off"
          placeholder="Write a message (simulated WhatsApp)"
          className="min-w-0 flex-1 rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-neutral-900"
        />
        <SubmitButton pendingLabel="Sending…">Send</SubmitButton>
      </div>
      {state.error && <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-300">{state.error}</p>}
    </form>
  );
}
