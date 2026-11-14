// SERVER-ONLY helpers for PayFast. The .server.ts suffix keeps this out of
// any client bundle, so we can safely import `crypto` here.
import { createHash } from "crypto";

/** PHP-compatible urlencode: spaces as '+', uppercase hex. */
export function pfEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * Generate the PayFast MD5 signature.
 *
 * Build the string from non-empty fields in the order they appear in the
 * object (PayFast specifies "in the order in the attributes" — for the
 * outgoing checkout form we use a deterministic order; for ITN callbacks
 * we re-use the order POSTed by PayFast itself).
 *
 * The passphrase is appended at the end if configured.
 */
export function generateSignature(fields: Record<string, string>, passphrase?: string): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (k === "signature") continue;
    if (v === "" || v == null) continue;
    parts.push(`${k}=${pfEncode(String(v).trim())}`);
  }
  let str = parts.join("&");
  if (passphrase && passphrase.length > 0) {
    str += `&passphrase=${pfEncode(passphrase.trim())}`;
  }
  return createHash("md5").update(str).digest("hex");
}

/**
 * Generate the PayFast MD5 signature for INCOMING ITN callbacks.
 *
 * Unlike outgoing checkout signing, PayFast includes every posted field
 * (even empty ones) in the ITN signature calculation, in the order they
 * were POSTed, without trimming values. Only the `signature` field itself
 * is excluded. The passphrase is appended at the end if configured.
 */
export function generateItnSignature(
  fields: Record<string, string>,
  passphrase?: string,
): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (k === "signature") continue;
    parts.push(`${k}=${pfEncode(String(v ?? ""))}`);
  }
  let str = parts.join("&");
  if (passphrase && passphrase.length > 0) {
    str += `&passphrase=${pfEncode(passphrase.trim())}`;
  }
  return createHash("md5").update(str).digest("hex");
}

/**
 * Best-effort PayFast IP allowlist. Documented PayFast ranges (subject to
 * change). Signature verification + server validate-POST remain the primary
 * guards; a non-match here is logged but doesn't reject on its own.
 */
export function isPayfastIp(ip: string): boolean {
  if (!ip) return false;
  const set = new Set<string>([
    "144.126.193.139",
    // 197.97.145.144/28
    ...Array.from({ length: 16 }, (_, i) => `197.97.145.${144 + i}`),
    // 41.74.179.192/27
    ...Array.from({ length: 32 }, (_, i) => `41.74.179.${192 + i}`),
    // 102.216.36.0/28
    ...Array.from({ length: 16 }, (_, i) => `102.216.36.${i}`),
    // 102.216.36.128/28
    ...Array.from({ length: 16 }, (_, i) => `102.216.36.${128 + i}`),
  ]);
  return set.has(ip);
}

/**
 * Cancel a recurring billing token via PayFast's Subscriptions API.
 *
 * Endpoint: PUT https://api.payfast.co.za/subscriptions/{token}/cancel
 * Auth:     merchant-id, version, timestamp headers + MD5 signature
 *           computed over all header params (alphabetical) + passphrase.
 *
 * Throws on network failure or non-success response so the caller can
 * abort the local cancellation and log for manual follow-up.
 */
export async function cancelPayfastSubscription(token: string): Promise<{
  ok: true;
  response: unknown;
}> {
  const merchantId = process.env.PAYFAST_MERCHANT_ID?.trim();
  const passphrase = process.env.PAYFAST_PASSPHRASE?.trim();
  if (!merchantId) throw new Error("PAYFAST_MERCHANT_ID not configured");
  if (!token) throw new Error("Missing PayFast subscription token");

  const timestamp = new Date().toISOString();
  const version = "v1";

  // PayFast Subscriptions API: signature is MD5 of all params (headers +
  // body) sorted alphabetically by key, urlencoded PHP-style, with the
  // passphrase appended.
  const params: Record<string, string> = {
    "merchant-id": merchantId,
    timestamp,
    version,
  };
  const sortedKeys = Object.keys(params).sort();
  const parts = sortedKeys.map((k) => `${k}=${pfEncode(params[k]!.trim())}`);
  let sigStr = parts.join("&");
  if (passphrase && passphrase.length > 0) {
    sigStr += `&passphrase=${pfEncode(passphrase.trim())}`;
  }
  const signature = createHash("md5").update(sigStr).digest("hex");

  const url = `https://api.payfast.co.za/subscriptions/${encodeURIComponent(token)}/cancel`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "merchant-id": merchantId,
      version,
      timestamp,
      signature,
      accept: "application/json",
    },
  });

  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* leave as text */ }

  if (!res.ok) {
    throw new Error(
      `PayFast cancel failed (HTTP ${res.status}): ${typeof body === "string" ? body : JSON.stringify(body)}`,
    );
  }
  // PayFast wraps responses as { code, status, data }. Treat anything other
  // than status === "success" as a failure.
  if (
    body && typeof body === "object" && "status" in body &&
    (body as { status: unknown }).status !== "success"
  ) {
    throw new Error(`PayFast cancel rejected: ${JSON.stringify(body)}`);
  }
  return { ok: true, response: body };
}

/**
 * Update the recurring amount on an existing PayFast subscription token.
 *
 * Endpoint: PATCH https://api.payfast.co.za/subscriptions/{token}/update
 * Body:     amount (in CENTS, as an integer string)
 *
 * The signature is MD5 over all params (headers + body) sorted alphabetically
 * by key, PHP-urlencoded, with the passphrase appended.
 *
 * Throws on failure so the caller can abort the local plan-change and log.
 */
export async function updatePayfastSubscriptionAmount(
  token: string,
  amountRands: number,
): Promise<{ ok: true; response: unknown }> {
  const merchantId = process.env.PAYFAST_MERCHANT_ID?.trim();
  const passphrase = process.env.PAYFAST_PASSPHRASE?.trim();
  if (!merchantId) throw new Error("PAYFAST_MERCHANT_ID not configured");
  if (!token) throw new Error("Missing PayFast subscription token");
  if (!Number.isFinite(amountRands) || amountRands <= 0) {
    throw new Error("Invalid recurring amount");
  }

  const amountCents = Math.round(amountRands * 100).toString();
  const timestamp = new Date().toISOString();
  const version = "v1";

  // Sign over headers + body params combined.
  const params: Record<string, string> = {
    amount: amountCents,
    "merchant-id": merchantId,
    timestamp,
    version,
  };
  const sortedKeys = Object.keys(params).sort();
  const parts = sortedKeys.map((k) => `${k}=${pfEncode(params[k]!.trim())}`);
  let sigStr = parts.join("&");
  if (passphrase && passphrase.length > 0) {
    sigStr += `&passphrase=${pfEncode(passphrase.trim())}`;
  }
  const signature = createHash("md5").update(sigStr).digest("hex");

  const url = `https://api.payfast.co.za/subscriptions/${encodeURIComponent(token)}/update`;
  const body = new URLSearchParams({ amount: amountCents }).toString();
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "merchant-id": merchantId,
      version,
      timestamp,
      signature,
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* leave as text */ }

  if (!res.ok) {
    throw new Error(
      `PayFast update failed (HTTP ${res.status}): ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`,
    );
  }
  if (
    parsed && typeof parsed === "object" && "status" in parsed &&
    (parsed as { status: unknown }).status !== "success"
  ) {
    throw new Error(`PayFast update rejected: ${JSON.stringify(parsed)}`);
  }
  return { ok: true, response: parsed };
}

