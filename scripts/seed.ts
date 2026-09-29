// Loads data/raw/* into Supabase.
//
//   npm run seed            # wipe and reload every table
//   npm run seed -- --dry-run   # transform only; print what would be loaded
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (never committed).
// Safe to re-run: reset_all() truncates everything first.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { transform } from "../src/lib/transform";

const RAW_DIR = join(__dirname, "..", "data", "raw");
const raw = (f: string) => readFileSync(join(RAW_DIR, f), "utf8");
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const data = transform({
    cooksCsv: raw("cooks.csv"),
    subscribersCsv: raw("subscribers.csv"),
    ordersCsv: raw("orders.csv"),
    whatsappTxt: raw("ops_whatsapp_export.txt"),
  });

  const summary = {
    cooks: data.cooks.length,
    duplicate_cooks: data.cooks.filter((c) => c.canonical_cook_id !== c.cook_id).length,
    subscribers: data.subscribers.length,
    duplicate_subscribers: data.subscribers.filter((s) => s.canonical_subscriber_id !== s.subscriber_id).length,
    orders: data.orders.length,
    whatsapp_messages: data.whatsapp.length,
    data_issues: data.issues.length,
  };
  console.table(summary);
  if (dryRun) return;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { error: resetError } = await db.rpc("reset_all");
  if (resetError) throw resetError;

  // Parents before children (FK order).
  const tables: [string, object[]][] = [
    ["cooks", data.cooks],
    ["subscribers", data.subscribers],
    ["orders", data.orders],
    ["whatsapp_messages", data.whatsapp],
    ["data_issues", data.issues],
  ];
  for (const [table, rows] of tables) {
    for (let i = 0; i < rows.length; i += 1000) {
      const { error } = await db.from(table).insert(rows.slice(i, i + 1000));
      if (error) throw new Error(`${table} rows ${i}-${i + 999}: ${error.message}`);
    }
    console.log(`  ${table}: ${rows.length}`);
  }
  console.log("Seed complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
