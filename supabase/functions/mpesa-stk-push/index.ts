// Starts an M-Pesa STK Push (the payment prompt on the customer's phone) for one order.
// Secrets (Supabase dashboard > Edge Functions > Secrets):
//   MPESA_ENV (sandbox|production), MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY,
//   MPESA_CALLBACK_SECRET (any long random string), MPESA_TXN_TYPE (CustomerPayBillOnline | CustomerBuyGoodsOnline),
//   MPESA_PARTY_B (till number when using Buy Goods; defaults to MPESA_SHORTCODE)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { accountRef, darajaBase, normalizePhone, stkPassword, timestampEAT } from "./lib.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const env = Deno.env.toObject();
    const need = ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY", "MPESA_CALLBACK_SECRET"];
    if (need.some((k) => !env[k])) return json({ error: "M-Pesa is not set up yet. Please pay on delivery or at the till." }, 503);

    const { order_id, token, phone } = await req.json().catch(() => ({}));
    const msisdn = normalizePhone(phone);
    if (!msisdn) return json({ error: "Enter a valid Safaricom number, for example 0712345678." }, 400);
    if (!order_id || !token) return json({ error: "Order not found" }, 404);

    const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: order } = await sb.from("orders").select("id,total,status,payment_status,cancel_token,last_stk_at,location_id,created_at,source").eq("id", order_id).maybeSingle();
    if (!order || order.cancel_token !== token) return json({ error: "Order not found" }, 404);
    if (order.status === "cancelled") return json({ error: "This order was cancelled." }, 400);
    if (order.payment_status === "paid") return json({ ok: true, already: true });
    if (order.status === "pending" && order.source !== "waiter" && Date.now() - Date.parse(order.created_at) < 120_000) return json({ error: "Please wait until the 2-minute cancel window ends, then pay." }, 400);
    if (order.last_stk_at && Date.now() - Date.parse(order.last_stk_at) < 45_000) return json({ error: "A payment request was just sent. Please wait a moment before trying again." }, 429);
    if (!(order.total >= 1)) return json({ error: "Invalid order total" }, 400);

    const base = darajaBase(env.MPESA_ENV);
    const authRes = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: "Basic " + btoa(`${env.MPESA_CONSUMER_KEY}:${env.MPESA_CONSUMER_SECRET}`) } });
    const auth = await authRes.json().catch(() => ({}));
    if (!auth.access_token) { console.error("Daraja auth failed", authRes.status); return json({ error: "Could not reach M-Pesa. Please try again shortly." }, 502); }

    const ts = timestampEAT();
    const callback = `${env.SUPABASE_URL}/functions/v1/mpesa-callback?s=${encodeURIComponent(env.MPESA_CALLBACK_SECRET)}`;
    const res = await fetch(`${base}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: env.MPESA_SHORTCODE, Password: stkPassword(env.MPESA_SHORTCODE, env.MPESA_PASSKEY, ts), Timestamp: ts,
        TransactionType: env.MPESA_TXN_TYPE || "CustomerPayBillOnline", Amount: Math.round(order.total),
        PartyA: msisdn, PartyB: env.MPESA_PARTY_B || env.MPESA_SHORTCODE, PhoneNumber: msisdn,
        CallBackURL: callback, AccountReference: accountRef(order.id), TransactionDesc: "Joto Ramen order",
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (out.ResponseCode !== "0") { console.error("STK push refused", JSON.stringify(out)); return json({ error: out.errorMessage || out.ResponseDescription || "M-Pesa could not send the request." }, 502); }

    await sb.from("orders").update({ mpesa_checkout_id: out.CheckoutRequestID, mpesa_merchant_id: out.MerchantRequestID, payment_phone: msisdn, payment_note: null, last_stk_at: new Date().toISOString() }).eq("id", order.id);
    await sb.from("payments").insert({ order_id: order.id, location_id: order.location_id, method: "mpesa", amount: Math.round(order.total), status: "pending", phone: msisdn, checkout_id: out.CheckoutRequestID });
    return json({ ok: true, message: out.CustomerMessage || "Check your phone and enter your M-Pesa PIN." });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
