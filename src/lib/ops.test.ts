// Triage, allocation and messaging, run against today's real scenario from data/raw.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { type AffectedOrder, type BackupCook, allocate, isUnreliable, rankBackups } from "./allocate";
import { TODAY } from "./config";
import { backupCookBrief, subscriberMessage } from "./messages";
import { classify, dropoutSignals, triageMessages } from "./triage";
import { type SeedData, transform } from "./transform";

const raw = (f: string) => readFileSync(join(__dirname, "../../data/raw", f), "utf8");
let data: SeedData;
beforeAll(() => {
  data = transform({
    cooksCsv: raw("cooks.csv"),
    subscribersCsv: raw("subscribers.csv"),
    ordersCsv: raw("orders.csv"),
    whatsappTxt: raw("ops_whatsapp_export.txt"),
  });
});

const canonicalCooks = () =>
  data.cooks.filter((c) => c.cook_id === c.canonical_cook_id).map((c) => ({ cook_id: c.cook_id, name: c.name }));

describe("classify", () => {
  it.each([
    ["Lakshmi aunty called. Fever, not cooking today. Updated sheet", "dropout", "today"],
    ["Geeta Rao also out today, family function in Mysore. Updated sheet", "dropout", "today"],
    ["Bhaiya aaj nahi ho payega, gaon jana pad raha hai urgent. Sorry 🙏", "dropout", "today"],
    ["Tomorrow I will be 30 min late for lunch pickup, road work near my building", "delay", "tomorrow"],
    ["Good morning, all my orders on track for today 👍", "ok", "today"],
    ["Tariq sir called again, asking why he gets two reminder messages every day", "other", "unspecified"],
  ])("%s", (body, signal, appliesTo) => {
    expect(classify(body)).toMatchObject({ signal, appliesTo });
  });
});

describe("triage of the real WhatsApp export", () => {
  it("flags exactly Lakshmi, Geeta and Sunita as today's dropouts", () => {
    const signals = dropoutSignals(triageMessages(data.whatsapp, canonicalCooks(), TODAY));
    expect(signals.map((s) => s.cookId).sort()).toEqual(["CK086", "CK087", "CK090"]);
  });

  it("links each dropout to the right message and match method", () => {
    const t = triageMessages(data.whatsapp, canonicalCooks(), TODAY);
    const by = (id: string) => dropoutSignals(t).find((s) => s.cookId === id)!;
    expect(by("CK086")).toMatchObject({ id: 3, cookMatchedBy: "first_name" }); // "Lakshmi aunty"
    expect(by("CK087")).toMatchObject({ id: 4, cookMatchedBy: "full_name" });
    expect(by("CK090")).toMatchObject({ id: 5, cookMatchedBy: "sender" });
  });

  it("does not flag Anil (late tomorrow) or Meena (on track)", () => {
    const t = triageMessages(data.whatsapp, canonicalCooks(), TODAY);
    expect(t.find((m) => m.sender === "Anil Joshi")).toMatchObject({ signal: "delay", appliesTo: "tomorrow", cookId: "CK092" });
    expect(t.find((m) => m.sender === "Meena Nair")).toMatchObject({ signal: "ok", cookId: "CK088" });
  });

  it("never matches 'Priya' to a cook (ops member and two cooks share the name)", () => {
    const t = triageMessages(data.whatsapp, canonicalCooks(), TODAY);
    expect(t.find((m) => m.body.startsWith("Standup done"))!.cookId).toBeNull();
  });

  it("ignores yesterday's messages", () => {
    const t = triageMessages(data.whatsapp, canonicalCooks(), TODAY);
    expect(t.some((m) => m.body.includes("festival week"))).toBe(false);
  });
});

// Build today's allocation inputs from the seed data, with Lakshmi, Geeta and Sunita out.
function todayScenario() {
  const dropped = new Set(["CK086", "CK087", "CK090"]);
  const today = data.orders.filter((o) => o.order_date === TODAY && ["pending", "in_progress"].includes(o.status));
  const subs = new Map(data.subscribers.map((s) => [s.subscriber_id, s]));
  const canon = new Map(data.cooks.map((c) => [c.cook_id, c.canonical_cook_id]));
  const load = new Map<string, number>();
  for (const o of today) load.set(canon.get(o.cook_id)!, (load.get(canon.get(o.cook_id)!) ?? 0) + 1);
  const hist = data.orders.filter((o) => o.order_date < TODAY);
  const stat = (id: string, f: (o: (typeof hist)[number]) => boolean) =>
    hist.filter((o) => canon.get(o.cook_id) === id && f(o)).length;

  const cooks: BackupCook[] = data.cooks
    .filter((c) => c.cook_id === c.canonical_cook_id)
    .map((c) => ({
      ...c,
      free_slots: c.max_daily_orders - (load.get(c.cook_id) ?? 0),
      is_available: c.sheet_status === "active" && !dropped.has(c.cook_id),
      dropouts_30d: stat(c.cook_id, (o) => o.status === "cook_dropout"),
      orders_30d: stat(c.cook_id, () => true),
    }));
  const affected: AffectedOrder[] = today
    .filter((o) => dropped.has(canon.get(o.cook_id)!))
    .map((o) => {
      const s = subs.get(o.subscriber_id)!;
      return {
        ...o,
        event_id: canon.get(o.cook_id)!,
        city: s.city,
        diet: s.diet,
        cuisine_pref: s.cuisine_pref,
        canonical_subscriber_id: s.canonical_subscriber_id,
      };
    });
  return { cooks, affected };
}

