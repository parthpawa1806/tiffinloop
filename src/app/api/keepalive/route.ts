import { db } from "@/lib/supabase";

// Called daily by a Vercel cron (vercel.json). Supabase pauses free-plan projects after a
// week without activity, which takes the whole app down; one tiny query a day prevents that.
export async function GET() {
  const { count, error } = await db().from("cooks").select("cook_id", { count: "exact", head: true });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 503 });
  return Response.json({ ok: true, cooks: count, at: new Date().toISOString() });
}
