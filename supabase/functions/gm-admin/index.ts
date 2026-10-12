// gm-admin: the GM's tools. One Edge Function, four actions: "list" (who is banned), "kick", "ban", "unban".
//
// How it keeps itself safe (read this before changing it):
//  1. Every call must carry a signed-in user's token. The token is checked with Supabase (not just read), so it can't be faked.
//  2. That user must be a GM: a row in public.world_admins. Checked here, on the server, on every call. Hiding the button in the game is only for looks.
//  3. A GM can't kick/ban themselves or another GM.
//  4. The secret (service-role) key stays in this function. Supabase puts it in Deno.env for us; it is never sent to the browser or written in the repo.
//
// Optional secret: ALLOWED_ORIGINS = your site's address(es), comma separated (for example https://yourname.github.io). If set, only those sites may call this from a browser.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALLOWED = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// the secret key skips the row-level-security rules: that is exactly why it may only ever live here
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
async function isGM(userId: string) {
  const { data } = await admin.from("world_admins").select("user_id").eq("user_id", userId).maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return reply({ error: "POST only" }, 405, origin);

  try {
    // 1. who is calling? (Supabase checks the token's signature and expiry)
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
    if (whoErr || !who?.user) return reply({ error: "Sign in first" }, 401, origin);
    const me = who.user;

    // 2. are they a GM?
    if (!(await isGM(me.id))) return reply({ error: "GM only" }, 403, origin);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return reply({ error: "Bad request" }, 400, origin); }
    const action = String(body.action ?? "");

    // list: everyone who is banned or just kicked (old kicks are tidied away)
    if (action === "list") {
      const now = new Date().toISOString();
      await admin.from("world_bans").delete().not("until", "is", null).lt("until", now);
      const { data, error } = await admin.from("world_bans")
        .select("user_id,email,name,reason,kind,until,created_at").order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return reply({ bans: data ?? [] }, 200, origin);
    }

    if (action !== "kick" && action !== "ban" && action !== "unban") return reply({ error: "Unknown action" }, 400, origin);

    // who is it about?
    const userId = String(body.userId ?? "");
    if (!UUID.test(userId)) return reply({ error: "Bad user" }, 400, origin);
    const name = String(body.name ?? "").replace(/[\u0000-\u001f]/g, "").slice(0, 24);
    const reason = String(body.reason ?? "").replace(/[\u0000-\u001f]/g, "").slice(0, 200) || null;

    if (action !== "unban") {
      // 3. never yourself, never another GM
      if (userId === me.id) return reply({ error: "You can't remove yourself" }, 400, origin);
      if (await isGM(userId)) return reply({ error: "That person is a GM" }, 400, origin);
    }

    const { data: target, error: tErr } = await admin.auth.admin.getUserById(userId);
    if (tErr || !target?.user) return reply({ error: "No such user" }, 404, origin);
    const email = target.user.email ?? null;

    if (action === "unban") {
      const { error: dErr } = await admin.from("world_bans").delete().eq("user_id", userId);
      if (dErr) throw dErr;
      const { error: aErr } = await admin.auth.admin.updateUserById(userId, { ban_duration: "none" });
      if (aErr) throw aErr;
      return reply({ ok: true }, 200, origin);
    }

    // don't let a kick weaken a ban that is already in force
    const { data: old } = await admin.from("world_bans").select("kind,until").eq("user_id", userId).maybeSingle();
    const active = old && (old.until === null || new Date(old.until) > new Date());
    if (action === "kick" && active && old!.kind === "ban") return reply({ error: "Already banned" }, 409, origin);

    if (action === "kick") {
      // out now; can come back after a minute
      const until = new Date(Date.now() + 60_000).toISOString();
      const { error } = await admin.from("world_bans").upsert(
        { user_id: userId, email, name, reason, kind: "kick", banned_by: me.id, created_at: new Date().toISOString(), until },
        { onConflict: "user_id" });
      if (error) throw error;
      return reply({ ok: true }, 200, origin);
    }

    // ban: days = 0 means until a GM lifts it
    const days = Number(body.days ?? 0);
    if (!Number.isFinite(days) || days < 0 || days > 3650) return reply({ error: "Bad length" }, 400, origin);
    const until = days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
    const { error } = await admin.from("world_bans").upsert(
      { user_id: userId, email, name, reason, kind: "ban", banned_by: me.id, created_at: new Date().toISOString(), until },
      { onConflict: "user_id" });
    if (error) throw error;
    // also stop Supabase itself from signing them in or refreshing their session (their current token still works until it expires, about an hour)
    const { error: aErr } = await admin.auth.admin.updateUserById(userId, { ban_duration: days > 0 ? `${days * 24}h` : "876000h" });
    if (aErr) throw aErr;
    return reply({ ok: true }, 200, origin);
  } catch (e) {
    console.error("gm-admin", e);   // the details stay in the function's logs, not in the answer
    return reply({ error: "Something went wrong" }, 500, origin);
  }
});