describe("allocate: today's scenario", () => {
  it("covers all 24 affected orders", () => {
    const { cooks, affected } = todayScenario();
    expect(affected).toHaveLength(24);
    expect(allocate(affected, cooks)).toHaveLength(24);
  });

  it("gives Meena Nair's 8 free slots to Bengaluru lunch orders first, across both events", () => {
    const { cooks, affected } = todayScenario();
    const plan = allocate(affected, cooks);
    const toMeena = plan.filter((p) => p.backup_cook_id === "CK088").map((p) => p.order_id);
    expect(toMeena).toHaveLength(8);
    const meal = new Map(affected.map((o) => [o.order_id, o.meal]));
    expect(toMeena.every((id) => meal.get(id) === "lunch")).toBe(true);
    // Both events share her: Lakshmi's (ORD07105-09) and Geeta's (ORD07110-18) lunch orders.
    expect(toMeena.some((id) => id <= "ORD07109")).toBe(true);
    expect(toMeena.some((id) => id >= "ORD07110")).toBe(true);
  });

  it("never gives a Jain order to Meena (she doesn't cook Jain)", () => {
    const { cooks, affected } = todayScenario();
    const plan = allocate(affected, cooks);
    const cookById = new Map(cooks.map((c) => [c.cook_id, c]));
    for (const o of affected.filter((a) => a.diet === "jain")) {
      const p = plan.find((x) => x.order_id === o.order_id)!;
      expect(p.backup_cook_id).not.toBe("CK088");
      if (p.backup_cook_id) expect(cookById.get(p.backup_cook_id)!.serves_jain).toBe(true);
    }
  });

  it("refunds Tariq's duplicate lunch instead of spending a backup slot on it", () => {
    const { cooks, affected } = todayScenario();
    const plan = allocate(affected, cooks);
    expect(plan.find((p) => p.order_id === "ORD07117")!.backup_cook_id).toBe("CK088"); // SUB0511, canonical
    expect(plan.find((p) => p.order_id === "ORD07118")).toMatchObject({ action: "refund", refund_amount: 129 });
  });

  it("marks cross-cuisine backups so the subscriber can choose a refund", () => {
    const { cooks, affected } = todayScenario();
    const plan = allocate(affected, cooks);
    const blr = plan.filter((p) => p.order_id >= "ORD07101" && p.order_id <= "ORD07118");
    expect(blr.filter((p) => p.cuisine_match)).toHaveLength(8);
    expect(blr.filter((p) => !p.cuisine_match && p.action === "reassign")).toHaveLength(9);
    expect(blr.filter((p) => p.action === "refund")).toHaveLength(1);
  });

  it("explains cross-cuisine choices precisely", () => {
    const { cooks, affected } = todayScenario();
    const plan = allocate(affected, cooks);
    // Bhavna is Jain: Meena has slots but doesn't cook Jain.
    expect(plan.find((p) => p.order_id === "ORD07108")!.reason).toMatch(/^No available South Indian cook makes Jain/);
    // Veg dinners: Meena's slots went to lunch.
    expect(plan.find((p) => p.order_id === "ORD07101")!.reason).toMatch(/^South Indian backups are full \(lunch orders went first\)/);
  });

  it("consolidates cross-cuisine orders on as few backup cooks as possible", () => {
    const { cooks, affected } = todayScenario();
    const plan = allocate(affected, cooks);
    const cross = plan.filter((p) => p.action === "reassign" && !p.cuisine_match);
    expect(new Set(cross.map((p) => p.backup_cook_id)).size).toBe(1);
  });

  it("sends all of Sunita's Mumbai orders to Rekha Patil (Maharashtrian, 25 free)", () => {
    const { cooks, affected } = todayScenario();
    const plan = allocate(affected, cooks);
    const mum = plan.filter((p) => p.event_id === "CK090");
    expect(mum).toHaveLength(6);
    expect(mum.every((p) => p.backup_cook_id === "CK091" && p.cuisine_match)).toBe(true);
  });

  it("never suggests an unavailable or dropped cook", () => {
    const { cooks, affected } = todayScenario();
    const plan = allocate(affected, cooks);
    const bad = new Set(["CK086", "CK087", "CK089", "CK090"]);
    expect(plan.some((p) => p.backup_cook_id && bad.has(p.backup_cook_id))).toBe(false);
  });

  it("refunds when nobody can take the order", () => {
    const { cooks, affected } = todayScenario();
    const noSlots = cooks.map((c) => ({ ...c, free_slots: 0 }));
    const plan = allocate(affected.slice(0, 2), noSlots);
    expect(plan.every((p) => p.action === "refund" && p.refund_amount! > 0)).toBe(true);
  });

  it("ranks repeat droppers last among equals", () => {
    const { cooks } = todayScenario();
    expect(isUnreliable(cooks.find((c) => c.cook_id === "CK080")!)).toBe(true); // Imran Agarwal, Pune
    const order: AffectedOrder = {
      order_id: "X", event_id: "E", meal: "lunch", amount_inr: 100, city: "PUNE", diet: "veg",
      cuisine_pref: "Bengali", subscriber_id: "S", canonical_subscriber_id: "S",
    };
    const ranked = rankBackups(order, cooks, new Map(cooks.map((c) => [c.cook_id, c.free_slots])));
    const bengali = ranked.filter((c) => c.cuisine_specialty === "Bengali").map((c) => c.cook_id);
    expect(bengali.at(-1)).toBe("CK080");
  });
});

