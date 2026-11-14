// Founder-only stats endpoint. Access is gated by an allowlist of email
// addresses; only those users receive aggregated data pulled with the
// service-role client (bypassing per-teacher RLS).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { STANDARD_PLAN_PRICE } from "@/lib/plans";
import { getFounderEmails, isFounderEmail } from "@/lib/founder-access";

export { getFounderEmails, isFounderEmail };

export const getFounderStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string } | null)?.email ?? null;
    if (!isFounderEmail(email)) {
      throw new Error("Forbidden");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // ---------- Business ----------
    const { data: subs } = await supabaseAdmin
      .from("subscriptions")
      .select("plan, status, current_period_end, payfast_subscription_token");

    const subsList = subs ?? [];
    let realPayingTeachers = 0;
    let manualAccounts = 0;
    let potentialStandardCount = 0;
    let trialAccounts = 0;
    let expiredCancelled = 0;
    let expiringSoon = 0;
    const soonThreshold = Date.now() + 7 * 24 * 60 * 60 * 1000;

    for (const s of subsList) {
      const plan = (s.plan ?? "").toLowerCase();
      const status = (s.status ?? "").toLowerCase();
      const hasToken = !!s.payfast_subscription_token;
      if (status === "active" && plan !== "trial") {
        if (hasToken) {
          realPayingTeachers += 1;
        } else {
          manualAccounts += 1;
        }
        potentialStandardCount += 1;
        const end = s.current_period_end ? new Date(s.current_period_end).getTime() : 0;
        if (end && end < soonThreshold) expiringSoon += 1;
      }
      if (status === "active" && plan === "trial") trialAccounts += 1;
      if (status === "expired" || status === "cancelled") expiredCancelled += 1;
    }

    const realMrr = realPayingTeachers * STANDARD_PLAN_PRICE;
    const potentialMrr = potentialStandardCount * STANDARD_PLAN_PRICE;

    // ---------- Product usage ----------
    const countOf = async (table: string) => {
      const { count } = await supabaseAdmin
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from(table as any)
        .select("*", { count: "exact", head: true });
      return count ?? 0;
    };

    const [classesCount, learnersCount, assessmentsCount, marksCount] = await Promise.all([
      countOf("classes"),
      countOf("learners"),
      countOf("assessments"),
      countOf("marks"),
    ]);

    const { data: drafts } = await supabaseAdmin.from("ai_drafts").select("draft_type");
    const draftCounts = { report_comments: 0, parent_messages: 0, other: 0 };
    for (const d of drafts ?? []) {
      const t = (d.draft_type ?? "").toLowerCase();
      if (t.includes("report")) draftCounts.report_comments += 1;
      else if (t.includes("parent")) draftCounts.parent_messages += 1;
      else draftCounts.other += 1;
    }

    const { data: feedback } = await supabaseAdmin
      .from("feedback_submissions")
      .select("category, message, received_at")
      .order("received_at", { ascending: false });

    const feedbackList = feedback ?? [];
    const feedbackCounts = { Bug: 0, Suggestion: 0, "Feature request": 0, Compliment: 0 } as Record<string, number>;
    for (const f of feedbackList) {
      const c = f.category ?? "";
      if (c in feedbackCounts) feedbackCounts[c] += 1;
    }

    // School enquiries live in a separate marketing project. Attempt read,
    // fall back to null on error so this dashboard still renders.
    let schoolEnquiriesCount: number | null = null;
    try {
      const { count, error } = await supabaseAdmin
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("school_enquiries" as any)
        .select("*", { count: "exact", head: true });
      if (!error) schoolEnquiriesCount = count ?? 0;
    } catch {
      schoolEnquiriesCount = null;
    }

    // ---------- Recent activity ----------
    const { data: recentUsersData } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 20,
    });
    const recentSignups = (recentUsersData?.users ?? [])
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5)
      .map((u) => ({ email: u.email ?? "(no email)", created_at: u.created_at }));

    const recentFeedback = feedbackList.slice(0, 5).map((f) => ({
      category: f.category ?? "Unknown",
      message: (f.message ?? "").slice(0, 100),
      received_at: f.received_at,
    }));

    // ---------- System ----------
    const { data: hooks } = await supabaseAdmin
      .from("webhook_logs")
      .select("verified, action_taken, received_at")
      .order("received_at", { ascending: false });

    const hookList = hooks ?? [];
    let hookVerified = 0;
    let hookFailed = 0;
    let failedPayments = 0;
    let signatureErrors = 0;
    for (const h of hookList) {
      if (h.verified) hookVerified += 1;
      else hookFailed += 1;
      if ((h.action_taken ?? "").startsWith("validate_failed")) failedPayments += 1;
      if ((h.action_taken ?? "") === "signature_mismatch") signatureErrors += 1;
    }
    const lastWebhook = hookList[0]?.received_at ?? null;

    // ---------- Analytics ----------
    const now = Date.now();
    const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
    const day = 24 * 60 * 60 * 1000;
    const since7d = iso(7 * day);
    const since14d = iso(14 * day);
    const since30d = iso(30 * day);
    const since24h = iso(1 * day);

    // Signups from auth.users
    const { data: allUsersPage } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    const allUsers = allUsersPage?.users ?? [];
    const signupsWeek = allUsers.filter(
      (u) => new Date(u.created_at).getTime() >= now - 7 * day,
    ).length;
    const signupsMonth = allUsers.filter(
      (u) => new Date(u.created_at).getTime() >= now - 30 * day,
    ).length;

    // Active teachers via marks
    const { data: marks7d } = await supabaseAdmin
      .from("marks")
      .select("teacher_id")
      .gte("created_at", since7d);
    const { data: marks30d } = await supabaseAdmin
      .from("marks")
      .select("teacher_id")
      .gte("created_at", since30d);
    const activeWeek = new Set((marks7d ?? []).map((m) => m.teacher_id)).size;
    const activeMonth = new Set((marks30d ?? []).map((m) => m.teacher_id)).size;
    const marksThisMonth = (marks30d ?? []).length;
    const avgMarksPerActiveTeacher =
      activeMonth > 0 ? Math.round(marksThisMonth / activeMonth) : 0;
    const avgAssessmentsPerClass =
      classesCount > 0 ? Math.round((assessmentsCount / classesCount) * 10) / 10 : 0;

    // AI usage this month
    const { data: aiMonth } = await supabaseAdmin
      .from("ai_drafts")
      .select("draft_type")
      .gte("created_at", since30d);
    let reportCommentsMonth = 0;
    let parentMessagesMonth = 0;
    for (const d of aiMonth ?? []) {
      const t = (d.draft_type ?? "").toLowerCase();
      if (t.includes("report")) reportCommentsMonth += 1;
      else if (t.includes("parent")) parentMessagesMonth += 1;
    }

    // Today's marks
    const { count: marksTodayCount } = await supabaseAdmin
      .from("marks")
      .select("*", { count: "exact", head: true })
      .gte("created_at", since24h);

    // Churn signal: active subs with no marks in 14 days
    const { data: marks14d } = await supabaseAdmin
      .from("marks")
      .select("teacher_id")
      .gte("created_at", since14d);
    const active14dTeachers = new Set((marks14d ?? []).map((m) => m.teacher_id));
    const { data: activeSubs } = await supabaseAdmin
      .from("subscriptions")
      .select("teacher_id")
      .eq("status", "active");
    const churnTeachers = new Set(
      (activeSubs ?? [])
        .map((s) => s.teacher_id)
        .filter((tid) => tid && !active14dTeachers.has(tid)),
    );
    const churnRiskCount = churnTeachers.size;

    return {
      business: {
        realPayingTeachers,
        manualAccounts,
        realMrr,
        potentialMrr,
        trialAccounts,
        expiredCancelled,
      },
      product: {
        classes: classesCount,
        learners: learnersCount,
        assessments: assessmentsCount,
        marks: marksCount,
        aiDrafts: draftCounts,
        feedback: feedbackCounts,
        schoolEnquiries: schoolEnquiriesCount,
      },
      recent: {
        signups: recentSignups,
        feedback: recentFeedback,
      },
      system: {
        webhookTotal: hookList.length,
        webhookVerified: hookVerified,
        webhookFailed: hookFailed,
        lastWebhook,
        failedPayments,
        signatureErrors,
        expiringSoon,
      },
      analytics: {
        signupsWeek,
        signupsMonth,
        activeWeek,
        activeMonth,
        avgMarksPerActiveTeacher,
        avgAssessmentsPerClass,
        reportCommentsMonth,
        parentMessagesMonth,
        marksToday: marksTodayCount ?? 0,
        churnRiskCount,
      },
      generatedAt: new Date().toISOString(),
    };
  });

