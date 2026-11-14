import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { PrepCheckShell } from "@/features/prep-check/components/PrepCheckShell";
import { PrepCheckReportView } from "@/features/prep-check/reports/PrepCheckReportView";
import { getPrepCheckReview } from "@/features/prep-check/services/review.functions";
import { PrepCheckReportSchema, type PrepCheckReport } from "@/features/prep-check/types";

export function PrepCheckReportPage({ reviewId }: { reviewId: string }) {
  const load = useServerFn(getPrepCheckReview);
  const [report, setReport] = useState<PrepCheckReport | null>(null);
  const [title, setTitle] = useState("Review");
  const [workflow, setWorkflow] = useState("teacher_prep");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const row = (await load({ data: { reviewId } })) as Record<string, unknown>;
        setTitle(String(row.title ?? "Review"));
        setWorkflow(String(row.workflow ?? "teacher_prep"));
        if (row.status === "failed") {
          setError(String(row.error_message ?? "Review failed"));
          return;
        }
        const parsed = PrepCheckReportSchema.parse(row.report);
        setReport(parsed);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load review");
      }
    })();
  }, [load, reviewId]);

  return (
    <PrepCheckShell title="Prep Check">
      <div className="mb-4 print:hidden text-xs text-muted-foreground">
        <Link to="/tools/prep-check" className="hover:text-foreground">
          Prep Check
        </Link>
        <span className="mx-1.5">/</span>
        <Link to="/tools/prep-check/review" className="hover:text-foreground">
          Review
        </Link>
        <span className="mx-1.5">/</span>
        Report
      </div>
      {error ? (
        <div className="rounded-3xl bg-card p-6 shadow-soft text-sm text-muted-foreground">{error}</div>
      ) : report ? (
        <PrepCheckReportView
          report={report}
          title={title}
          workflowLabel={
            workflow === "subject_head_review" ? "Subject Head Review" : "Teacher Prep Check"
          }
        />
      ) : (
        <p className="text-sm text-muted-foreground">Loading report…</p>
      )}
    </PrepCheckShell>
  );
}
