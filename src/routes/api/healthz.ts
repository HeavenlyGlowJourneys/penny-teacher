/**
 * Liveness + config presence check for load balancers / uptime monitors.
 * Does not call external services. The response is status and time only:
 * it does not name settings or return secret values.
 */
import { createFileRoute } from "@tanstack/react-router";

const REQUIRED_SECRETS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "PAYFAST_MERCHANT_ID",
  "PAYFAST_MERCHANT_KEY",
  "PAYFAST_PASSPHRASE",
  "RESEND_API_KEY",
  "GEMINI_API_KEY",
] as const;

const RECOMMENDED_SECRETS = [
  "CRON_SECRET",
  "RESEND_WEBHOOK_SECRET",
  "SUPABASE_AUTH_HOOK_SECRET",
] as const;

/** Public health body. Callers only receive status and time. */
export function publicHealthPayload(input: {
  requiredReady: boolean;
  recommendedReady: boolean;
  now?: Date;
}): { httpStatus: number; body: { status: "ok" | "degraded" | "misconfigured"; time: string } } {
  const status = input.requiredReady
    ? input.recommendedReady
      ? "ok"
      : "degraded"
    : "misconfigured";
  return {
    httpStatus: input.requiredReady ? 200 : 503,
    body: {
      status,
      time: (input.now ?? new Date()).toISOString(),
    },
  };
}

export const Route = createFileRoute("/api/healthz")({
  server: {
    handlers: {
      GET: async () => {
        const missingRequired: string[] = REQUIRED_SECRETS.filter(
          (k) => !process.env[k]?.trim(),
        );

        const missingRecommended = RECOMMENDED_SECRETS.filter(
          (k) => !process.env[k]?.trim(),
        );

        const supabaseUrl =
          process.env.SUPABASE_URL?.trim() ||
          (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
        const publishable =
          process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ||
          (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim();

        if (!supabaseUrl) missingRequired.push("SUPABASE_URL");
        if (!publishable) missingRequired.push("SUPABASE_PUBLISHABLE_KEY");

        const report = publicHealthPayload({
          requiredReady: missingRequired.length === 0,
          recommendedReady: missingRecommended.length === 0,
        });

        return Response.json(report.body, { status: report.httpStatus });
      },
    },
  },
});
