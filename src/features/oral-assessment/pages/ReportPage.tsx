import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { OralAssessmentShell } from "@/features/oral-assessment/components/OralAssessmentShell";
import {
  awardFinalMark,
  getSessionReport,
  rescoreSession,
  type OralDimensionScores,
} from "@/features/oral-assessment/services/interview.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SessionReport } from "@/features/oral-assessment/types";

export function ReportPage({ sessionId }: { sessionId: string }) {
  const load = useServerFn(getSessionReport);
  const award = useServerFn(awardFinalMark);
  const rescore = useServerFn(rescoreSession);

  const [title, setTitle] = useState("");
  const [report, setReport] = useState<SessionReport | null>(null);
  const [score, setScore] = useState<{
    recommended_mark: number | null;
    confidence_score: number | null;
    final_mark: number | null;
    final_comment: string;
    suggested_final_comment: string;
    suggested_lecturer_feedback: string;
    strengths: string[];
    weaknesses: string[];
    evidence_summary: string[];
    rubric_breakdown: Record<string, number>;
    dimension_scores: OralDimensionScores;
    scoring_model_version: string | null;
  } | null>(null);
  const [meta, setMeta] = useState<{
    ai_model_version: string | null;
    engine_versions: Record<string, string>;
    generated_at: string;
  } | null>(null);
  const [finalMark, setFinalMark] = useState("");
  const [finalComment, setFinalComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [isLecturer, setIsLecturer] = useState(false);
  const [sessionStatus, setSessionStatus] = useState("");

  async function refreshReport() {
    const res = await load({ data: { sessionId } });
    setTitle(res.assessment.title);
    setReport(res.report);
    setScore(res.score);
    setMeta(res.reportMeta);
    setSessionStatus(res.session.status);
    setIsLecturer(res.isLecturer);
    if (res.score?.final_mark != null) setFinalMark(String(res.score.final_mark));
    else if (res.score?.recommended_mark != null) setFinalMark(String(res.score.recommended_mark));
    if (res.score?.final_comment) setFinalComment(res.score.final_comment);
    else if (res.score?.suggested_final_comment) setFinalComment(res.score.suggested_final_comment);
    return res;
  }

  useEffect(() => {
    void (async () => {
      try {
        await refreshReport();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not load report");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function onAward() {
    const mark = Number(finalMark);
    if (Number.isNaN(mark) || mark < 0 || mark > 100) {
      toast.error("Enter a mark between 0 and 100");
      return;
    }
    setBusy(true);
    try {
      await award({
        data: { sessionId, finalMark: mark, finalComment: finalComment.trim() || undefined },
      });
      toast.success("Final mark saved");
      await refreshReport();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save mark");
    } finally {
      setBusy(false);
    }
  }

  async function onRescore() {
    setBusy(true);
    try {
      const res = await rescore({ data: { sessionId } });
      toast.success(
        res.recommendedMark != null
          ? `Rescored · recommended ${res.recommendedMark}`
          : "Rescored",
      );
      await refreshReport();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rescore failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <OralAssessmentShell title="Report">
        <p className="text-sm text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </p>
      </OralAssessmentShell>
    );
  }

  return (
    <OralAssessmentShell title="Report">
      <nav className="mb-4 text-xs uppercase tracking-wide text-muted-foreground print:hidden">
        <Link to="/tools/oral-assessment" className="hover:text-foreground">
          Oral Assessment
        </Link>
        <span className="mx-2">/</span>
        <span>Report</span>
      </nav>

      <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-soft space-y-8">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Official assessment record
            {sessionStatus ? ` · ${sessionStatus}` : ""}
            {" · "}Recommended mark averages per-question scores (unanswered / “I don’t know” = 0)
          </p>
        </div>

        <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Recommended</p>
            <p className="text-2xl font-semibold">
              {score?.recommended_mark != null ? String(score.recommended_mark) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Confidence</p>
            <p className="text-2xl font-semibold">
              {score?.confidence_score != null ? `${score.confidence_score}%` : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Final mark</p>
            <p className="text-2xl font-semibold">
              {score?.final_mark != null ? String(score.final_mark) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Generated</p>
            <p className="text-sm font-medium">
              {meta?.generated_at
                ? new Date(meta.generated_at).toLocaleString()
                : report?.generatedAt
                  ? new Date(report.generatedAt).toLocaleString()
                  : "—"}
            </p>
          </div>
        </section>

        {(() => {
          const questionScores =
            report?.questionScores?.length
              ? report.questionScores
              : Array.isArray(
                    (score?.dimension_scores as { _questionScores?: unknown } | null)?._questionScores,
                  )
                ? ((
                    score?.dimension_scores as {
                      _questionScores: NonNullable<SessionReport["questionScores"]>;
                    }
                  )._questionScores ?? [])
                : [];
          if (!questionScores.length) return null;
          return (
            <section>
              <h2 className="font-display text-lg font-semibold">Marks per question</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Overall recommended mark = average of these scores.
              </p>
              <ul className="mt-3 space-y-2">
                {questionScores.map((q) => (
                  <li
                    key={q.code}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/60 px-4 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{q.label}</p>
                      {q.note ? (
                        <p className="text-xs text-muted-foreground mt-0.5">{q.note}</p>
                      ) : !q.answered ? (
                        <p className="text-xs text-muted-foreground mt-0.5">Unanswered</p>
                      ) : null}
                    </div>
                    <span
                      className={`font-semibold tabular-nums ${q.score === 0 ? "text-destructive" : ""}`}
                    >
                      {q.score}/{q.maxScore ?? 100}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })()}

        {report?.integrityFlags?.length ? (
          <section>
            <h2 className="font-display text-lg font-semibold">Lecturer review flags</h2>
            <ul className="mt-3 space-y-2">
              {report.integrityFlags.map((f, i) => (
                <li
                  key={`${f.flagType}-${i}`}
                  className="rounded-2xl border border-amber-200/80 bg-amber-50/50 p-3 text-sm"
                >
                  <p className="font-medium">{f.flagType.replace(/_/g, " ")}</p>
                  <p className="text-muted-foreground mt-1">{f.summary}</p>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Flags never accuse students of misconduct. They request lecturer judgement.
            </p>
          </section>
        ) : null}

        {score?.rubric_breakdown && Object.keys(score.rubric_breakdown).length > 0 ? (
          <section>
            <h2 className="font-display text-lg font-semibold">Rubric breakdown</h2>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {Object.entries(score.rubric_breakdown).map(([key, value]) => (
                <li
                  key={key}
                  className="flex items-center justify-between rounded-2xl border border-border/60 px-4 py-3 text-sm"
                >
                  <span className="capitalize text-muted-foreground">{key.replace(/_/g, " ")}</span>
                  <span className="font-semibold">{value}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {score?.evidence_summary?.length ? (
          <section>
            <h2 className="font-display text-lg font-semibold">Evidence</h2>
            <ul className="mt-3 list-disc pl-5 space-y-1 text-sm text-muted-foreground">
              {score.evidence_summary.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </section>
        ) : report?.evidenceSummary?.length ? (
          <section>
            <h2 className="font-display text-lg font-semibold">Evidence</h2>
            <ul className="mt-3 list-disc pl-5 space-y-1 text-sm text-muted-foreground">
              {report.evidenceSummary.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {(score?.strengths?.length ||
          score?.weaknesses?.length ||
          report?.strengths?.length ||
          report?.weaknesses?.length) ? (
          <section className="grid gap-6 sm:grid-cols-2">
            <div>
              <h2 className="font-display text-lg font-semibold">Strengths</h2>
              <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground space-y-1">
                {(score?.strengths?.length ? score.strengths : report?.strengths ?? []).map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="font-display text-lg font-semibold">Weaknesses</h2>
              <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground space-y-1">
                {(score?.weaknesses?.length ? score.weaknesses : report?.weaknesses ?? []).map(
                  (s) => (
                    <li key={s}>{s}</li>
                  ),
                )}
              </ul>
            </div>
          </section>
        ) : null}

        {score?.suggested_lecturer_feedback ? (
          <section>
            <h2 className="font-display text-lg font-semibold">Suggested lecturer feedback</h2>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {score.suggested_lecturer_feedback}
            </p>
          </section>
        ) : null}

        {report?.questionPathway?.length ? (
          <section>
            <h2 className="font-display text-lg font-semibold">Question pathway</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {report.questionPathway.join(" → ")}
            </p>
          </section>
        ) : null}

        {report?.transcript?.length ? (
          <section>
            <h2 className="font-display text-lg font-semibold">Transcript</h2>
            <div className="mt-3 space-y-3">
              {report.transcript.map((t) => (
                <div key={t.turnIndex} className="text-sm border-b border-border/40 pb-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t.role}
                    {t.questionCode ? ` · ${t.questionCode}` : ""}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap leading-relaxed">{t.content}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {isLecturer ? (
          <section className="space-y-3 print:hidden">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold">Award final mark</h2>
                <p className="text-sm text-muted-foreground">AI recommends. You award. Edit freely.</p>
              </div>
              {["completed", "failed", "abandoned"].includes(sessionStatus) ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void onRescore()}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Re-score with AI"}
                </Button>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="final-mark">Final mark</Label>
                <Input
                  id="final-mark"
                  type="number"
                  min={0}
                  max={100}
                  value={finalMark}
                  onChange={(e) => setFinalMark(e.target.value)}
                  disabled={busy}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="final-comment">Final comment</Label>
              <textarea
                id="final-comment"
                rows={3}
                value={finalComment}
                onChange={(e) => setFinalComment(e.target.value)}
                disabled={busy}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <Button disabled={busy} onClick={() => void onAward()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save final mark"}
            </Button>
          </section>
        ) : null}

        <section className="text-xs text-muted-foreground space-y-1">
          <p>AI model: {meta?.ai_model_version ?? report?.aiModelVersion ?? "—"}</p>
          <p>
            Engines:{" "}
            {meta?.engine_versions
              ? JSON.stringify(meta.engine_versions)
              : report?.engineVersions
                ? JSON.stringify(report.engineVersions)
                : "—"}
          </p>
          <p>Session: {sessionId}</p>
        </section>

        <div className="print:hidden">
          <Button variant="outline" onClick={() => window.print()}>
            Print / PDF
          </Button>
        </div>
      </div>
    </OralAssessmentShell>
  );
}
