// Server function that receives feedback from the in-app floating
// button, stores it in feedback_submissions, and enqueues a branded
// notification to the Penny team (in-process — no user-JWT email HTTP hop).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  category: z.enum(["Bug", "Suggestion", "Feature request", "Compliment"]),
  message: z.string().trim().min(10).max(4000),
  page: z.string().max(500).default("/"),
  browser: z.string().max(500).default("unknown"),
  plan: z.string().max(100).default("unknown"),
  appVersion: z.string().max(50).default("1.0.0"),
});

const NOTIFY_TO = "pennyteacherapp@gmail.com";

export const sendFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => InputSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("feedback_submissions").insert({
      teacher_id: context.userId,
      category: data.category,
      message: data.message,
      page: data.page,
      browser: data.browser,
      plan: data.plan,
      app_version: data.appVersion,
    });

    if (error) {
      throw new Error("Could not save feedback right now.");
    }

    // Best-effort notification — never block the user response on this.
    try {
      const { enqueueTransactionalTemplate } = await import("@/lib/email-send.server");
      await enqueueTransactionalTemplate({
        templateName: "feedback-notification",
        recipientEmail: NOTIFY_TO,
        idempotencyKey: `feedback-${context.userId}-${Date.now()}`,
        templateData: {
          category: data.category,
          page: data.page,
          plan: data.plan,
          browser: data.browser,
          appVersion: data.appVersion,
          message: data.message,
        },
      });
    } catch (err) {
      console.error("Feedback email notification failed", { error: err });
    }

    return { ok: true };
  });
