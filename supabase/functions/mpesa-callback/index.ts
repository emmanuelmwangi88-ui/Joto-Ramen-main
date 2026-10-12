// Safaricom calls this URL after the customer accepts or rejects the STK prompt.
// It is public (no JWT) but needs the secret in ?s=... that only the STK function knows.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { parseCallback } from "./lib.ts";

const ack = () => new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), { headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get("MPESA_CALLBACK_SECRET");
  if (!secret || new URL(req.url).searchParams.get("s") !== secret) return new Response("Forbidden", { status: 403 });
  try {
    const cb = parseCallback(await req.json().catch(() => null));
    if (!cb) return ack();
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: order } = await sb.from("orders").select("id,total,payment_status").eq("mpesa_checkout_id", cb.checkoutId).maybeSingle();
    if (!order || order.payment_status === "paid") return ack();
    const pay = (fields: Record<string, unknown>) => sb.from("payments").update(fields).eq("checkout_id", cb.checkoutId);
    if (cb.resultCode === 0) {
      if (cb.amount !== undefined && Math.round(cb.amount) < Math.round(order.total)) {
        const note = `Paid KSh ${cb.amount} but the order total is KSh ${order.total}. Receipt ${cb.receipt ?? ""}`;
        await sb.from("orders").update({ payment_status: "failed", payment_note: note }).eq("id", order.id);
        await pay({ status: "failed", note, mpesa_receipt: cb.receipt ?? null });
      } else {
        const at = new Date().toISOString();
        await sb.from("orders").update({ payment_status: "paid", mpesa_receipt: cb.receipt ?? null, payment_note: null, paid_at: at }).eq("id", order.id);
        await pay({ status: "success", mpesa_receipt: cb.receipt ?? null, paid_at: at, note: null });
      }
    } else {
      const note = cb.resultDesc || "Payment was not completed";
      await sb.from("orders").update({ payment_status: "failed", payment_note: note }).eq("id", order.id);
      await pay({ status: "failed", note });
    }
  } catch (e) { console.error(e); }
  return ack();
});
