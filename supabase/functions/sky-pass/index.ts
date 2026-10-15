// sky-pass: the keeper's friends may use the Sky Garden beam even below level 99.
// Two actions: "status" (am I already a friend?) and "try" (here is my guess at the secret).
//
// How it keeps itself safe (read this before changing it):
//  1. The secret is NEVER in the page or in the repo. It lives only in this function's secrets: SKY_PASS (set it in the Supabase dashboard,
//     Edge Functions > Secrets). It is compared here, on the server. It is a date typed as digits, with or without slashes or dashes (only the digits count).
//  2. Every call must carry a signed-in user's token, and that token is checked with Supabase (not just read).
//  3. Guessing is slowed down: 5 wrong tries an hour, and 30 wrong tries in all locks that account out for good (a GM can reset the row).
//  4. The answer never says how close a guess was, and a guess is never written to a log or to the table.
//  5. The table (public.sky_guests) has row-level security on and no policies, so nobody can read or write it from a browser; only this function can.
//
// Optional secret: ALLOWED_ORIGINS = your site's address(es), comma separated, so only those sites may call this from a browser.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = (Deno.env.get("SKY_PASS") ?? "").replace(/\D/g, "");
const ALLOWED = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const PER_HOUR = 5, IN_ALL = 30, HOUR = 3_600_000;

function cors(origin: string | null) {
  const allow = ALLOWED.length ? (origin && ALLOWED.includes(origin) ? origin : ALLOWED[0]) : "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function reply(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });
}
async function sha(s: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}
// compare two hashes without stopping at the first difference
function same(a: Uint8Array, b: Uint8Array) {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.min(a.length, b.length); i++) d |= a[i] ^ b[i];
  return d === 0;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405, origin);
  try {
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
    if (whoErr || !who?.user) return reply({ error: "Sign in first" }, 401, origin);
    const me = who.user.id;

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return reply({ error: "Bad request" }, 400, origin); }
    const action = String(body.action ?? "");

    const { data: row } = await admin.from("sky_guests").select("granted,tries,total_tries,window_start").eq("user_id", me).maybeSingle();
    if (action === "status") return reply({ granted: !!row?.granted }, 200, origin);
    if (action !== "try") return reply({ error: "Bad request" }, 400, origin);
    if (row?.granted) return reply({ ok: true }, 200, origin);
    if (!SECRET) return reply({ error: "Not quite" }, 403, origin);   // (no secret set yet: nobody gets in)

    const now = Date.now();
    if ((row?.total_tries ?? 0) >= IN_ALL) return reply({ error: "Locked" }, 429, origin);
    const fresh = !row || now - new Date(row.window_start).getTime() > HOUR;
    const tries = fresh ? 0 : row!.tries;
    if (tries >= PER_HOUR) return reply({ error: "Too many tries. Try again in an hour" }, 429, origin);

    // count this try BEFORE comparing, so two quick calls can't both slip through
    const guess = String(body.guess ?? "").slice(0, 40).replace(/\D/g, "");
    const total = (row?.total_tries ?? 0) + 1;
    const { error: upErr } = await admin.from("sky_guests").upsert(
      { user_id: me, granted: false, tries: tries + 1, total_tries: total, window_start: fresh ? new Date(now).toISOString() : row!.window_start, updated_at: new Date(now).toISOString() },
      { onConflict: "user_id" });
    if (upErr) throw upErr;

    if (guess.length === SECRET.length && same(await sha(guess), await sha(SECRET))) {
      const { error } = await admin.from("sky_guests").update({ granted: true, tries: 0, updated_at: new Date().toISOString() }).eq("user_id", me);
      if (error) throw error;
      return reply({ ok: true }, 200, origin);
    }
    return reply({ error: "Not quite" }, 403, origin);
  } catch (e) {
    console.error("sky-pass", (e as Error)?.message ?? "error");   // (never the guess)
    return reply({ error: "Something went wrong" }, 500, origin);
  }
});
