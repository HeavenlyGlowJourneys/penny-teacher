// Private founder dashboard. Not linked from anywhere in the app; reached
// only by typing /founder in the URL. Access is enforced twice:
//   1. Client-side email allowlist in beforeLoad (silent redirect to
//      /dashboard for non-founders).
//   2. Server-side email allowlist inside getFounderStats (throws on
//      unauthorised callers even if the client gate is bypassed).
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getFounderStats, syncPayfastRecurringToStandard } from "@/lib/founder.functions";
import { isFounderEmail } from "@/lib/founder-access";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, Wrench } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { useState } from "react";

function isFounder(email: string | null | undefined) {
  return isFounderEmail(email);
}

export const Route = createFileRoute("/founder")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    if (!isFounder(data.user.email)) throw redirect({ to: "/dashboard" });
  },
  component: FounderDashboard,
});

type Tone = "healthy" | "watch" | "attention" | "neutral";

function toneClass(tone: Tone) {
  switch (tone) {
    case "healthy":
      return "text-emerald-600";
    case "watch":
      return "text-amber-600";
    case "attention":
      return "text-red-600";
    default:
      return "text-foreground";
  }
}

function Metric({
  label,
  value,
  tone = "neutral",
  sub,
}: {
  label: string;
  value: string | number;
  tone?: Tone;
  sub?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-3xl font-semibold ${toneClass(tone)}`}>{value}</div>
        {sub ? <div className="mt-2 text-xs text-muted-foreground space-y-0.5">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display text-2xl font-semibold tracking-tight mt-8 mb-3">{children}</h2>
  );
}

function FounderDashboard() {
  const navigate = useNavigate();
  const fetchStats = useServerFn(getFounderStats);
  const syncPayfast = useServerFn(syncPayfastRecurringToStandard);
  const [syncing, setSyncing] = useState(false);
  const query = useQuery({
    queryKey: ["founder-stats"],
    queryFn: () => fetchStats(),
    staleTime: 30_000,
  });

  const stats = query.data;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8 sm:py-12">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">
              Good morning, Shandre.
            </h1>
            <p className="text-muted-foreground mt-1">Here's how Penny is doing.</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${query.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={syncing}
              onClick={async () => {
                setSyncing(true);
                try {
                  const res = await syncPayfast({});
                  toast.success(
                    `PayFast sync done — ${res.updated} updated, ${res.failed} failed (of ${res.scanned}).`,
                  );
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "PayFast sync failed");
                } finally {
                  setSyncing(false);
                }
              }}
            >
              {syncing ? "Syncing…" : "Sync PayFast → R29"}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/tools" className="inline-flex items-center">
                <Wrench className="h-4 w-4 mr-2" />
                Tools
              </Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/dashboard" })}>
              Exit
            </Button>
          </div>
        </div>

        {query.isLoading ? (
          <p className="mt-12 text-muted-foreground">Loading…</p>
        ) : query.isError ? (
          <p className="mt-12 text-red-600">Could not load founder stats.</p>
        ) : stats ? (
          <>
            <SectionHeading>Business</SectionHeading>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Metric
                label="Real MRR"
                value={`R${stats.business.realMrr.toLocaleString()}/month`}
                tone="healthy"
              />
              <Metric
                label="Potential MRR"
                value={`R${stats.business.potentialMrr.toLocaleString()}/month`}
                tone="watch"
              />
              <Metric
                label="Paying teachers"
                value={stats.business.realPayingTeachers}
                tone={stats.business.realPayingTeachers > 0 ? "healthy" : "watch"}
              />
              <Metric
                label="Beta / manual accounts"
                value={stats.business.manualAccounts}
                tone={stats.business.manualAccounts > 0 ? "watch" : "neutral"}
              />
              <Metric
                label="Trial accounts"
                value={stats.business.trialAccounts}
                tone="watch"
              />
              <Metric
                label="Expired / cancelled"
                value={stats.business.expiredCancelled}
                tone={stats.business.expiredCancelled > 0 ? "attention" : "neutral"}
              />
            </div>

            <SectionHeading>Product</SectionHeading>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Metric label="Total classes" value={stats.product.classes} />
              <Metric label="Total learners" value={stats.product.learners} />
              <Metric label="Total assessments" value={stats.product.assessments} />
              <Metric label="Total marks captured" value={stats.product.marks} tone="healthy" />
              <Metric
                label="AI drafts generated"
                value={
                  stats.product.aiDrafts.report_comments +
                  stats.product.aiDrafts.parent_messages +
                  stats.product.aiDrafts.other
                }
                sub={
                  <>
                    <div>Report comments: {stats.product.aiDrafts.report_comments}</div>
                    <div>Parent messages: {stats.product.aiDrafts.parent_messages}</div>
                  </>
                }
              />
              <Metric
                label="Feedback received"
                value={Object.values(stats.product.feedback).reduce((a, b) => a + b, 0)}
                sub={
                  <>
                    <div>Bug: {stats.product.feedback.Bug}</div>
                    <div>Suggestion: {stats.product.feedback.Suggestion}</div>
                    <div>Feature request: {stats.product.feedback["Feature request"]}</div>
                    <div>Compliment: {stats.product.feedback.Compliment}</div>
                  </>
                }
              />
              <Metric
                label="School enquiries"
                value={stats.product.schoolEnquiries ?? "—"}
                sub={
                  stats.product.schoolEnquiries === null
                    ? "Not available in this environment"
                    : undefined
                }
              />
            </div>

            <SectionHeading>Recent</SectionHeading>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    New signups
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {stats.recent.signups.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No recent signups.</p>
                  ) : (
                    <ul className="space-y-2 text-sm">
                      {stats.recent.signups.map((s) => (
                        <li key={s.email + s.created_at} className="flex justify-between gap-3">
                          <span className="truncate">{s.email}</span>
                          <span className="text-muted-foreground shrink-0">
                            {formatDistanceToNow(new Date(s.created_at), { addSuffix: true })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Feedback submissions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {stats.recent.feedback.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No feedback yet.</p>
                  ) : (
                    <ul className="space-y-3 text-sm">
                      {stats.recent.feedback.map((f, i) => (
                        <li key={i} className="border-b last:border-0 pb-2 last:pb-0">
                          <div className="flex justify-between gap-3">
                            <span className="font-medium">{f.category}</span>
                            <span className="text-muted-foreground text-xs shrink-0">
                              {formatDistanceToNow(new Date(f.received_at), { addSuffix: true })}
                            </span>
                          </div>
                          <p className="text-muted-foreground mt-0.5">{f.message}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>

            <SectionHeading>System</SectionHeading>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Metric
                label="Webhook logs"
                value={stats.system.webhookTotal}
                sub={
                  <>
                    <div className="text-emerald-600">Verified: {stats.system.webhookVerified}</div>
                    <div className={stats.system.webhookFailed > 0 ? "text-red-600" : ""}>
                      Failed: {stats.system.webhookFailed}
                    </div>
                    <div>
                      Last:{" "}
                      {stats.system.lastWebhook
                        ? formatDistanceToNow(new Date(stats.system.lastWebhook), {
                            addSuffix: true,
                          })
                        : "—"}
                    </div>
                  </>
                }
              />
              <Metric
                label="Cancelled subscriptions"
                value={stats.system.failedPayments}
                tone={stats.system.failedPayments > 0 ? "attention" : "healthy"}
              />
              <Metric
                label="Signature errors"
                value={stats.system.signatureErrors}
                tone={stats.system.signatureErrors > 0 ? "attention" : "healthy"}
              />
              <Metric
                label="Subscriptions expiring soon"
                value={stats.system.expiringSoon}
                tone={stats.system.expiringSoon > 0 ? "watch" : "neutral"}
                sub="Within the next 7 days"
              />
            </div>

            <SectionHeading>Analytics</SectionHeading>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Metric
                label="Growth"
                value={stats.analytics.signupsMonth}
                tone={stats.analytics.signupsWeek > 0 ? "healthy" : "watch"}
                sub={
                  <>
                    <div>This week: {stats.analytics.signupsWeek} new signups</div>
                    <div>This month: {stats.analytics.signupsMonth} new signups</div>
                  </>
                }
              />
              <Metric
                label="Retention"
                value={stats.analytics.activeMonth}
                tone={stats.analytics.activeWeek > 0 ? "healthy" : "watch"}
                sub={
                  <>
                    <div>Active this week: {stats.analytics.activeWeek} teachers</div>
                    <div>Active this month: {stats.analytics.activeMonth} teachers</div>
                  </>
                }
              />
              <Metric
                label="Usage intensity"
                value={stats.analytics.avgMarksPerActiveTeacher}
                sub={
                  <>
                    <div>Avg marks / active teacher this month</div>
                    <div>
                      Avg assessments / class: {stats.analytics.avgAssessmentsPerClass}
                    </div>
                  </>
                }
              />
              <Metric
                label="AI usage this month"
                value={
                  stats.analytics.reportCommentsMonth + stats.analytics.parentMessagesMonth
                }
                sub={
                  <>
                    <div>Report comments: {stats.analytics.reportCommentsMonth}</div>
                    <div>Parent messages: {stats.analytics.parentMessagesMonth}</div>
                  </>
                }
              />
              <Metric
                label="Today"
                value={stats.analytics.marksToday}
                tone={stats.analytics.marksToday > 0 ? "healthy" : "neutral"}
                sub="Marks captured in the last 24 hours"
              />
              <Metric
                label="Churn signal"
                value={stats.analytics.churnRiskCount}
                tone={
                  stats.analytics.churnRiskCount === 0
                    ? "healthy"
                    : stats.analytics.churnRiskCount <= 3
                      ? "watch"
                      : "attention"
                }
                sub="Active teachers with no marks in 14 days"
              />
            </div>

            <p className="text-xs text-muted-foreground mt-8">
              Updated {formatDistanceToNow(new Date(stats.generatedAt), { addSuffix: true })}
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
