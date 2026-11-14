import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/penny/AppShell";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useCurrentAcademicYear, useTermPeriods } from "@/hooks/use-academic-year";

export const Route = createFileRoute("/_authenticated/term-marks/$classId")({
  head: () => ({ meta: [{ title: "Term marks – Penny" }] }),
  component: TermMarksPage,
});

type AssessmentRow = {
  id: string;
  name: string;
  category: string | null;
  subject: string | null;
  total_marks: number;
  weighting: number | null;
  term_period_id: string | null;
};

type LearnerRow = { id: string; name: string };

type MarkRow = {
  learner_id: string;
  assessment_id: string;
  mark: number | null;
  status: string;
};

function TermMarksPage() {
  const { classId } = Route.useParams();
  const { current } = useCurrentAcademicYear();
  const { data: periods = [] } = useTermPeriods(current?.id);

  const [periodId, setPeriodId] = useState<string | "">("");
  const [subject, setSubject] = useState<string>("all");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const { data: cls } = useQuery({
    queryKey: ["class-name", classId],
    queryFn: async () => {
      const { data, error } = await supabase.from("classes").select("name").eq("id", classId).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: assessments = [] } = useQuery({
    queryKey: ["term-marks-assessments", classId, periodId],
    enabled: !!periodId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assessments")
        .select("id, name, category, subject, total_marks, weighting, term_period_id")
        .eq("class_id", classId)
        .eq("term_period_id", periodId)
        .order("assessment_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AssessmentRow[];
    },
  });

  const { data: learners = [] } = useQuery({
    queryKey: ["term-marks-learners", classId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("learners")
        .select("id, name")
        .eq("class_id", classId)
        .eq("active", true)
        .order("sort_key");
      if (error) throw error;
      return (data ?? []) as LearnerRow[];
    },
  });

  const assessmentIds = assessments.map((a) => a.id);
  const { data: marks = [] } = useQuery({
    queryKey: ["term-marks-marks", classId, assessmentIds.join(",")],
    enabled: assessmentIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("marks")
        .select("learner_id, assessment_id, mark, status")
        .in("assessment_id", assessmentIds);
      if (error) throw error;
      return (data ?? []) as MarkRow[];
    },
  });

  const subjects = useMemo(
    () => Array.from(new Set(assessments.map((a) => a.subject).filter((s): s is string => !!s))).sort(),
    [assessments],
  );

  const visibleAssessments = useMemo(() => {
    if (subject === "all") return assessments;
    return assessments.filter((a) => a.subject === subject);
  }, [assessments, subject]);

  const included = visibleAssessments.filter((a) => !excluded.has(a.id));

  // Calc per-learner term mark.
  const allHaveWeight = included.length > 0 && included.every((a) => a.weighting != null && a.weighting > 0);

  type TermRow = { learner: LearnerRow; perAssessment: Map<string, MarkRow | null>; termPct: number | null };
  const rows: TermRow[] = useMemo(() => {
    return learners.map((l) => {
      const map = new Map<string, MarkRow | null>();
      for (const a of visibleAssessments) {
        const m = marks.find((x) => x.learner_id === l.id && x.assessment_id === a.id) ?? null;
        map.set(a.id, m);
      }
      // Compute term mark using only included assessments where mark captured.
      let termPct: number | null = null;
      const usable = included
        .map((a) => ({ a, m: map.get(a.id) ?? null }))
        .filter((x) => x.m && x.m.status === "captured" && typeof x.m.mark === "number");
      if (usable.length > 0) {
        if (allHaveWeight) {
          const totalWeight = usable.reduce((s, x) => s + (x.a.weighting ?? 0), 0);
          if (totalWeight > 0) {
            const sum = usable.reduce(
              (s, x) => s + ((x.m!.mark as number) / x.a.total_marks) * (x.a.weighting ?? 0),
              0,
            );
            termPct = Math.round((sum / totalWeight) * 100);
          }
        } else {
          const marksSum = usable.reduce((s, x) => s + (x.m!.mark as number), 0);
          const totalSum = usable.reduce((s, x) => s + x.a.total_marks, 0);
          termPct = totalSum > 0 ? Math.round((marksSum / totalSum) * 100) : null;
        }
      }
      return { learner: l, perAssessment: map, termPct };
    });
  }, [learners, visibleAssessments, marks, included, allHaveWeight]);

  function bandClass(p: number | null): string {
    if (p == null) return "text-muted-foreground";
    if (p >= 80) return "text-success-foreground bg-success/20";
    if (p >= 50) return "text-warning-foreground bg-warning/20";
    return "text-destructive bg-destructive/15";
  }

  function exportXlsx() {
    const headers = ["Learner", ...visibleAssessments.map((a) => `${a.name} (/${a.total_marks})`), "Term mark"];
    const data = rows.map((r) => [
      r.learner.name,
      ...visibleAssessments.map((a) => {
        const m = r.perAssessment.get(a.id);
        if (!m || m.status !== "captured" || typeof m.mark !== "number") return "—";
        return m.mark;
      }),
      r.termPct != null ? `${r.termPct}%` : "—",
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    const wb = XLSX.utils.book_new();
    const periodName = periods.find((p) => p.id === periodId)?.name ?? "Term";
    XLSX.utils.book_append_sheet(wb, ws, periodName.slice(0, 31));
    XLSX.writeFile(wb, `${(cls?.name ?? "Class")} – ${periodName} – Term marks.xlsx`);
  }

  return (
    <AppShell back={{ to: `/class/${classId}` }} title="Term marks">
      <div className="space-y-4 pb-12">
        {!current ? (
          <div className="rounded-2xl bg-card p-6 text-center shadow-soft">
            <p className="text-sm">No academic year set up yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Set up your year so Penny can group assessments by term.
            </p>
            <Button asChild className="mt-3 h-11 rounded-xl">
              <Link to="/settings/academic-year">Set up now</Link>
            </Button>
          </div>
        ) : periods.length === 0 ? (
          <div className="rounded-2xl bg-card p-6 text-center shadow-soft">
            <p className="text-sm">No term periods set up yet —</p>
            <p className="text-xs text-muted-foreground mt-1">
              once you add your terms, Penny will calculate everything for you.
            </p>
            <Button asChild className="mt-3 h-11 rounded-xl">
              <Link to="/settings/academic-year">Add term periods</Link>
            </Button>
          </div>
        ) : (
          <>
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">
                Which term are you calculating marks for?
              </label>
              <Select value={periodId} onValueChange={(v) => { setPeriodId(v); setSubject("all"); setExcluded(new Set()); }}>
                <SelectTrigger className="h-12 rounded-xl mt-1"><SelectValue placeholder="Pick a term period" /></SelectTrigger>
                <SelectContent>
                  {periods.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {periodId && subjects.length > 0 && (
              <div>
                <label className="text-xs uppercase tracking-wide text-muted-foreground">Subject</label>
                <Select value={subject} onValueChange={(v) => { setSubject(v); setExcluded(new Set()); }}>
                  <SelectTrigger className="h-12 rounded-xl mt-1"><SelectValue placeholder="All subjects" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All subjects</SelectItem>
                    {subjects.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {periodId && assessments.length === 0 && (
              <div className="rounded-2xl bg-card p-6 text-center shadow-soft text-sm text-muted-foreground">
                No assessments tagged to this period yet. Tag an assessment to this period to include it in the term mark.
              </div>
            )}

            {periodId && assessments.length > 0 && visibleAssessments.length === 0 && (
              <div className="rounded-2xl bg-card p-6 text-center shadow-soft text-sm text-muted-foreground">
                No assessments found for this subject in the selected term.
              </div>
            )}

            {visibleAssessments.length > 0 && (
              <>
                <div className="rounded-2xl bg-card p-3 shadow-soft space-y-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium px-1">
                    Assessments in this period
                  </p>
                  {visibleAssessments.map((a) => (
                    <div key={a.id} className="flex items-center gap-2 px-1 py-1.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{a.name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {a.subject ?? "—"} · {a.category ?? "—"} · /{a.total_marks}
                          {a.weighting != null ? ` · weighting ${a.weighting}` : " · no weighting"}
                        </p>
                      </div>
                      <Switch
                        checked={!excluded.has(a.id)}
                        onCheckedChange={(c) => setExcluded((prev) => {
                          const next = new Set(prev);
                          if (c) next.delete(a.id); else next.add(a.id);
                          return next;
                        })}
                      />
                    </div>
                  ))}
                  <p className="text-[11px] text-muted-foreground px-1">
                    {allHaveWeight
                      ? "Calculating weighted average — every assessment has a weighting."
                      : "Calculating straight percentage — at least one assessment has no weighting."}
                  </p>
                </div>

                <p className="text-sm text-muted-foreground px-1">
                  Here is how your class did this term. Tap any learner to see their full history.
                </p>

                <div className="overflow-x-auto rounded-2xl bg-card shadow-soft">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground sticky left-0 bg-card">
                          Learner
                        </th>
                        {visibleAssessments.map((a) => (
                          <th key={a.id} className="text-center px-2 py-2 text-xs text-muted-foreground whitespace-nowrap">
                            {a.name}
                          </th>
                        ))}
                        <th className="text-right px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
                          Term mark
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((r) => (
                        <tr key={r.learner.id}>
                          <td className="px-3 py-2 font-medium sticky left-0 bg-card">
                            <Link to="/learner/$learnerId" params={{ learnerId: r.learner.id }} className="hover:text-primary">
                              {r.learner.name}
                            </Link>
                          </td>
                          {visibleAssessments.map((a) => {
                            const m = r.perAssessment.get(a.id);
                            const has = m && m.status === "captured" && typeof m.mark === "number";
                            return (
                              <td key={a.id} className="px-2 py-2 text-center tabular-nums">
                                {has ? `${m!.mark}/${a.total_marks}` : "—"}
                              </td>
                            );
                          })}
                          <td className="px-3 py-2 text-right">
                            <span className={`inline-block tabular-nums px-2 py-0.5 rounded-full font-semibold ${bandClass(r.termPct)}`}>
                              {r.termPct != null ? `${r.termPct}%` : "—"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <Button onClick={exportXlsx} className="w-full h-12 rounded-xl">
                  <Download className="h-4 w-4 mr-2" />
                  Export term marks
                </Button>
              </>
            )}
          </>
        )}
      </div>

    </AppShell>
  );
}
