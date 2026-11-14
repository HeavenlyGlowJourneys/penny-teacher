// Privileged subscription mutations — teachers can read their own row via
// RLS but not write to it. These server functions verify the caller via
// requireSupabaseAuth, then use the admin client to update the row.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Mark the subscription as cancelled and schedule data deletion 30 days out.
 * The teacher retains access until current_period_end (route guard logic).
 */
export const scheduleCancellation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. Look up the teacher's PayFast token.
    const { data: sub, error: lookupErr } = await supabaseAdmin
      .from("subscriptions")
      .select("payfast_subscription_token, first_payment_completed")
      .eq("teacher_id", context.userId)
      .maybeSingle();
    if (lookupErr) throw new Error(lookupErr.message);
    if (!sub) throw new Error("No subscription found.");

    // 2. Cancel the recurring billing token at PayFast FIRST. We only
    //    skip the API call when there's no token to cancel (e.g. the
    //    first payment never completed, so PayFast never issued one).
    const token = sub.payfast_subscription_token;
    if (token && sub.first_payment_completed) {
      const { cancelPayfastSubscription } = await import("@/lib/payfast.server");
      try {
        await cancelPayfastSubscription(token);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown PayFast error";
        // Log for manual follow-up — DO NOT mark cancelled locally.
        try {
          await supabaseAdmin.from("webhook_logs").insert({
            payload: { teacher_id: context.userId, token } as Record<string, string>,
            verified: false,
            action_taken: `cancel_api_failed:${message.slice(0, 180)}`,
          });
        } catch (logErr) {
          console.error("[cancel] webhook_logs insert failed", logErr);
        }
        throw new Error(
          "We could not cancel your recurring billing at PayFast. Your subscription has NOT been cancelled. Please try again in a few minutes, or contact support so we can stop billing manually.",
        );
      }
    }

    // 3. Only after PayFast confirms, mark cancelled locally and schedule
    //    data deletion 30 days out.
    const deleteAt = new Date();
    deleteAt.setDate(deleteAt.getDate() + 30);

    const { error } = await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "cancelled",
        data_deletion_scheduled_at: deleteAt.toISOString(),
      })
      .eq("teacher_id", context.userId);
    if (error) throw new Error(error.message);

    // Best-effort cancellation email (idempotent per cancel event timestamp).
    try {
      const { data: userData } = await supabaseAdmin.auth.admin.getUserById(context.userId);
      const email = userData.user?.email;
      const { data: fresh } = await supabaseAdmin
        .from("subscriptions")
        .select("current_period_end")
        .eq("teacher_id", context.userId)
        .maybeSingle();
      if (email) {
        const { enqueueTransactionalTemplate } = await import("@/lib/email-send.server");
        await enqueueTransactionalTemplate({
          templateName: "subscription-cancelled",
          recipientEmail: email,
          idempotencyKey: `subscription-cancelled-${context.userId}-${deleteAt.toISOString().slice(0, 10)}`,
          templateData: { accessUntil: fresh?.current_period_end ?? undefined },
        });
      }
    } catch (mailErr) {
      console.error("[cancel] cancellation email failed", mailErr);
    }

    return { ok: true, dataDeletionScheduledAt: deleteAt.toISOString() };
  });
