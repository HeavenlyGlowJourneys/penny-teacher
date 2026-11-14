// PayFast Instant Transaction Notification (ITN) handler.
//
// Lives under /api/public/* as a plain unauthenticated route — there's no
// site-wide auth gate to bypass on this Cloudflare deployment, but the path
// still signals "PayFast calls this directly, no browser session involved."
// Every protective check happens INSIDE the handler:
//   1. MD5 signature must match (using the passphrase)
//   2. Source IP is logged against PayFast's published ranges (best-effort)
//   3. We POST the raw body back to PayFast's /eng/query/validate endpoint
//      and require a "VALID" response
//   4. The gross amount must match the one flat R29/month price
//
// Only after all primary checks pass do we update public.subscriptions via
// the service-role client. Every call is recorded in public.webhook_logs.
import { createFileRoute } from "@tanstack/react-router";
import { STANDARD_PLAN_PRICE } from "@/lib/plans";

const PAYFAST_VALIDATE_URL = "https://www.payfast.co.za/eng/query/validate";

async function sendSubscriptionSuccessEmail(teacherId: string, renewsAt: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { enqueueTransactionalTemplate } = await import("@/lib/email-send.server");
    const { formatPriceCopy } = await import("@/lib/product-knowledge");
    const { data: userData } = await supabaseAdmin.auth.admin.getUserById(teacherId);
    const email = userData.user?.email;
    if (!email) return;
    await enqueueTransactionalTemplate({
      templateName: "subscription-successful",
      recipientEmail: email,
      idempotencyKey: `subscription-successful-${teacherId}-${renewsAt.slice(0, 10)}`,
      templateData: {
        planName: "Penny",
        amountLabel: formatPriceCopy(),
        renewsAt,
      },
    });
  } catch (err) {
    console.error("[payfast] subscription success email failed", err);
  }
}