/**
 * One-shot founder tool: push STANDARD_PLAN_PRICE onto every active PayFast
 * subscription token so renewals match the live R29 webhook check.
 */
export const syncPayfastRecurringToStandard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string } | null)?.email ?? null;
    if (!isFounderEmail(email)) {
      throw new Error("Forbidden");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { updatePayfastSubscriptionAmount } = await import("@/lib/payfast.server");
    const { STANDARD_PLAN_PRICE } = await import("@/lib/plans");

    const { data: rows, error } = await supabaseAdmin
      .from("subscriptions")
      .select("teacher_id, payfast_subscription_token, plan, status")
      .not("payfast_subscription_token", "is", null)
      .eq("status", "active")
      .neq("plan", "trial");
    if (error) throw new Error(error.message);

    const results: Array<{ teacherId: string; ok: boolean; detail?: string }> = [];
    for (const row of rows ?? []) {
      const token = row.payfast_subscription_token as string;
      const teacherId = row.teacher_id as string;
      try {
        await updatePayfastSubscriptionAmount(token, STANDARD_PLAN_PRICE);
        results.push({ teacherId, ok: true });
      } catch (err) {
        results.push({
          teacherId,
          ok: false,
          detail: err instanceof Error ? err.message : "update_failed",
        });
      }
    }

    return {
      ok: true,
      amount: STANDARD_PLAN_PRICE,
      scanned: rows?.length ?? 0,
      updated: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  });
