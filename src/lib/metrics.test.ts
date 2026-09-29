// Dashboard metrics against the real seed data (last 30 days = 24 Aug – 22 Sep).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { type DashInput, computeDashboard, weekStart } from "./metrics";
import { statusBucket } from "./status";
import { type SeedData, transform } from "./transform";

const raw = (f: string) => readFileSync(join(__dirname, "../../data/raw", f), "utf8");
let data: SeedData;
let input: DashInput;
const LAST_30 = { from: "2026-08-24", to: "2026-09-22" };

beforeAll(() => {
  data = transform({
    cooksCsv: raw("cooks.csv"),
    subscribersCsv: raw("subscribers.csv"),
    ordersCsv: raw("orders.csv"),
    whatsappTxt: raw("ops_whatsapp_export.txt"),
  });
  input = { today: "2026-09-23", orders: data.orders, cooks: data.cooks, subscribers: data.subscribers, events: [], capacity: [] };
});

describe("status buckets", () => {
  it("groups the normalized statuses into 5 buckets", () => {
    expect(statusBucket("pending")).toBe("open");
    expect(statusBucket("in_progress")).toBe("open");
    expect(statusBucket("cook_dropout")).toBe("cook_dropout");
    const counts: Record<string, number> = {};
    for (const o of data.orders) counts[statusBucket(o.status)] = (counts[statusBucket(o.status)] ?? 0) + 1;
    expect(counts.cook_dropout).toBe(134);
    expect(Object.keys(counts).sort()).toEqual(["cancelled", "cook_dropout", "delivered", "open", "refunded"]);
  });
});

describe("last 30 days", () => {
  it("counts every historical order and all 134 dropouts", () => {
    const d = computeDashboard(input, LAST_30);
    expect(d.orders.total).toBe(6900);
    expect(d.headline.dropouts).toBe(134);
    expect(d.headline.dropoutRate).toBeCloseTo(134 / 6900, 6);
    expect(d.orders.lunch + d.orders.dinner).toBe(6900);
  });

  it("shows Pune's dropout rate is far above the other cities", () => {
    const d = computeDashboard(input, LAST_30);
    const by = Object.fromEntries(d.cities.map((c) => [c.city, c]));
    expect([by.BLR.dropouts, by.MUM.dropouts, by.PUNE.dropouts]).toEqual([66, 19, 49]);
    expect(by.PUNE.rate).toBeCloseTo(49 / 898, 4);
    expect(by.PUNE.rate).toBeGreaterThan(3 * by.BLR.rate);
  });

  it("ranks Imran Agarwal and Salman Sharma as the top repeat offenders", () => {
    const d = computeDashboard(input, LAST_30);
    expect(d.cooks.leaderboard.slice(0, 2).map((r) => r.cook_id).sort()).toEqual(["CK062", "CK080"]);
    expect(d.cooks.leaderboard[0].dropoutDays).toBe(15);
    expect(d.cooks.repeatOffenders.every((r) => r.dropoutDays >= 3)).toBe(true);
  });

  it("merges duplicate cook records in the leaderboard (Vijay Bhatt CK054 + CK084)", () => {
    const d = computeDashboard(input, LAST_30);
    expect(d.cooks.leaderboard.some((r) => r.cook_id === "CK084")).toBe(false);
    expect(d.cooks.duplicates.map((x) => x.canonical).sort()).toEqual(["CK011", "CK016", "CK036", "CK045", "CK054"]);
  });

  it("revenue lost is dropout + cancelled + refunded", () => {
    const d = computeDashboard(input, LAST_30);
    const l = d.orders.lostByCause;
    expect(d.orders.revenueLost).toBe(l.cook_dropout + l.cancelled + l.refunded);
    expect(d.orders.gmv).toBeGreaterThan(0);
  });

  it("flags past orders still open as stale", () => {
    const d = computeDashboard(input, LAST_30);
    const expected = data.orders.filter((o) => o.order_date < "2026-09-23" && statusBucket(o.status) === "open").length;
    expect(d.orders.staleOpen).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  });

  it("uses status_since for leave events (all three date formats)", () => {
    const d = computeDashboard(input, LAST_30);
    const ids = d.cooks.leaveEvents.map((e) => e.cook_id);
    expect(ids).toContain("CK089"); // 19-Sep-2026
    expect(ids).toContain("CK022"); // 11/09/2026
    expect(ids).toContain("CK030"); // 2026-09-20
    expect(ids).not.toContain("CK086"); // 23 Sep: today, outside the range
  });

  it("lists subscribers hit by 2+ dropouts as at risk", () => {
    const d = computeDashboard(input, LAST_30);
    expect(d.subscribers.atRisk.length).toBe(d.subscribers.repeatAffected);
    expect(d.subscribers.atRisk.every((s) => s.dropouts >= 2)).toBe(true);
    expect(d.subscribers.affected).toBeGreaterThan(d.subscribers.repeatAffected);
  });

  it("builds a city x week heatmap covering the whole range", () => {
    const d = computeDashboard(input, LAST_30);
    expect(d.heatmap.weeks[0]).toBe(weekStart("2026-08-24"));
    const total = d.heatmap.rows.flatMap((r) => r.cells).reduce((s, c) => s + c.dropouts, 0);
    expect(total).toBe(134);
  });
});

describe("filters", () => {
  it("city and meal filters narrow every section", () => {
    const d = computeDashboard(input, { ...LAST_30, city: "PUNE", meal: "lunch" });
    expect(d.cities.map((c) => c.city)).toEqual(["PUNE"]);
    expect(d.cooks.rows.every((r) => r.city === "PUNE")).toBe(true);
    expect(d.orders.dinner).toBe(0);
  });

  it("counts orders on dropouts logged today as cook dropouts", () => {
    const today = { from: "2026-09-23", to: "2026-09-23" };
    const lakshmi = data.orders.filter((o) => o.order_date === "2026-09-23" && o.cook_id === "CK086").map((o) => o.order_id);
    const d = computeDashboard(
      {
        ...input,
        events: [{
          id: "e1", cook_id: "CK086", event_date: "2026-09-23",
          reported_at: new Date("2026-09-23T06:52:00+05:30"), logged_at: new Date("2026-09-23T10:30:00+05:30"),
          affected_order_ids: lakshmi, people: 9,
          decisions: lakshmi.map((order_id, i) => ({ order_id, action: i === 0 ? "refund" : "reassign" })),
          messages: [],
        }],
      },
      today,
    );
    expect(d.headline.dropouts).toBe(9);
    expect(d.events.count).toBe(1);
    expect(d.events.avgDetectMinutes).toBe(218);
    expect(d.events.coverageRate).toBeCloseTo(8 / 9, 6);
    expect(d.cooks.counts.out_today).toBe(1);
  });
});
