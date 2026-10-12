// Pure helpers for the Daraja (M-Pesa) STK Push. No imports, so they can be tested in Node.

/** Accepts 0712345678, 712345678, +254712345678, 254712345678 (also 01xx numbers). Returns 2547XXXXXXXX or null. */
export function normalizePhone(input: unknown): string | null {
  const d = String(input ?? "").replace(/\D/g, "");
  let n = d;
  if (/^0[17]\d{8}$/.test(d)) n = "254" + d.slice(1);
  else if (/^[17]\d{8}$/.test(d)) n = "254" + d;
  return /^254[17]\d{8}$/.test(n) ? n : null;
}

/** Daraja timestamp YYYYMMDDHHmmss in Nairobi time (UTC+3). */
export function timestampEAT(date: Date = new Date()): string {
  return new Date(date.getTime() + 3 * 3600 * 1000).toISOString().replace(/\D/g, "").slice(0, 14);
}

export function stkPassword(shortcode: string, passkey: string, timestamp: string): string {
  return btoa(`${shortcode}${passkey}${timestamp}`);
}

export function darajaBase(env?: string): string {
  return String(env ?? "sandbox").toLowerCase() === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
}

/** AccountReference is limited to 12 characters. */
export function accountRef(orderId: number | string): string {
  return `JOTO${orderId}`.slice(0, 12);
}

export interface Callback { checkoutId: string; merchantId: string; resultCode: number; resultDesc: string; amount?: number; receipt?: string; phone?: string; }

/** Reads Safaricom's STK callback body. Returns null when the shape is not recognised. */
export function parseCallback(payload: any): Callback | null {
  const cb = payload?.Body?.stkCallback;
  if (!cb || typeof cb.CheckoutRequestID !== "string") return null;
  const items: Array<{ Name: string; Value: unknown }> = cb.CallbackMetadata?.Item ?? [];
  const get = (n: string) => items.find((i) => i.Name === n)?.Value;
  return {
    checkoutId: cb.CheckoutRequestID,
    merchantId: String(cb.MerchantRequestID ?? ""),
    resultCode: Number(cb.ResultCode),
    resultDesc: String(cb.ResultDesc ?? ""),
    amount: get("Amount") === undefined ? undefined : Number(get("Amount")),
    receipt: get("MpesaReceiptNumber") === undefined ? undefined : String(get("MpesaReceiptNumber")),
    phone: get("PhoneNumber") === undefined ? undefined : String(get("PhoneNumber")),
  };
}