export const Route = createFileRoute("/api/public/payfast/webhook")({
  // @ts-expect-error - server block is transformed by TanStack router plugin at build time
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const rawBody = await request.text();
        const params = new URLSearchParams(rawBody);
        const fields: Record<string, string> = {};
        for (const [k, v] of params) fields[k] = v;

        // Lazy-load server-only modules so they aren't accidentally bundled
        // into anything client-reachable.
        const { generateItnSignature, isPayfastIp } = await import("@/lib/payfast.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const logEvent = async (action: string, verified: boolean) => {
          try {
            await supabaseAdmin.from("webhook_logs").insert({
              payload: fields as Record<string, string>,
              verified,
              action_taken: action,
            });
          } catch (logErr) {
            // Never let logging failure mask the real outcome.
            console.error("[payfast] webhook_logs insert failed", logErr);
          }
        };

        try {
          // ── 1. Signature check ─────────────────────────────────────────
          const passphrase = process.env.PAYFAST_PASSPHRASE?.trim();
          const { timingSafeEqual } = await import("@/lib/crypto-equal.server");
          const received = (fields.signature ?? "").toLowerCase();
          const { signature: _omit, ...rest } = fields;
          const expected = generateItnSignature(rest, passphrase).toLowerCase();
          if (!received || !timingSafeEqual(received, expected)) {
            await logEvent(
              `signature_mismatch: expected=${expected.slice(0, 8)} received=${received.slice(0, 8)}`,
              false,
            );
            return new Response("invalid signature", { status: 400 });
          }

          // ── 2. IP allowlist (best-effort, advisory only) ───────────────
          const ip =
            request.headers.get("cf-connecting-ip") ||
            request.headers.get("x-real-ip") ||
            request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            "";
          if (ip && !isPayfastIp(ip)) {
            console.warn("[payfast] webhook from unexpected ip", ip);
          }

          // ── 3. Server validation POST back to PayFast ──────────────────
          const validateRes = await fetch(PAYFAST_VALIDATE_URL, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: rawBody,
          });
          const validateText = (await validateRes.text()).trim();
          if (validateText !== "VALID") {
            await logEvent(`validate_failed:${validateText.slice(0, 40)}`, false);
            return new Response("invalid", { status: 400 });
          }

          // ── 4. Extract our custom fields ───────────────────────────────
          const teacherId = fields.custom_str1;
          const paymentStatus = fields.payment_status; // COMPLETE | CANCELLED | FAILED
          const grossAmount = parseFloat(fields.amount_gross ?? fields.amount ?? "0");
          const token = fields.token ? fields.token : null;
          const pfPaymentId = (fields.pf_payment_id ?? "").trim();

          if (!teacherId) {
            await logEvent("missing_custom_fields", false);
            return new Response("ok", { status: 200 });
          }

          // Idempotency: PayFast retries ITNs. Never extend the period twice
          // for the same pf_payment_id.
          const { data: existing, error: lookupErr } = await supabaseAdmin
            .from("subscriptions")
            .select("id, first_payment_completed, last_payfast_payment_id")
            .eq("teacher_id", teacherId)
            .maybeSingle();
          if (lookupErr) throw lookupErr;

          if (
            pfPaymentId &&
            paymentStatus === "COMPLETE" &&
            existing?.last_payfast_payment_id === pfPaymentId
          ) {
            await logEvent(`duplicate:pf_payment_id:${pfPaymentId}`, true);
            return new Response("ok", { status: 200 });
          }

          // Secondary check via webhook_logs (covers first-payment insert races).
          if (pfPaymentId && paymentStatus === "COMPLETE") {
            const { data: priorPaid } = await supabaseAdmin
              .from("webhook_logs")
              .select("id")
              .eq("verified", true)
              .filter("payload->>pf_payment_id", "eq", pfPaymentId)
              .like("action_taken", "%:standard%")
              .limit(1)
              .maybeSingle();
            if (priorPaid) {
              await logEvent(`duplicate:pf_payment_id:${pfPaymentId}`, true);
              return new Response("ok", { status: 200 });
            }
          }

          if (paymentStatus === "COMPLETE") {
            // ── 5. Amount sanity check — one flat monthly price ─────────
            if (Math.abs(grossAmount - STANDARD_PLAN_PRICE) > 0.01) {
              await logEvent(
                `amount_mismatch:got=${grossAmount.toFixed(2)},expected=${STANDARD_PLAN_PRICE.toFixed(2)}`,
                false,
              );
              return new Response("ok", { status: 200 });
            }

            const now = new Date();
            const periodEnd = new Date(now);
            periodEnd.setMonth(periodEnd.getMonth() + 1);
            const idSuffix = pfPaymentId ? `:pf_${pfPaymentId}` : "";
            const paymentIdFields = pfPaymentId
              ? { last_payfast_payment_id: pfPaymentId }
              : {};

            if (!existing) {
              const { error: insErr } = await supabaseAdmin.from("subscriptions").insert({
                teacher_id: teacherId,
                plan: "standard",
                status: "active",
                current_period_start: now.toISOString(),
                current_period_end: periodEnd.toISOString(),
                payfast_subscription_token: token,
                first_payment_completed: true,
                ...paymentIdFields,
              });
              if (insErr) throw insErr;
              await logEvent(`created:standard${idSuffix}`, true);
              await sendSubscriptionSuccessEmail(teacherId, periodEnd.toISOString());
            } else {
              const wasFirstPayment = !existing.first_payment_completed;
              const { error: updErr } = await supabaseAdmin
                .from("subscriptions")
                .update({
                  plan: "standard",
                  status: "active",
                  current_period_start: now.toISOString(),
                  current_period_end: periodEnd.toISOString(),
                  first_payment_completed: true,
                  data_deletion_scheduled_at: null,
                  ...(token ? { payfast_subscription_token: token } : {}),
                  ...paymentIdFields,
                })
                .eq("teacher_id", teacherId);
              if (updErr) throw updErr;
              const action = existing.first_payment_completed ? "renewed" : "activated";
              await logEvent(`${action}:standard${idSuffix}`, true);
              if (wasFirstPayment) {
                await sendSubscriptionSuccessEmail(teacherId, periodEnd.toISOString());
              }
            }
          } else if (paymentStatus === "CANCELLED" || paymentStatus === "FAILED") {
            if (existing && existing.first_payment_completed) {
              const { error: updErr } = await supabaseAdmin
                .from("subscriptions")
                .update({ status: "expired" })
                .eq("teacher_id", teacherId);
              if (updErr) throw updErr;
              await logEvent(`marked_expired:${paymentStatus.toLowerCase()}`, true);
            } else {
              await logEvent(`ignored_failed_first_payment:${paymentStatus.toLowerCase()}`, true);
            }
          } else {
            await logEvent(`unhandled_status:${paymentStatus}`, true);
          }

          return new Response("ok", { status: 200 });
        } catch (err) {
          console.error("[payfast] webhook handler error", err);
          await logEvent(
            `error:${err instanceof Error ? err.message.slice(0, 120) : "unknown"}`,
            false,
          );
          return new Response("error", { status: 500 });
        }
      },
    },
  },
});
