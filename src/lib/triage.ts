// Reads the ops WhatsApp group and flags cooks who may have dropped out.
//
// The sheet is updated by hand and lags reality (Sunita Kulkarni messaged at 7:41 AM that she
// can't cook, but the sheet still says "active"). This turns each message into a signal ops can
// act on. Rule-based on purpose: every flag can be traced to a matched phrase, and a missed
// phrase is a one-line fix. Unseen phrasing is the known gap (see PRD: LLM classifier).

import { TIMEZONE } from "./config";

export type Signal = "dropout" | "delay" | "ok" | "other";
export type AppliesTo = "today" | "tomorrow" | "unspecified";

export interface MessageInput {
  id: number;
  sent_at: string;
  sender: string;
  sender_is_ops: boolean;
  sender_cook_id: string | null;
  body: string;
}

export interface CookRef {
  cook_id: string; // canonical
  name: string;
}

export interface TriagedMessage extends MessageInput {
  signal: Signal;
  matched: string | null; // phrase that triggered the signal
  appliesTo: AppliesTo;
  cookId: string | null;
  cookMatchedBy: "sender" | "full_name" | "first_name" | null;
}

// English + Hinglish phrases seen in cook/ops chats.
const DROPOUT = /not cooking|(?:can'?t|cannot|won'?t be able to|unable to) (?:cook|make it|come)|\b(?:also )?out today\b|not coming|nahi ho payega|nahi (?:ho|aa|bana) (?:payega|paungi|paunga|sakti|sakta)|aaj nahi|\bchutti\b|on leave|\bsick\b|\bfever\b|unwell|emergency|hospital/i;
const DELAY = /\blate\b|\bdelay/i;
const OK = /on track|all good|all set|\bready\b/i;
const TOMORROW = /\btomorrow\b|\bkal\b/i;
const TODAY = /\btoday\b|\baaj\b/i;

export function classify(body: string): { signal: Signal; matched: string | null; appliesTo: AppliesTo } {
  const appliesTo: AppliesTo = TOMORROW.test(body) ? "tomorrow" : TODAY.test(body) ? "today" : "unspecified";
  for (const [signal, re] of [["dropout", DROPOUT], ["delay", DELAY], ["ok", OK]] as const) {
    const m = body.match(re);
    if (m) return { signal, matched: m[0], appliesTo };
  }
  return { signal: "other", matched: null, appliesTo };
}

const firstName = (name: string) => name.trim().split(/\s+/)[0].toLowerCase();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Which cook is this message about? The sender if a cook wrote it; otherwise a cook named in
// the text: full name first, then a first name only if exactly one cook has it and no ops
// member shares it ("Priya" is both an ops member and two cooks, so it never matches).
export function resolveCook(
  msg: MessageInput,
  cooks: CookRef[],
  opsNames: Set<string>,
): { cookId: string; matchedBy: "sender" | "full_name" | "first_name" } | null {
  if (msg.sender_cook_id) return { cookId: msg.sender_cook_id, matchedBy: "sender" };
  const text = msg.body.toLowerCase();

  const full = cooks.filter((c) => new RegExp(`\\b${escape(c.name.toLowerCase())}\\b`).test(text));
  if (full.length === 1) return { cookId: full[0].cook_id, matchedBy: "full_name" };
  if (full.length > 1) return null;

  const byFirst = new Map<string, Set<string>>();
  for (const c of cooks) {
    const f = firstName(c.name);
    byFirst.set(f, (byFirst.get(f) ?? new Set()).add(c.cook_id));
  }
  const hits = [...byFirst.entries()].filter(
    ([f, ids]) => ids.size === 1 && !opsNames.has(f) && new RegExp(`\\b${escape(f)}\\b`).test(text),
  );
  if (hits.length === 1) return { cookId: [...hits[0][1]][0], matchedBy: "first_name" };
  return null;
}

// Local calendar date of a timestamp in IST.
export function istDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}

export function triageMessages(messages: MessageInput[], cooks: CookRef[], date: string): TriagedMessage[] {
  const opsNames = new Set(messages.filter((m) => m.sender_is_ops).map((m) => firstName(m.sender)));
  return messages
    .filter((m) => istDate(m.sent_at) === date)
    .map((m) => {
      const c = classify(m.body);
      const cook = resolveCook(m, cooks, opsNames);
      return { ...m, ...c, cookId: cook?.cookId ?? null, cookMatchedBy: cook?.matchedBy ?? null };
    });
}

// Dropout signals that apply to today, one per cook (earliest message wins as the source).
export function dropoutSignals(triaged: TriagedMessage[]): TriagedMessage[] {
  const byCook = new Map<string, TriagedMessage>();
  for (const m of triaged) {
    if (m.signal !== "dropout" || !m.cookId || m.appliesTo === "tomorrow") continue;
    if (!byCook.has(m.cookId)) byCook.set(m.cookId, m);
  }
  return [...byCook.values()];
}
