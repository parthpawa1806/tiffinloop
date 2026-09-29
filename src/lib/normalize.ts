// Data cleaning rules for the TiffinLoop seed files.
//
// The raw CSVs in data/raw are never edited. Every inconsistency is resolved here, in code,
// and every non-trivial decision is reported back so it can be logged to data_issues.
// Pure functions only: no I/O, so each rule is unit-tested in normalize.test.ts.

export type City = "BLR" | "MUM" | "PUNE";
export type Meal = "lunch" | "dinner";
export type MealPlan = "lunch" | "dinner" | "both";
export type Diet = "veg" | "non_veg" | "jain";
export type OrderStatus =
  | "delivered"
  | "pending"
  | "in_progress"
  | "cancelled"
  | "refunded"
  | "cook_dropout"
  | "unknown";

export const CUISINES = [
  "North Indian",
  "South Indian",
  "Bengali",
  "Gujarati",
  "Punjabi",
  "Maharashtrian",
  "Continental",
] as const;
export type Cuisine = (typeof CUISINES)[number];

const key = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, " ");

// ── City ────────────────────────────────────────────────────────────────────
const CITY_ALIASES: Record<string, City> = {
  bengaluru: "BLR",
  bangalore: "BLR",
  blr: "BLR",
  mumbai: "MUM",
  bombay: "MUM",
  mum: "MUM",
  pune: "PUNE",
};

export function normalizeCity(raw: string): City | null {
  return CITY_ALIASES[key(raw)] ?? null;
}

// ── Order status ────────────────────────────────────────────────────────────
// 18 raw variants collapse to 6. Note "Cancelled - Cook Unavailable" is a cook dropout,
// not an ordinary cancellation: it must count on the leadership dashboard.
const STATUS_ALIASES: Record<string, OrderStatus> = {
  delivered: "delivered",
  completed: "delivered",
  pending: "pending",
  "in progress": "in_progress",
  cancelled: "cancelled",
  refunded: "refunded",
  "cook dropout": "cook_dropout",
  "cook no show": "cook_dropout",
  "no show": "cook_dropout", // assumption: order log only records cook-side no-shows
  "cancelled cook unavailable": "cook_dropout",
};

export function normalizeStatus(raw: string): OrderStatus {
  const k = key(raw).replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
  return STATUS_ALIASES[k] ?? "unknown";
}

