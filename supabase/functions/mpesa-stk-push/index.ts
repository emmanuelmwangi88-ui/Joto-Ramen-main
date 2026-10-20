// Starts an M-Pesa STK Push (the payment prompt on the customer's phone) for one order.
//
// Two modes, chosen per restaurant:
//   DEMO  (default): uses the shared test account from the Edge Function secrets below. No real money moves.
//   LIVE: used only when the restaurant has "Live payments" switched on in Admin > Payment accounts. It then charges
//         that restaurant's own paybill or till with the credentials saved for it (never exposed to the browser).
//
// Secrets for DEMO mode (Supabase dashboard > Edge Functions > Secrets):
//   MPESA_ENV (sandbox|production), MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY,
//   MPESA_CALLBACK_SECRET (any long random string, needed in both modes), MPESA_TXN_TYPE, MPESA_PARTY_B
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { accountRef, darajaBase, normalizePhone, stkPassword, timestampEAT } from "./lib.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

interface Cfg { mode: "demo" | "live"; base: string; key: string; secret: string; passkey: string; shortcode: string; txn: string; partyB: string; }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const env = Deno.env.toObject();
    if (!env.MPESA_CALLBACK_SECRET) return json({ error: "M-Pesa is not set up yet. Please pay at the restaurant or on delivery." }, 503);

    const { order_id, token, phone } = await req.json().catch(() => ({}));
    const msisdn = normalizePhone(phone);
    if (!msisdn) return json({ error: "Enter a valid Safaricom number, for example 0712345678." }, 400);
    if (!order_id || !token) return json({ error: "Order not found" }, 404);

    const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: order } = await sb.from("orders").select("id,total,status,payment_status,cancel_token,last_stk_at,location_id,created_at,source").eq("id", order_id).maybeSingle();
    if (!order || order.cancel_token !== token) return json({ error: "Order not found" }, 404);
    if (order.status === "cancelled") return json({ error: "This order was cancelled." }, 400);
    if (order.payment_status === "paid") return json({ ok: true, already: true });
    const { data: st } = await sb.from("settings").select("value").eq("key", "cancel_seconds").maybeSingle();
    const cancelMs = Math.min(300, Math.max(15, parseInt(st?.value ?? "80", 10) || 80)) * 1000;   // same setting the database uses
    if (order.status === "pending" && Date.now() - Date.parse(order.created_at) < cancelMs) return json({ error: "Please wait until the cancel window ends, then pay." }, 400);
    if (order.last_stk_at && Date.now() - Date.parse(order.last_stk_at) < 45_000) return json({ error: "A payment request was just sent. Please wait a moment before trying again." }, 429);
    if (!(order.total >= 1)) return json({ error: "Invalid order total" }, 400);

    // which account do we charge?
    const { data: loc } = await sb.from("locations").select("pay_kind,pay_number,pay_store,pay_live").eq("id", order.location_id).maybeSingle();
    let cfg: Cfg;
    if (loc?.pay_live) {
      const { data: sec } = await sb.from("payment_secrets").select("consumer_key,consumer_secret,passkey").eq("location_id", order.location_id).maybeSingle();
      const till = loc.pay_kind === "till";
      if (!sec?.consumer_key || !sec.consumer_secret || !sec.passkey || !loc.pay_kind || !loc.pay_number || (till && !loc.pay_store))
        return json({ error: "This restaurant's M-Pesa is not fully set up yet. Please pay at the restaurant or on delivery." }, 503);
      cfg = { mode: "live", base: darajaBase("production"), key: sec.consumer_key, secret: sec.consumer_secret, passkey: sec.passkey,
              shortcode: till ? loc.pay_store : loc.pay_number, txn: till ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline", partyB: loc.pay_number };
    } else {
      const need = ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY"];
      if (need.some((k) => !env[k])) return json({ error: "M-Pesa is not set up yet. Please pay at the restaurant or on delivery." }, 503);
      cfg = { mode: "demo", base: darajaBase(env.MPESA_ENV), key: env.MPESA_CONSUMER_KEY, secret: env.MPESA_CONSUMER_SECRET, passkey: env.MPESA_PASSKEY,
              shortcode: env.MPESA_SHORTCODE, txn: env.MPESA_TXN_TYPE || "CustomerPayBillOnline", partyB: env.MPESA_PARTY_B || env.MPESA_SHORTCODE };
    }

    const authRes = await fetch(`${cfg.base}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: "Basic " + btoa(`${cfg.key}:${cfg.secret}`) } });
    const auth = await authRes.json().catch(() => ({}));
    if (!auth.access_token) { console.error("Daraja auth failed", cfg.mode, authRes.status); return json({ error: "Could not reach M-Pesa. Please try again shortly." }, 502); }

    const ts = timestampEAT();
    const callback = `${env.SUPABASE_URL}/functions/v1/mpesa-callback?s=${encodeURIComponent(env.MPESA_CALLBACK_SECRET)}`;
    const res = await fetch(`${cfg.base}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: cfg.shortcode, Password: stkPassword(cfg.shortcode, cfg.passkey, ts), Timestamp: ts,
        TransactionType: cfg.txn, Amount: Math.round(order.total),
        PartyA: msisdn, PartyB: cfg.partyB, PhoneNumber: msisdn,
        CallBackURL: callback, AccountReference: accountRef(order.id), TransactionDesc: "Joto Ramen order",
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (out.ResponseCode !== "0") { console.error("STK push refused", cfg.mode, JSON.stringify(out)); return json({ error: out.errorMessage || out.ResponseDescription || "M-Pesa could not send the request." }, 502); }

    await sb.from("orders").update({ mpesa_checkout_id: out.CheckoutRequestID, mpesa_merchant_id: out.MerchantRequestID, payment_phone: msisdn, payment_note: null, last_stk_at: new Date().toISOString() }).eq("id", order.id);
    await sb.from("payments").insert({ order_id: order.id, location_id: order.location_id, method: "mpesa", amount: Math.round(order.total), status: "pending", phone: msisdn, checkout_id: out.CheckoutRequestID });
    return json({ ok: true, mode: cfg.mode, message: out.CustomerMessage || "Check your phone and enter your M-Pesa PIN." });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
