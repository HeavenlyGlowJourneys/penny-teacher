/**
 * Per-teacher Gemini call budget (durable via Postgres).
 * Default: 60 calls / rolling hour.
 */
const DEFAULT_LIMIT = 60;
const DEFAULT_WINDOW_SECONDS = 60 * 60;

export async function assertAiRateLimit(teacherId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data, error } = await supabaseAdmin.rpc("check_ai_rate_limit", {
    p_teacher: teacherId,
    p_limit: DEFAULT_LIMIT,
    p_window_seconds: DEFAULT_WINDOW_SECONDS,
  });

  if (error) {
    // Fail open on infra errors so AI isn't hard-down if the migration
    // hasn't been applied yet — but log loudly.
    console.error("[ai] rate limit check failed", error);
    return;
  }

  if (data === false) {
    throw new Error(
      "You've used Penny's AI a lot in the last hour. Please wait a bit and try again.",
    );
  }
}
