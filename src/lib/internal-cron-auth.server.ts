/**
 * Auth for internal cron and queue HTTP triggers.
 *
 * Requires `Authorization: Bearer <CRON_SECRET>`.
 * The Supabase service-role key is not accepted as a bearer.
 * A missing secret and a wrong token both fail closed with 401.
 * The secret value is never logged or returned.
 */
import { timingSafeEqual } from "@/lib/crypto-equal.server";

export function authorizeInternalCron(request: Request): Response | null {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    console.error("[cron] Internal auth is not configured");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token || !timingSafeEqual(token, cronSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
