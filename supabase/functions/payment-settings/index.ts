// Owner-only: save each restaurant's paybill or till and its Daraja credentials, and switch "Live payments" on or off.
// The credentials are write-only: they are stored where only server functions can read them and are never sent back.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const num = (v: unknown) => /^\d{5,7}$/.test(String(v ?? "").trim());
const clean = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max);

function complete(loc: any, sec: any) {
  return !!(loc?.pay_kind && loc?.pay_number && (loc.pay_kind !== "till" || loc.pay_store) && sec?.consumer_key && sec?.consumer_secret && sec?.passkey);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sb.auth.getUser(jwt);
    if (!u?.user) return json({ error: "Please sign in again." }, 401);
    const { data: me } = await sb.from("profiles").select("is_admin").eq("id", u.user.id).maybeSingle();
    if (!me?.is_admin) return json({ error: "Only the owner can change payment accounts." }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === "list") {
      const { data: locs } = await sb.from("locations").select("id,name,pay_kind,pay_number,pay_store,pay_account_ref,pay_live").order("sort_order");
      const { data: secs } = await sb.from("payment_secrets").select("location_id,consumer_key,consumer_secret,passkey");
      const out = (locs ?? []).map((l: any) => {
        const s = (secs ?? []).find((x: any) => x.location_id === l.id) ?? {};
        return { ...l, has_key: !!s.consumer_key, has_secret: !!s.consumer_secret, has_passkey: !!s.passkey, key_tail: s.consumer_key ? String(s.consumer_key).slice(-4) : null, ready: complete(l, s) };
      });
      return json({ ok: true, accounts: out });
    }

    const id = Number(body.location_id);
    const { data: loc } = await sb.from("locations").select("id,pay_kind,pay_number,pay_store,pay_live").eq("id", id).maybeSingle();
    if (!loc) return json({ error: "Restaurant not found." }, 404);
    const { data: secs0 } = await sb.from("payment_secrets").select("consumer_key,consumer_secret,passkey").eq("location_id", id).maybeSingle();

    if (action === "save") {
      const kind = body.pay_kind === "paybill" || body.pay_kind === "till" ? body.pay_kind : null;
      const number = clean(body.pay_number, 20), store = clean(body.pay_store, 20);
      if (number && !num(number)) return json({ error: "The paybill or till number should be 5 to 7 digits." }, 400);
      if (kind === "till" && store && !num(store)) return json({ error: "The store number should be 5 to 7 digits." }, 400);
      if (kind && !number) return json({ error: "Enter the paybill or till number." }, 400);
      const row = { pay_kind: kind, pay_number: kind ? number : null, pay_store: kind === "till" ? (store || null) : null, pay_account_ref: clean(body.pay_account_ref, 40) || "Order number" };
      const patch: Record<string, string> = {};
      for (const k of ["consumer_key", "consumer_secret", "passkey"]) { const v = clean(body[k], 300); if (v) patch[k] = v; }
      if (Object.keys(patch).length) await sb.from("payment_secrets").upsert({ location_id: id, ...patch, updated_at: new Date().toISOString() });
      const { data: secs1 } = await sb.from("payment_secrets").select("consumer_key,consumer_secret,passkey").eq("location_id", id).maybeSingle();
      const live = loc.pay_live && complete({ ...loc, ...row }, secs1);          // an incomplete account can never stay live
      await sb.from("locations").update({ ...row, pay_live: live }).eq("id", id);
      return json({ ok: true, ready: complete({ ...loc, ...row }, secs1), live });
    }

    if (action === "set_live") {
      const want = !!body.live;
      if (want && !complete(loc, secs0)) return json({ error: "Save the paybill or till number and all three Daraja credentials first." }, 400);
      await sb.from("locations").update({ pay_live: want }).eq("id", id);
      return json({ ok: true, live: want });
    }

    if (action === "clear_credentials") {
      await sb.from("payment_secrets").delete().eq("location_id", id);
      await sb.from("locations").update({ pay_live: false }).eq("id", id);
      return json({ ok: true });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
