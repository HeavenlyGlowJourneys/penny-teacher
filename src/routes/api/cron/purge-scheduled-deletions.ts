/**
 * Cron/manual job: purge learner data for subscriptions past data_deletion_scheduled_at.
 * Auth: Authorization Bearer = CRON_SECRET. The service-role key is not accepted.
 *
 * Deletes teacher-owned rows (classes cascade learners/assessments/marks, drafts, settings,
 * academic years). Keeps the auth user + subscription row, clearing the schedule and
 * marking status expired so the account can re-subscribe without orphan PII.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/cron/purge-scheduled-deletions")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const { authorizeInternalCron } = await import(
          "@/lib/internal-cron-auth.server"
        );
        const denied = authorizeInternalCron(request);
        if (denied) return denied;

        if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
          return Response.json({ error: "Server misconfigured" }, { status: 500 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const nowIso = new Date().toISOString();

        const { data: due, error: listErr } = await supabaseAdmin
          .from("subscriptions")
          .select("teacher_id, data_deletion_scheduled_at")
          .not("data_deletion_scheduled_at", "is", null)
          .lte("data_deletion_scheduled_at", nowIso)
          .limit(50);

        if (listErr) {
          return Response.json({ error: listErr.message }, { status: 500 });
        }

        const results: Array<{ teacherId: string; ok: boolean; detail?: string }> = [];

        for (const row of due ?? []) {
          const teacherId = row.teacher_id as string;
          try {
            await supabaseAdmin.from("ai_drafts").delete().eq("teacher_id", teacherId);
            await supabaseAdmin.from("import_logs").delete().eq("teacher_id", teacherId);
            await supabaseAdmin.from("classes").delete().eq("teacher_id", teacherId);
            await supabaseAdmin.from("academic_years").delete().eq("teacher_id", teacherId);
            await supabaseAdmin.from("teacher_settings").delete().eq("teacher_id", teacherId);

            const { error: subErr } = await supabaseAdmin
              .from("subscriptions")
              .update({
                data_deletion_scheduled_at: null,
                status: "expired",
                payfast_subscription_token: null,
              })
              .eq("teacher_id", teacherId);
            if (subErr) throw new Error(subErr.message);

            results.push({ teacherId, ok: true });
          } catch (err) {
            results.push({
              teacherId,
              ok: false,
              detail: err instanceof Error ? err.message : "purge_failed",
            });
          }
        }

        return Response.json({
          ok: true,
          scanned: due?.length ?? 0,
          purged: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
          results,
          ranAt: nowIso,
        });
      },
    },
  },
});
