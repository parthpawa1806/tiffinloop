import { describe, expect, it } from "vitest";
import {
  findDuplicates,
  namesSimilar,
  normalizeCity,
  normalizePhone,
  normalizeStatus,
  parseDate,
  parseServes,
  parseWhatsAppExport,
} from "./normalize";

describe("normalizeCity", () => {
  it.each([
    ["Bengaluru", "BLR"], ["Bangalore", "BLR"], ["bangalore", "BLR"], ["Blr", "BLR"], ["BLR", "BLR"],
    ["Mumbai", "MUM"], ["MUM", "MUM"], ["Bombay", "MUM"],
    ["Pune", "PUNE"], ["PUNE", "PUNE"], ["pune", "PUNE"], [" pune ", "PUNE"],
  ])("%s -> %s", (raw, want) => expect(normalizeCity(raw)).toBe(want));

  it("returns null for unknown cities", () => expect(normalizeCity("Delhi")).toBeNull());
});

describe("normalizeStatus", () => {
  it.each([
    ["Delivered", "delivered"], ["DELIVERED", "delivered"], ["Completed", "delivered"],
    ["Pending", "pending"], ["In Progress", "in_progress"], ["in-progress", "in_progress"],
    ["CANCELLED", "cancelled"], ["Refunded", "refunded"],
    ["cook_dropout", "cook_dropout"], ["cook no show", "cook_dropout"], ["No Show", "cook_dropout"],
    ["Cook No-Show", "cook_dropout"],
    // Not an ordinary cancellation: the cook failed.
    ["Cancelled - Cook Unavailable", "cook_dropout"],
  ])("%s -> %s", (raw, want) => expect(normalizeStatus(raw)).toBe(want));

  it("flags unknown statuses instead of guessing", () => expect(normalizeStatus("lost")).toBe("unknown"));
});

describe("parseDate", () => {
  it("parses ISO", () => expect(parseDate("2026-09-23")).toEqual({ date: "2026-09-23", format: "iso" }));
  it("parses day-first slashes", () => expect(parseDate("23/09/2026")).toEqual({ date: "2026-09-23", format: "dmy_slash" }));
  it("treats ambiguous slashes as day-first", () => expect(parseDate("11/09/2026")?.date).toBe("2026-09-11"));
  it("parses 09-Sep-2026", () => expect(parseDate("09-Sep-2026")).toEqual({ date: "2026-09-09", format: "d_mon_y" }));
  it("parses 19-Sep-2026", () => expect(parseDate("19-Sep-2026")?.date).toBe("2026-09-19"));
  it("rejects impossible dates", () => expect(parseDate("31/02/2026")).toBeNull());
  it("rejects garbage", () => expect(parseDate("yesterday")).toBeNull());
});

describe("normalizePhone", () => {
  it.each([
    ["9812345678", "9812345678"],
    ["+91 98123 45678", "9812345678"],
    ["09812345678", "9812345678"],
    ["", null],
    ["12345", null],
    ["1234567890", null], // Indian mobiles start 6-9
  ])("%s -> %s", (raw, want) => expect(normalizePhone(raw)).toBe(want));
});

describe("parseServes", () => {
  it("parses combined diets", () =>
    expect(parseServes("Veg, Non-Veg")).toEqual({ veg: true, nonVeg: true, jain: false }));
  it("parses Jain", () => expect(parseServes("Veg, Jain")).toEqual({ veg: true, nonVeg: false, jain: true }));
});

describe("namesSimilar", () => {
  it("matches spelling variants", () => expect(namesSimilar("Tariq Hussain", "Tariq Husain")).toBe(true));
  it("does not match different people", () => expect(namesSimilar("Tariq Hussain", "Farah Gupta")).toBe(false));
});

describe("findDuplicates", () => {
  const base = { city: "BLR" as const, profileKey: "CK087|veg" };

  it("merges same phone with a spelling variant (Tariq)", () => {
    const { canonical } = findDuplicates([
      { ...base, id: "SUB0511", name: "Tariq Hussain", phone: "9812345678" },
      { ...base, id: "SUB0512", name: "Tariq Husain", phone: "9812345678" },
    ]);
    expect(canonical.get("SUB0512")).toBe("SUB0511");
  });

  it("does not merge a shared phone with an unrelated name", () => {
    const { canonical } = findDuplicates([
      { ...base, id: "A", name: "Ravi Kumar", phone: "9812345678" },
      { ...base, id: "B", name: "Sunita Kumar", phone: "9812345678" },
    ]);
    expect(canonical.get("B")).toBe("B");
  });

  it("merges same name when a phone is missing and the profile matches, keeping the record with a phone", () => {
    const { canonical } = findDuplicates([
      { ...base, id: "SUB0482", name: "Nisha Singh", phone: null },
      { ...base, id: "SUB0108", name: "Nisha Singh", phone: "9316489790" },
    ]);
    expect(canonical.get("SUB0482")).toBe("SUB0108");
  });

  it("does not merge same name with a different profile (Pooja Khan)", () => {
    const { canonical } = findDuplicates([
      { id: "SUB0160", name: "Pooja Khan", phone: "9693075205", city: "BLR", profileKey: "CK032|veg" },
      { id: "SUB0486", name: "Pooja Khan", phone: null, city: "BLR", profileKey: "CK010|jain" },
    ]);
    expect(canonical.get("SUB0486")).toBe("SUB0486");
  });

  it("does not merge same name in different cities (Salman Sharma)", () => {
    const { canonical } = findDuplicates([
      { id: "SUB0493", name: "Salman Sharma", phone: null, city: "PUNE", profileKey: "x" },
      { id: "SUB0518", name: "Salman Sharma", phone: "9820717556", city: "MUM", profileKey: "x" },
    ]);
    expect(canonical.get("SUB0493")).toBe("SUB0493");
  });

  it("does not merge same name with two different phones", () => {
    const { canonical } = findDuplicates([
      { ...base, id: "A", name: "Ravi Sharma", phone: "9800000001" },
      { ...base, id: "B", name: "Ravi Sharma", phone: "9800000002" },
    ]);
    expect(canonical.get("B")).toBe("B");
  });
});

describe("parseWhatsAppExport", () => {
  const text = [
    "23/09/26, 6:52 am - Priya (Ops): Lakshmi aunty called. Fever, not cooking today. Updated sheet",
    "23/09/26, 9:14 pm - Sunita Kulkarni: Bhaiya aaj nahi ho payega 🙏",
    "second line of the same message",
  ].join("\n");
  const msgs = parseWhatsAppExport(text);

  it("parses timestamps in IST", () => {
    expect(msgs[0].sentAt.toISOString()).toBe("2026-09-23T01:22:00.000Z");
    expect(msgs[1].sentAt.toISOString()).toBe("2026-09-23T15:44:00.000Z");
  });
  it("identifies ops senders", () => {
    expect(msgs[0].senderIsOps).toBe(true);
    expect(msgs[1].senderIsOps).toBe(false);
  });
  it("appends continuation lines", () => expect(msgs[1].body).toContain("second line"));
});
