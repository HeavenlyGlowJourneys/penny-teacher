import type { PrepCheckReport } from "@/features/prep-check/types";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="break-inside-avoid mb-6">
      <h2 className="font-display text-lg font-semibold tracking-tight mb-2">{title}</h2>
      <div className="text-sm text-muted-foreground leading-relaxed space-y-2">{children}</div>
    </section>
  );
}

export function PrepCheckReportView({
  report,
  title,
  workflowLabel,
}: {
  report: PrepCheckReport;
  title: string;
  workflowLabel: string;
}) {
  return (
    <div className="prep-check-report rounded-3xl bg-card p-6 sm:p-8 shadow-soft print:shadow-none print:rounded-none">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6 print:mb-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{workflowLabel}</p>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mt-1">
            {title}
          </h1>
          <p className="mt-2 text-sm">
            <span className="font-medium text-foreground">{report.overallRating}</span>
            <span className="text-muted-foreground"> · Confidence {Math.round(report.confidence)}%</span>
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="print:hidden"
          onClick={() => window.print()}
        >
          Download PDF
        </Button>
      </div>

      <Section title="Executive summary">
        <p className="text-foreground">{report.executiveSummary}</p>
      </Section>

      <Section title="Strengths">
        <ul className="list-disc pl-5 space-y-1">
          {report.strengths.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </Section>

      <Section title="Areas for improvement">
        <ul className="list-disc pl-5 space-y-1">
          {report.areasForImprovement.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </Section>

      <Section title="Curriculum alignment">
        <p>{report.curriculumAlignment}</p>
      </Section>

      <Section title="Stage alignment">
        <p>{report.stageAlignment}</p>
        {report.pacingNotes ? <p className="mt-2">{report.pacingNotes}</p> : null}
      </Section>

      <Section title="Assessment review">
        <p>{report.assessmentReview}</p>
      </Section>

      {report.relationshipFindings?.length ? (
        <Section title="Cross-document findings">
          <ul className="space-y-3">
            {report.relationshipFindings.map((f, i) => (
              <li key={`${f.comparison}-${i}`} className="rounded-xl border border-border/50 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {f.comparison}
                  <span className="ml-2 normal-case tracking-normal">({f.severity})</span>
                </p>
                <p className="mt-1 text-foreground">{f.finding}</p>
                {f.evidence ? (
                  <p className="mt-1 text-xs text-muted-foreground">{f.evidence}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Teaching quality">
        <p>{report.teachingQuality}</p>
      </Section>

      <Section title="School priority alignment">
        <p>{report.schoolPriorityAlignment}</p>
      </Section>

      <Section title="Resource checklist">
        <ul className="space-y-2">
          {report.resourceChecklist.map((r) => (
            <li key={r.item} className="flex gap-2">
              <span className={r.present ? "text-emerald-600" : "text-amber-700"}>
                {r.present ? "✓" : "○"}
              </span>
              <span>
                <span className="text-foreground font-medium">{r.item}</span>
                {r.note ? <span className="text-muted-foreground"> — {r.note}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Cognitive analysis">
        <p>
          Observed L1 {report.cognitiveAnalysis.level1Pct}% / L2 {report.cognitiveAnalysis.level2Pct}% / L3{" "}
          {report.cognitiveAnalysis.level3Pct}% (targets {report.cognitiveAnalysis.targetLevel1Pct}/
          {report.cognitiveAnalysis.targetLevel2Pct}/{report.cognitiveAnalysis.targetLevel3Pct})
        </p>
        <p>{report.cognitiveAnalysis.commentary}</p>
        {report.cognitiveAnalysis.recommendations.length ? (
          <ul className="list-disc pl-5">
            {report.cognitiveAnalysis.recommendations.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : null}
      </Section>

      {report.missingResources.length ? (
        <Section title="Missing resources">
          <ul className="list-disc pl-5">
            {report.missingResources.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      {report.aiContentBalance ? (
        <Section title="AI content balance">
          <p>{report.aiContentBalance}</p>
        </Section>
      ) : null}

      <Section title="Next steps">
        <ol className="list-decimal pl-5 space-y-1">
          {report.nextSteps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
