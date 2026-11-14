// Server function: build a signed PayFast checkout payload that the client
// can submit via a self-posting <form>. This is the LIVE PayFast process URL.
import { createServerFn } from "@tanstack/react-start";
import { getRequestHost } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { STANDARD_PLAN_PRICE } from "./plans";

const PAYFAST_PROCESS_URL = "https://www.payfast.co.za/eng/process";
const PAYFAST_FREQUENCY_MONTHLY = 3;

export const createPayfastCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const merchantId = process.env.PAYFAST_MERCHANT_ID?.trim();
    const merchantKey = process.env.PAYFAST_MERCHANT_KEY?.trim();
    const passphrase = process.env.PAYFAST_PASSPHRASE?.trim();
    if (!merchantId || !merchantKey) {
      throw new Error("PayFast credentials are not configured on the server.");
    }
    // Live PayFast accounts with a passphrase enabled must include it in the
    // signature — signing without it (or with a stale value) fails checkout.
    if (!passphrase) {
      throw new Error("PayFast passphrase is not configured on the server.");
    }

    const host = getRequestHost();
    const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
    const appUrl = `${proto}://${host}`;

    // Field order matters — PayFast hashes them in the order they appear
    // in the form. Keep this order stable.
    const fields: Record<string, string> = {
      merchant_id: merchantId,
      merchant_key: merchantKey,
      return_url: `${appUrl}/payment-success`,
      cancel_url: `${appUrl}/choose-plan?cancelled=true`,
      notify_url: `${appUrl}/api/public/payfast/webhook`,
      m_payment_id: `${context.userId}-${Date.now()}`,
      amount: STANDARD_PLAN_PRICE.toFixed(2),
      item_name: "Penny",
      custom_str1: context.userId,
      subscription_type: "1",
      billing_date: new Date().toISOString().slice(0, 10),
      recurring_amount: STANDARD_PLAN_PRICE.toFixed(2),
      frequency: String(PAYFAST_FREQUENCY_MONTHLY),
      cycles: "0",
    };

    // Load the signing helper lazily — keeps `crypto` out of any client
    // module graph that might transitively touch this file.
    const { generateSignature } = await import("./payfast.server");
    fields.signature = generateSignature(fields, passphrase);

    return {
      url: PAYFAST_PROCESS_URL,
      fields,
      amount: STANDARD_PLAN_PRICE.toFixed(2),
      planName: "Penny",
    };
  });
