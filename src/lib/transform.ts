// Turns the raw seed files into database rows plus a log of every cleaning decision.
// No I/O here: scripts/seed.ts reads the files and writes the result to Supabase.

import { parse } from "csv-parse/sync";
import {
  type City,
  type Cuisine,
  type Diet,
  type Meal,
  type MealPlan,
  type OrderStatus,
  findDuplicates,
  nameKey,
  normalizeCity,
  normalizeCuisine,
  normalizeDiet,
  normalizeMeal,
  normalizeMealPlan,
  normalizePhone,
  normalizeStatus,
  parseDate,
  parseServes,
  parseWhatsAppExport,
} from "./normalize";

export interface CookRow {
  cook_id: string;
  canonical_cook_id: string;
  name: string;
  city: City;
  cuisine_specialty: Cuisine;
  serves_veg: boolean;
  serves_non_veg: boolean;
  serves_jain: boolean;
  phone: string | null;
  sheet_status: "active" | "on_leave" | "inactive";
  status_since: string | null;
  joined_date: string | null;
  max_daily_orders: number;
  raw: Record<string, string>;
}

export interface SubscriberRow {
  subscriber_id: string;
  canonical_subscriber_id: string;
  name: string;
  city: City;
  phone: string | null;
  assigned_cook_id: string | null;
  meal_plan: MealPlan;
  cuisine_pref: Cuisine;
  diet: Diet;
  subscription_status: "active" | "paused";
  start_date: string | null;
  raw: Record<string, string>;
}

export interface OrderRow {
  order_id: string;
  order_date: string;
  meal: Meal;
  subscriber_id: string;
  cook_id: string;
  status: OrderStatus;
  raw_status: string;
  amount_inr: number;
}

export interface WhatsAppRow {
  id: number;
  sent_at: string;
  sender: string;
  sender_is_ops: boolean;
  sender_cook_id: string | null;
  body: string;
}

export interface DataIssueRow {
  entity: "cooks" | "subscribers" | "orders" | "whatsapp";
  entity_id: string | null;
  issue: string;
  raw_value: string | null;
  resolved_value: string | null;
  row_count: number;
  detail: string | null;
}

export interface SeedData {
  cooks: CookRow[];
  subscribers: SubscriberRow[];
  orders: OrderRow[];
  whatsapp: WhatsAppRow[];
  issues: DataIssueRow[];
}

export interface RawFiles {
  cooksCsv: string;
  subscribersCsv: string;
  ordersCsv: string;
  whatsappTxt: string;
}

const readCsv = (text: string): Record<string, string>[] =>
  parse(text, { columns: true, skip_empty_lines: true, trim: true, bom: true });

