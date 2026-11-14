// Sends welcome + trial-started once after the teacher is verified and signed in.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const ensureOnboardingEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { enqueueTransactionalTemplate } = await import("@/lib/email-send.server");

    const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.getUserById(
      context.userId,
    );
    const user = userData?.user;
    const email = user?.email;
    if (userErr || !user || !email) {
      return { ok: true, skipped: "no_user" as const };
    }

    if (!user.email_confirmed_at) {
      return { ok: true, skipped: "unconfirmed" as const };
    }

    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("trial_ends_at, plan")
      .eq("teacher_id", context.userId)
      .maybeSingle();

    const teacherName =
      (user.user_metadata?.full_name as string | undefined)?.split(" ")[0] ||
      email.split("@")[0];

    await enqueueTransactionalTemplate({
      templateName: "welcome",
      recipientEmail: email,
      idempotencyKey: `welcome-${context.userId}`,
      templateData: { teacherName },
    });

    if (sub?.plan === "trial") {
      await enqueueTransactionalTemplate({
        templateName: "trial-started",
        recipientEmail: email,
        idempotencyKey: `trial-started-${context.userId}`,
        templateData: { trialEndsAt: sub.trial_ends_at ?? undefined },
      });
    }

    return { ok: true };
  });
