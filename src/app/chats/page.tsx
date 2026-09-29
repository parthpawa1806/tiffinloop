import Form from "next/form";
import Link from "next/link";
import { ChatComposer } from "@/components/chat-composer";
import { Badge, Empty, Muted, PageHeader, inputClass } from "@/components/ui";
import { dietLabel } from "@/lib/allocate";
import { TODAY } from "@/lib/config";
import { fmtTime } from "@/lib/format";
import { type Notification, loadDay, scenarioTime } from "@/lib/ops-model";
import { listMessages } from "@/lib/queries";

export default async function ChatsPage(props: PageProps<"/chats">) {
  const { with: withId } = (await props.searchParams) as { with?: string };
  const [model, all] = await Promise.all([loadDay(TODAY), listMessages()]);

  // One conversation per person (duplicate accounts share a thread), newest first.
  const threads = new Map<string, Notification[]>();
  for (const m of all) threads.set(m.canonical_subscriber_id, [...(threads.get(m.canonical_subscriber_id) ?? []), m]);
  const list = [...threads.entries()].sort((a, b) => (b[1].at(-1)!.sent_at ?? "").localeCompare(a[1].at(-1)!.sent_at ?? ""));

  const requested = withId ? model.subscribers.get(withId.toUpperCase()) : undefined;
  const activeId = requested?.canonical_subscriber_id ?? list[0]?.[0];
  const person = activeId ? model.subscribers.get(activeId) : undefined;
  const thread = activeId ? (threads.get(activeId) ?? []) : [];

  return (
    <div>
      <PageHeader title="Chats" subtitle="Messages to subscribers. Dropout updates are sent automatically." />
      <div className="grid overflow-hidden rounded-xl border border-black/10 md:h-[calc(100vh-11rem)] md:grid-cols-[300px_1fr] dark:border-white/10">
        {/* Conversation list */}
        <div className="flex min-h-0 flex-col border-b border-black/10 md:border-b-0 md:border-r dark:border-white/10">
          <Form action="/chats" className="border-b border-black/10 p-3 dark:border-white/10">
            <input name="with" placeholder="Open chat: SUB0123" className={`${inputClass} w-full`} />
          </Form>
          <div className="max-h-72 overflow-y-auto md:max-h-none md:flex-1">
            {list.length === 0 && <p className="p-4 text-sm"><Muted>No conversations yet.</Muted></p>}
            {list.map(([id, msgs]) => {
              const p = model.subscribers.get(id)!;
              const last = msgs.at(-1)!;
              const on = id === activeId;
              return (
                <Link
                  key={id}
                  href={`/chats?with=${id}`}
                  scroll={false}
                  className={`block border-b border-black/[0.06] px-4 py-3 dark:border-white/[0.06] ${on ? "bg-black/[0.04] dark:bg-white/[0.06]" : "hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{p.name}</span>
                    <span className="shrink-0 text-xs text-black/45 dark:text-white/45">{fmtTime(scenarioTime(model, last.sent_at ?? new Date()))}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="truncate text-xs text-black/55 dark:text-white/55">{last.body.split("\n")[0]}</span>
                    {last.status === "failed_no_phone" && <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" title="Not delivered: no phone" />}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Thread */}
        {!person ? (
          <div className="p-6"><Empty>Pick a conversation, or open one by subscriber ID.</Empty></div>
        ) : (
          <div className="flex min-h-[420px] flex-col md:min-h-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/10 px-5 py-3 dark:border-white/10">
              <div>
                <div className="font-medium">{person.name}</div>
                <div className="text-xs text-black/50 dark:text-white/50">
                  {person.phone ?? "No phone on file"} · {person.city} · {dietLabel(person.diet)} {person.cuisine_pref}
                </div>
              </div>
              <Link href={`/orders?range=30d&q=${person.subscriber_id}`} className="text-sm text-black/55 hover:text-black dark:text-white/55 dark:hover:text-white">
                Orders →
              </Link>
            </div>
            {/* column-reverse keeps the newest message in view without client JS */}
            <div className="flex flex-1 flex-col-reverse overflow-y-auto">
            <div className="space-y-4 px-5 py-4">
              {thread.length === 0 && <p className="text-sm"><Muted>No messages yet.</Muted></p>}
              {thread.map((m) => (
                <div key={m.id} className="ml-auto max-w-[85%] md:max-w-[70%]">
                  <div className="whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-emerald-50 px-4 py-3 text-sm leading-relaxed dark:bg-emerald-500/10">
                    {m.body}
                  </div>
                  <div className="mt-1 flex items-center justify-end gap-2 text-xs text-black/45 dark:text-white/45">
                    {m.kind === "manual" ? "Ops" : "Automatic"} · {fmtTime(scenarioTime(model, m.sent_at ?? new Date()))}
                    {m.status === "sent" && <span>· Sent</span>}
                    {m.status === "failed_no_phone" && <Badge tone="red">Not delivered</Badge>}
                    {m.status === "followed_up" && <Badge tone="green">Followed up</Badge>}
                  </div>
                </div>
              ))}
            </div>
            </div>
            <ChatComposer subscriberId={person.subscriber_id} />
          </div>
        )}
      </div>
    </div>
  );
}
