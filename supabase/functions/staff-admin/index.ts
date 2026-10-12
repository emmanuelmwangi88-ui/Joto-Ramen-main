// Lets the OWNER create and manage the login of each restaurant's admin (no emails are sent).
// A restaurant admin sees and manages only their own restaurant. Called from Admin > Restaurant admins.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const validEmail = (e: unknown) => typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim()) && e.length <= 120;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sb.auth.getUser(jwt);
    if (!u?.user) return json({ error: "Please sign in again." }, 401);
    const { data: me } = await sb.from("profiles").select("is_admin").eq("id", u.user.id).maybeSingle();
    if (!me?.is_admin) return json({ error: "Only the owner can manage restaurant admins." }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === "create") {
      const email = String(body.email ?? "").trim().toLowerCase(), name = String(body.name ?? "").trim(), password = String(body.password ?? "");
      if (!validEmail(email)) return json({ error: "Enter a valid email address." }, 400);
      if (name.length < 2 || name.length > 60) return json({ error: "Enter the person's name." }, 400);
      if (password.length < 8) return json({ error: "The password must be at least 8 characters." }, 400);
      const { data: loc } = await sb.from("locations").select("id").eq("id", body.location_id).maybeSingle();
      if (!loc) return json({ error: "Choose the restaurant this admin runs." }, 400);
      const { data: created, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
      if (error || !created?.user) {
        const msg = String(error?.message ?? "");
        return json({ error: /already|registered|exists/i.test(msg) ? "That email already has an account. Use a different email." : "Could not create the account." }, 400);
      }
      await sb.from("profiles").update({ is_manager: true, is_staff: false, is_active: true, location_id: loc.id, name }).eq("id", created.user.id);
      return json({ ok: true, id: created.user.id });
    }

    const target = String(body.user_id ?? "");
    if (!target) return json({ error: "Missing user" }, 400);
    if (target === u.user.id) return json({ error: "You cannot change your own account here." }, 400);
    const { data: t } = await sb.from("profiles").select("is_admin,is_manager").eq("id", target).maybeSingle();
    if (!t) return json({ error: "User not found" }, 404);
    if (t.is_admin) return json({ error: "Owner accounts cannot be changed here." }, 400);
    if (!t.is_manager) return json({ error: "That account is not a restaurant admin." }, 400);

    if (action === "set_active") {
      const active = !!body.active;
      const { error } = await sb.auth.admin.updateUserById(target, { ban_duration: active ? "none" : "876000h" });
      if (error) return json({ error: "Could not update the account." }, 400);
      await sb.from("profiles").update({ is_active: active }).eq("id", target);
      return json({ ok: true });
    }
    if (action === "reset_password") {
      const password = String(body.password ?? "");
      if (password.length < 8) return json({ error: "The password must be at least 8 characters." }, 400);
      const { error } = await sb.auth.admin.updateUserById(target, { password });
      if (error) return json({ error: "Could not change the password." }, 400);
      return json({ ok: true });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