// ── Dates ───────────────────────────────────────────────────────────────────
// Seen formats: 2026-09-23, 23/09/2026, 09-Sep-2026.
// Slashed dates are day-first: 24/08/2026 appears in the file, so month-first is impossible.
export type DateFormat = "iso" | "dmy_slash" | "d_mon_y";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function parseDate(raw: string): { date: string; format: DateFormat } | null {
  const s = raw.trim();
  let y: number, m: number, d: number, format: DateFormat;
  let match: RegExpMatchArray | null;
  if ((match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
    [y, m, d] = [+match[1], +match[2], +match[3]];
    format = "iso";
  } else if ((match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) {
    [d, m, y] = [+match[1], +match[2], +match[3]];
    format = "dmy_slash";
  } else if ((match = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/))) {
    const mi = MONTHS.indexOf(match[2].toLowerCase());
    if (mi < 0) return null;
    [d, m, y] = [+match[1], mi + 1, +match[3]];
    format = "d_mon_y";
  } else {
    return null;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return { date: dt.toISOString().slice(0, 10), format };
}

// ── Phones ──────────────────────────────────────────────────────────────────
// "+91 98123 45678", "09812345678", "9812345678" -> "9812345678". Blank or invalid -> null.
export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

// ── Diet, meal plan, cuisine ────────────────────────────────────────────────
export function normalizeDiet(raw: string): Diet | null {
  const k = key(raw).replace(/\s/g, "");
  if (k === "veg") return "veg";
  if (k === "nonveg") return "non_veg";
  if (k === "jain") return "jain";
  return null;
}

// Cook "serves" column: "Veg, Non-Veg" / "Veg, Jain" / "Veg"
export function parseServes(raw: string): { veg: boolean; nonVeg: boolean; jain: boolean } {
  const diets = raw.split(",").map(normalizeDiet);
  return {
    veg: diets.includes("veg"),
    nonVeg: diets.includes("non_veg"),
    jain: diets.includes("jain"),
  };
}

export function normalizeMealPlan(raw: string): MealPlan | null {
  const k = key(raw);
  if (k === "lunch only") return "lunch";
  if (k === "dinner only") return "dinner";
  if (k === "lunch + dinner") return "both";
  return null;
}

export function normalizeMeal(raw: string): Meal | null {
  const k = key(raw);
  return k === "lunch" || k === "dinner" ? k : null;
}

export function normalizeCuisine(raw: string): Cuisine | null {
  return CUISINES.find((c) => key(c) === key(raw)) ?? null;
}

// ── Duplicate people ────────────────────────────────────────────────────────
// The same person can appear under two IDs (Tariq Hussain / Tariq Husain, CK054 / CK084).
// Rules, in order:
//   1. Same normalized phone AND similar name  -> same person (high confidence).
//      Similar, not equal: catches spelling variants. A shared phone with an unrelated
//      name (e.g. a family number) is NOT merged.
//   2. At least one phone missing, same name, same city, same profile -> same person
//      (medium confidence). "Profile" = assigned cook + diet for subscribers, cuisine +
//      diets served for cooks. This stops two different "Pooja Khan"s from merging.
//   3. Anything else -> different people.
// Merges are non-destructive: every record keeps its ID and points at a canonical one.

export function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export function namesSimilar(a: string, b: string): boolean {
  const [ka, kb] = [nameKey(a), nameKey(b)];
  if (ka === kb) return true;
  return editDistance(ka, kb) <= Math.max(1, Math.floor(Math.min(ka.length, kb.length) * 0.15));
}

export interface PersonRecord {
  id: string;
  name: string;
  phone: string | null;
  city: City;
  profileKey: string; // what must match when a phone is missing
}

export interface DuplicateMatch {
  id: string;
  canonicalId: string;
  confidence: "high" | "medium";
  reason: string;
}

// Returns a canonical ID for every record, plus the list of merges with reasons.
// Canonical record = the one with a phone if only one has it, otherwise the lowest ID.
export function findDuplicates(records: PersonRecord[]): {
  canonical: Map<string, string>;
  matches: DuplicateMatch[];
} {
  const parent = new Map(records.map((r) => [r.id, r.id]));
  const find = (id: string): string => {
    const p = parent.get(id)!;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  const edges: { a: PersonRecord; b: PersonRecord; confidence: "high" | "medium"; reason: string }[] = [];

  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const a = records[i];
      const b = records[j];
      if (a.phone && b.phone) {
        if (a.phone === b.phone && namesSimilar(a.name, b.name)) {
          edges.push({ a, b, confidence: "high", reason: `same phone ${a.phone}, similar name` });
        }
      } else if (
        nameKey(a.name) === nameKey(b.name) &&
        a.city === b.city &&
        a.profileKey === b.profileKey
      ) {
        edges.push({ a, b, confidence: "medium", reason: "same name, city and profile; phone missing" });
      }
    }
  }

  for (const { a, b } of edges) {
    const [ra, rb] = [find(a.id), find(b.id)];
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }

  // Pick the canonical record per group: prefer one with a phone, then lowest ID.
  const groups = new Map<string, PersonRecord[]>();
  for (const r of records) {
    const root = find(r.id);
    groups.set(root, [...(groups.get(root) ?? []), r]);
  }
  const canonical = new Map<string, string>();
  for (const members of groups.values()) {
    const best = [...members].sort(
      (x, y) => Number(!x.phone) - Number(!y.phone) || x.id.localeCompare(y.id),
    )[0];
    for (const m of members) canonical.set(m.id, best.id);
  }

  const matches: DuplicateMatch[] = [];
  for (const { a, b, confidence, reason } of edges) {
    for (const r of [a, b]) {
      const canonicalId = canonical.get(r.id)!;
      if (canonicalId !== r.id && !matches.some((m) => m.id === r.id)) {
        matches.push({ id: r.id, canonicalId, confidence, reason });
      }
    }
  }
  return { canonical, matches };
}

// ── WhatsApp export ─────────────────────────────────────────────────────────
// Line format: "23/09/26, 6:52 am - Priya (Ops): message"
export interface WhatsAppLine {
  line: number;
  sentAt: Date;
  sender: string;
  senderIsOps: boolean;
  body: string;
}

export function parseWhatsAppExport(text: string): WhatsAppLine[] {
  const out: WhatsAppLine[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}), (\d{1,2}):(\d{2})\s*([ap]m) - ([^:]+): (.*)$/i);
    if (!m) {
      // Continuation of a multi-line message.
      if (raw.trim() && out.length) out[out.length - 1].body += `\n${raw}`;
      return;
    }
    const [, d, mo, yy, hh, mm, ampm, sender, body] = m;
    let hour = +hh % 12;
    if (ampm.toLowerCase() === "pm") hour += 12;
    const iso = `20${yy}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${String(hour).padStart(2, "0")}:${mm}:00+05:30`;
    out.push({
      line: i + 1,
      sentAt: new Date(iso),
      sender: sender.trim(),
      senderIsOps: /\(ops\)/i.test(sender),
      body,
    });
  });
  return out;
}