export function transform(files: RawFiles): SeedData {
  const issues: DataIssueRow[] = [];
  const errors: string[] = [];
  // Aggregate issues (same raw value seen many times) are counted, not logged per row.
  const tally = new Map<string, DataIssueRow>();
  const count = (entity: DataIssueRow["entity"], issue: string, raw: string, resolved: string) => {
    const k = `${entity}|${issue}|${raw}`;
    const row = tally.get(k);
    if (row) row.row_count++;
    else tally.set(k, { entity, entity_id: null, issue, raw_value: raw, resolved_value: resolved, row_count: 1, detail: null });
  };
  const issue = (row: Omit<DataIssueRow, "row_count" | "detail"> & { detail?: string }) =>
    issues.push({ row_count: 1, detail: null, ...row });

  const city = (entity: DataIssueRow["entity"], id: string, raw: string): City => {
    const c = normalizeCity(raw);
    if (!c) {
      errors.push(`${entity} ${id}: unknown city "${raw}"`);
      return "BLR";
    }
    count(entity, "city_mapped", raw, c);
    return c;
  };

  const date = (entity: DataIssueRow["entity"], id: string, field: string, raw: string, perRow: boolean): string | null => {
    if (!raw) return null;
    const p = parseDate(raw);
    if (!p) {
      issue({ entity, entity_id: id, issue: "unparseable_date", raw_value: raw, resolved_value: null, detail: field });
      return null;
    }
    if (p.format !== "iso") {
      if (perRow) issue({ entity, entity_id: id, issue: "nonstandard_date", raw_value: raw, resolved_value: p.date, detail: field });
      else count(entity, "nonstandard_date", p.format, "day-first");
    }
    return p.date;
  };

  const phone = (entity: DataIssueRow["entity"], id: string, raw: string): string | null => {
    const p = normalizePhone(raw);
    if (!raw.trim()) issue({ entity, entity_id: id, issue: "missing_phone", raw_value: null, resolved_value: null, detail: "cannot be messaged; needs a call or manual follow-up" });
    else if (!p) issue({ entity, entity_id: id, issue: "invalid_phone", raw_value: raw, resolved_value: null });
    return p;
  };

  // ── Cooks ────────────────────────────────────────────────────────────────
  const cooks: CookRow[] = readCsv(files.cooksCsv).map((r) => {
    const id = r.cook_id;
    const cuisine = normalizeCuisine(r.cuisine_specialty);
    if (!cuisine) errors.push(`cook ${id}: unknown cuisine "${r.cuisine_specialty}"`);
    const serves = parseServes(r.serves);
    const status = r.status.trim().toLowerCase();
    if (!["active", "on_leave", "inactive"].includes(status)) errors.push(`cook ${id}: unknown status "${r.status}"`);
    const max = Number.parseInt(r.max_daily_orders, 10);
    if (!Number.isFinite(max)) errors.push(`cook ${id}: bad max_daily_orders "${r.max_daily_orders}"`);
    return {
      cook_id: id,
      canonical_cook_id: id,
      name: r.cook_name.trim(),
      city: city("cooks", id, r.city),
      cuisine_specialty: cuisine ?? "North Indian",
      serves_veg: serves.veg,
      serves_non_veg: serves.nonVeg,
      serves_jain: serves.jain,
      phone: phone("cooks", id, r.phone),
      sheet_status: status as CookRow["sheet_status"],
      status_since: date("cooks", id, "status_since", r.status_since, true),
      joined_date: date("cooks", id, "joined_date", r.joined_date, true),
      max_daily_orders: max,
      raw: r,
    };
  });

  // ── Subscribers ──────────────────────────────────────────────────────────
  const cookIds = new Set(cooks.map((c) => c.cook_id));
  const subscribers: SubscriberRow[] = readCsv(files.subscribersCsv).map((r) => {
    const id = r.subscriber_id;
    const plan = normalizeMealPlan(r.meal_plan);
    const cuisine = normalizeCuisine(r.cuisine_pref);
    const diet = normalizeDiet(r.diet);
    const status = r.subscription_status.trim().toLowerCase();
    if (!plan) errors.push(`subscriber ${id}: unknown meal plan "${r.meal_plan}"`);
    if (!cuisine) errors.push(`subscriber ${id}: unknown cuisine "${r.cuisine_pref}"`);
    if (!diet) errors.push(`subscriber ${id}: unknown diet "${r.diet}"`);
    if (!["active", "paused"].includes(status)) errors.push(`subscriber ${id}: unknown status "${r.subscription_status}"`);
    let assigned: string | null = r.assigned_cook_id.trim() || null;
    if (assigned && !cookIds.has(assigned)) {
      issue({ entity: "subscribers", entity_id: id, issue: "unknown_cook", raw_value: assigned, resolved_value: null });
      assigned = null;
    }
    return {
      subscriber_id: id,
      canonical_subscriber_id: id,
      name: r.subscriber_name.trim(),
      city: city("subscribers", id, r.city),
      phone: phone("subscribers", id, r.phone),
      assigned_cook_id: assigned,
      meal_plan: plan ?? "both",
      cuisine_pref: cuisine ?? "North Indian",
      diet: diet ?? "veg",
      subscription_status: status as SubscriberRow["subscription_status"],
      start_date: date("subscribers", id, "start_date", r.start_date, true),
      raw: r,
    };
  });

  // ── Duplicate people ─────────────────────────────────────────────────────
  const cookDupes = findDuplicates(
    cooks.map((c) => ({
      id: c.cook_id,
      name: c.name,
      phone: c.phone,
      city: c.city,
      profileKey: `${c.cuisine_specialty}|${c.serves_veg}|${c.serves_non_veg}|${c.serves_jain}`,
    })),
  );
  for (const c of cooks) c.canonical_cook_id = cookDupes.canonical.get(c.cook_id)!;
  for (const m of cookDupes.matches) {
    issue({ entity: "cooks", entity_id: m.id, issue: "duplicate_of", raw_value: m.id, resolved_value: m.canonicalId, detail: `${m.confidence} confidence: ${m.reason}` });
  }

  const subDupes = findDuplicates(
    subscribers.map((s) => ({
      id: s.subscriber_id,
      name: s.name,
      phone: s.phone,
      city: s.city,
      profileKey: `${s.assigned_cook_id}|${s.diet}`,
    })),
  );
  for (const s of subscribers) s.canonical_subscriber_id = subDupes.canonical.get(s.subscriber_id)!;
  for (const m of subDupes.matches) {
    issue({ entity: "subscribers", entity_id: m.id, issue: "duplicate_of", raw_value: m.id, resolved_value: m.canonicalId, detail: `${m.confidence} confidence: ${m.reason}` });
  }

  // ── Orders ───────────────────────────────────────────────────────────────
  const subIds = new Set(subscribers.map((s) => s.subscriber_id));
  const orders: OrderRow[] = [];
  for (const r of readCsv(files.ordersCsv)) {
    const id = r.order_id;
    const d = date("orders", id, "order_date", r.order_date, false);
    const meal = normalizeMeal(r.meal_type);
    const status = normalizeStatus(r.status);
    const amount = Number.parseInt(r.amount_inr, 10);
    if (!d || !meal || !Number.isFinite(amount) || !subIds.has(r.subscriber_id) || !cookIds.has(r.cook_id)) {
      issue({ entity: "orders", entity_id: id, issue: "unloadable_order", raw_value: JSON.stringify(r), resolved_value: null, detail: "skipped" });
      continue;
    }
    if (status === "unknown") issue({ entity: "orders", entity_id: id, issue: "unknown_status", raw_value: r.status, resolved_value: "unknown" });
    else count("orders", "status_mapped", r.status, status);
    orders.push({
      order_id: id,
      order_date: d,
      meal,
      subscriber_id: r.subscriber_id,
      cook_id: r.cook_id,
      status,
      raw_status: r.status,
      amount_inr: amount,
    });
  }

  // ── WhatsApp ─────────────────────────────────────────────────────────────
  // Link messages sent by a cook to that cook. Mentions inside ops messages
  // ("Lakshmi aunty called") are resolved later by the triage logic.
  const cookByName = new Map(cooks.map((c) => [nameKey(c.name), c.canonical_cook_id]));
  const whatsapp: WhatsAppRow[] = parseWhatsAppExport(files.whatsappTxt).map((m) => ({
    id: m.line,
    sent_at: m.sentAt.toISOString(),
    sender: m.sender,
    sender_is_ops: m.senderIsOps,
    sender_cook_id: m.senderIsOps ? null : (cookByName.get(nameKey(m.sender)) ?? null),
    body: m.body,
  }));

  if (errors.length) throw new Error(`Seed data could not be normalized:\n${errors.join("\n")}`);
  return { cooks, subscribers, orders, whatsapp, issues: [...issues, ...tally.values()] };
}
