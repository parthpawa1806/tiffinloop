import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only client using the service role key. RLS blocks the public key entirely,
// so every read and write in the app must go through here (Server Components / Actions).
let client: SupabaseClient | undefined;

export function db(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}