describe("messages", () => {
  const base = { cuisine_pref: "South Indian" as const, diet: "veg" as const, amount_inr: 199 };

  it("combines duplicate-account orders into one message and hides the reason", () => {
    const msg = subscriberMessage({
      name: "Tariq Hussain",
      cookName: "Geeta Rao",
      dateLabel: "Wed 23 Sep",
      orders: [
        { ...base, order_id: "ORD07118", meal: "lunch", action: "refund", backup_cook_name: null, backup_cuisine: null, amount_inr: 129, duplicate_booking: true },
        { ...base, order_id: "ORD07117", meal: "lunch", action: "reassign", backup_cook_name: "Meena Nair", backup_cuisine: "South Indian" },
      ],
    });
    expect(msg).toMatch(/^Hi Tariq/);
    expect(msg).toContain("Geeta can't cook today");
    expect(msg).not.toMatch(/family|Mysore|fever/i);
    const bullets = msg.split("\n").filter((l) => l.startsWith("•"));
    expect(bullets).toHaveLength(2);
    expect(bullets[0]).toContain("Meena Nair"); // the real lunch first
    expect(bullets[1]).toContain("booked twice");
    expect(bullets[1]).toContain("₹129");
  });

  it("offers a refund when the backup cooks a different cuisine", () => {
    const msg = subscriberMessage({
      name: "Bhavna Shah", cookName: "Lakshmi Iyer", dateLabel: "Wed 23 Sep",
      orders: [{ ...base, diet: "jain", order_id: "ORD07108", meal: "lunch", action: "reassign", backup_cook_name: "Ritu Chatterjee", backup_cuisine: "Bengali" }],
    });
    expect(msg).toContain("Jain Bengali food");
    expect(msg).toContain("Reply REFUND by 11:30 AM");
    expect(msg).toContain("12:30 PM–2:00 PM");
  });

  it("states the refund amount", () => {
    const msg = subscriberMessage({
      name: "A B", cookName: "C D", dateLabel: "Wed 23 Sep",
      orders: [{ ...base, order_id: "X", meal: "dinner", action: "refund", backup_cook_name: null, backup_cuisine: null }],
    });
    expect(msg).toContain("₹199 will be refunded");
  });

  it("marks a changed plan as an update to the earlier message", () => {
    const msg = subscriberMessage({
      name: "Suresh Reddy", cookName: "Sunita Kulkarni", dateLabel: "Wed 23 Sep", isUpdate: true,
      orders: [{ ...base, order_id: "ORD07128", meal: "dinner", action: "refund", backup_cook_name: null, backup_cuisine: null, amount_inr: 129 }],
    });
    expect(msg).toMatch(/^Hi Suresh, an update to our earlier message/);
    expect(msg).toContain("cancelled for today. ₹129 will be refunded");
  });

  it("briefs the backup cook with counts per meal and diet", () => {
    const brief = backupCookBrief({
      cookName: "Meena Nair", dateLabel: "Wed 23 Sep",
      orders: [
        { meal: "lunch", subscriber_name: "Mahesh D'Souza", diet: "veg" },
        { meal: "lunch", subscriber_name: "Alok Singh", diet: "veg" },
      ],
    });
    expect(brief).toContain("Lunch, ready by 12:30 PM: 2 extra (2 Veg)");
  });
});
