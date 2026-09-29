// Runs the full transform against the untouched seed files in data/raw.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
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

const cook = (id: string) => data.cooks.find((c) => c.cook_id === id)!;
const sub = (id: string) => data.subscribers.find((s) => s.subscriber_id === id)!;

describe("transform on real seed data", () => {
  it("loads every row", () => {
    expect(data.cooks).toHaveLength(92);
    expect(data.subscribers).toHaveLength(532);
    expect(data.orders).toHaveLength(7138);
  });

  it("collapses cities to three", () => {
    expect(new Set([...data.cooks, ...data.subscribers].map((r) => r.city))).toEqual(new Set(["BLR", "MUM", "PUNE"]));
  });

  it("parses every order date, including day-first ones", () => {
    const dates = data.orders.map((o) => o.order_date).sort();
    expect(dates[0]).toBe("2026-08-24");
    expect(dates.at(-1)).toBe("2026-09-23");
    expect(data.orders.filter((o) => o.order_date === "2026-09-23")).toHaveLength(238);
  });

  it("counts all five dropout labels as cook_dropout", () => {
    expect(data.orders.filter((o) => o.status === "cook_dropout")).toHaveLength(134);
    expect(data.orders.some((o) => o.status === "unknown")).toBe(false);
  });

  it("parses status_since in all three formats", () => {
    expect(cook("CK086").status_since).toBe("2026-09-23"); // 2026-09-23
    expect(cook("CK087").status_since).toBe("2026-09-23"); // 23/09/2026
    expect(cook("CK089").status_since).toBe("2026-09-19"); // 19-Sep-2026
  });

  it("merges Tariq Hussain / Tariq Husain", () => {
    expect(sub("SUB0512").canonical_subscriber_id).toBe("SUB0511");
  });

  it("keeps the two Pooja Khans and Salman Sharmas separate", () => {
    expect(sub("SUB0486").canonical_subscriber_id).toBe("SUB0486");
    expect(sub("SUB0160").canonical_subscriber_id).toBe("SUB0160");
    expect(sub("SUB0493").canonical_subscriber_id).toBe("SUB0493");
  });

  it("merges duplicate cook records", () => {
    expect(cook("CK084").canonical_cook_id).toBe("CK054"); // same phone
    expect(cook("CK081").canonical_cook_id).toBe("CK036"); // same phone
    expect(cook("CK085").canonical_cook_id).toBe("CK016"); // one phone missing
    expect(cook("CK082").canonical_cook_id).toBe("CK011");
    expect(cook("CK083").canonical_cook_id).toBe("CK045"); // both phones missing
  });

  it("does not merge distinct cooks", () => {
    const merged = data.cooks.filter((c) => c.canonical_cook_id !== c.cook_id).map((c) => c.cook_id).sort();
    expect(merged).toEqual(["CK081", "CK082", "CK083", "CK084", "CK085"]);
  });

  it("keeps Sunita Kulkarni active in the sheet (the WhatsApp dropout is not in the sheet)", () => {
    expect(cook("CK090").sheet_status).toBe("active");
  });

  it("parses Meena Nair's serves: no Jain", () => {
    expect(cook("CK088")).toMatchObject({ serves_veg: true, serves_non_veg: true, serves_jain: false, max_daily_orders: 12 });
  });

  it("flags subscribers who cannot be messaged", () => {
    expect(sub("SUB0503").phone).toBeNull(); // Farah Gupta, affected by Lakshmi today
    expect(data.issues.some((i) => i.entity_id === "SUB0503" && i.issue === "missing_phone")).toBe(true);
  });

  it("links WhatsApp messages sent by cooks", () => {
    const sunita = data.whatsapp.find((m) => m.sender === "Sunita Kulkarni")!;
    expect(sunita.sender_cook_id).toBe("CK090");
    expect(data.whatsapp).toHaveLength(13);
  });
});
