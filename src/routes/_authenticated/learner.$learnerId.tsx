import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Download, ChevronDown, ChevronUp, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/penny/AppShell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ExportSheet } from "@/components/penny/ExportSheet";
import { useSubscription } from "@/hooks/use-subscription";
import { pct } from "@/lib/penny";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/learner/$learnerId")({
  head: () => ({
    meta: [
      { title: "Learner – Penny" },
      { name: "description", content: "Learner profile in Penny — view assessment history, term marks, and generated report comments." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LearnerPage,
});

function LearnerPage() {
  const { learnerId } = Route.useParams();
  const [exportOpen, setExportOpen] = useState(false);
  const sub = useSubscription();

  const { data: learner } = useQuery({
    queryKey: ["learner", learnerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("learners")
        .select("id, name, class_id, pronouns, classes(name, grade, subject)")
        .eq("id", learnerId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (learner?.name) document.title = `${learner.name} – Penny`;
  }, [learner?.name]);



  // All assessments in the class — so we can show "Missing Mark" for any not yet captured.
  const { data: classAssessments = [] } = useQuery({
    queryKey: ["learner-class-assessments", learner?.class_id],
    enabled: !!learner?.class_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assessments")
        .select("id, name, assessment_type, assessment_date, total_marks, term_period_id, academic_year_id, category")
        .eq("class_id", learner!.class_id)
        .order("assessment_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Sprint 2 — group by term period when at least one assessment is tagged.
  const yearIds = Array.from(new Set(classAssessments.map((a) => a.academic_year_id).filter(Boolean) as string[]));
  const { data: yearList = [] } = useQuery({
    queryKey: ["learner-years", yearIds.join(",")],
    enabled: yearIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("academic_years").select("id, name").in("id", yearIds);
      if (error) throw error;
      return data ?? [];
    },
  });
  const periodIds = Array.from(new Set(classAssessments.map((a) => a.term_period_id).filter(Boolean) as string[]));
  const { data: periodList = [] } = useQuery({
    queryKey: ["learner-periods", periodIds.join(",")],
    enabled: periodIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("term_periods").select("id, name, sort_order, academic_year_id").in("id", periodIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: history = [] } = useQuery({
    queryKey: ["learner-history", learnerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("marks")
        .select("mark, status, assessment_id")
        .eq("learner_id", learnerId);
      if (error) throw error;
      return data ?? [];
    },
  });

  type Mark = { mark: number | null; status: string; assessment_id: string };
  const marks = history as Mark[];
  const marksByAsmt = new Map(marks.map((m) => [m.assessment_id, m]));

  const captured = classAssessments
    .map((a) => ({ a, m: marksByAsmt.get(a.id) }))
    .filter((x) => x.m?.status === "captured" && typeof x.m.mark === "number");
  const absentCount = marks.filter((m) => m.status === "absent").length;
  const missingCount = classAssessments.filter((a) => !marksByAsmt.has(a.id)).length;

  const avgPct = captured.length
    ? Math.round(
        captured.reduce((s, x) => s + pct(x.m!.mark as number, x.a.total_marks), 0) / captured.length,
      )
    : 0;

  return (
    <AppShell
      back={learner ? { to: `/class/${learner.class_id}` } : "/dashboard"}
      action={
        <Button variant="ghost" size="icon" onClick={() => setExportOpen(true)} aria-label="Export learner">
          <Download className="h-5 w-5" />
        </Button>
      }
    >
      <div className="mb-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {learner?.classes?.name}
        </p>
        <h1 className="font-display text-3xl font-semibold mt-1 leading-tight">
          {learner?.name ?? "Learner"}
        </h1>
      </div>

      <div className="rounded-3xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground p-5 shadow-warm mb-4">
        <p className="text-xs uppercase tracking-wide opacity-80">Overall average</p>
        <p className="font-display text-5xl font-semibold mt-1">{avgPct}%</p>
        <p className="text-sm opacity-90 mt-1">
          {captured.length
            ? `Across ${captured.length} assessment${captured.length === 1 ? "" : "s"}`
            : "No marks captured yet"}
        </p>
      </div>

      {/* Parent Meeting Mode: completed + missing at a glance, no extra clicks. */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="rounded-2xl bg-card p-3 shadow-soft text-center">
          <p className="font-display text-2xl font-semibold">{captured.length}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">Completed</p>
        </div>
        <div className="rounded-2xl bg-card p-3 shadow-soft text-center">
          <p className="font-display text-2xl font-semibold text-warning-foreground">{absentCount}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">Absent</p>
        </div>
        <div className="rounded-2xl bg-card p-3 shadow-soft text-center">
          <p className="font-display text-2xl font-semibold text-muted-foreground">{missingCount}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">Missing</p>
        </div>
      </div>

      <h2 className="font-display text-base font-semibold mb-2">Assessment results</h2>
      {classAssessments.length === 0 ? (
        <div className="rounded-2xl bg-card p-6 text-center shadow-soft text-sm text-muted-foreground">
          No assessments yet in this class.
        </div>
      ) : (
        (() => {
          const hasTermStructure = periodList.length > 0;
          // Build groups: each group is [{ key, label, items }]
          type AsmtRow = typeof classAssessments[number];
          type Group = { key: string; label: string; items: AsmtRow[] };

          const renderAssessmentList = (items: AsmtRow[]) => (
            <ul className="rounded-2xl bg-card shadow-soft divide-y divide-border">
              {items.map((a) => {
                const m = marksByAsmt.get(a.id);
                const isAbsent = m?.status === "absent";
                const isCaptured = m?.status === "captured" && typeof m.mark === "number";
                const p = isCaptured ? pct(m!.mark as number, a.total_marks) : null;
                return (
                  <li key={a.id}>
                    <Link
                      to="/assessment/$assessmentId"
                      params={{ assessmentId: a.id }}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-card-warm"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{a.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {a.category ?? "Assessment"} · {new Date(a.assessment_date).toLocaleDateString()}
                        </p>
                      </div>
                      {isAbsent && (
                        <span className="text-xs font-semibold px-2 py-1 rounded-full bg-warning/30 text-warning-foreground">Absent</span>
                      )}
                      {!m && (
                        <span className="text-xs font-semibold px-2 py-1 rounded-full bg-muted text-muted-foreground">Missing Mark</span>
                      )}
                      {isCaptured && (
                        <div className="text-right">
                          <p className="font-display text-base font-semibold tabular-nums">{m!.mark}/{a.total_marks}</p>
                          <p className="text-xs text-muted-foreground">{p}%</p>
                        </div>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          );

          if (!hasTermStructure) {
            return renderAssessmentList(classAssessments);
          }

          // Group by academic year → term period (sorted), with an "Unassigned" bucket.
          const yearLabel = (id: string | null) =>
            id ? yearList.find((y) => y.id === id)?.name ?? "Year" : "No year";
          const periodLabel = (id: string | null) =>
            id ? periodList.find((p) => p.id === id)?.name ?? "Period" : "Unassigned";

          const byYear = new Map<string, Map<string, AsmtRow[]>>();
          for (const a of classAssessments) {
            const yk = a.academic_year_id ?? "__none__";
            const pk = a.term_period_id ?? "__none__";
            if (!byYear.has(yk)) byYear.set(yk, new Map());
            const inner = byYear.get(yk)!;
            if (!inner.has(pk)) inner.set(pk, []);
            inner.get(pk)!.push(a);
          }

          // Compute term mark per period using captured marks only, straight % (no weighting).
          const termPct = (items: AsmtRow[]): number | null => {
            const usable = items
              .map((a) => ({ a, m: marksByAsmt.get(a.id) }))
              .filter((x) => x.m && x.m.status === "captured" && typeof x.m.mark === "number");
            if (usable.length === 0) return null;
            const sum = usable.reduce((s, x) => s + (x.m!.mark as number), 0);
            const tot = usable.reduce((s, x) => s + x.a.total_marks, 0);
            return tot > 0 ? Math.round((sum / tot) * 100) : null;
          };

          const orderedYears = Array.from(byYear.keys()).sort();
          return (
            <div className="space-y-5">
              {orderedYears.map((yk) => {
                const periods = byYear.get(yk)!;
                const periodKeys = Array.from(periods.keys()).sort((a, b) => {
                  const sa = periodList.find((p) => p.id === a)?.sort_order ?? 999;
                  const sb = periodList.find((p) => p.id === b)?.sort_order ?? 999;
                  return sa - sb;
                });
                return (
                  <div key={yk}>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium px-1 mb-2">
                      {yearLabel(yk === "__none__" ? null : yk)}
                    </p>
                    <div className="space-y-4">
                      {periodKeys.map((pk) => {
                        const items = periods.get(pk)!;
                        const t = termPct(items);
                        return (
                          <div key={pk}>
                            <div className="flex items-baseline justify-between px-1 mb-1">
                              <p className="text-sm font-semibold">{periodLabel(pk === "__none__" ? null : pk)}</p>
                              {t != null && (
                                <p className="text-xs font-semibold text-primary">Term mark {t}%</p>
                              )}
                            </div>
                            {renderAssessmentList(items)}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()
      )}
      <PronounsAdvanced
        learnerId={learnerId}
        initialValue={learner?.pronouns ?? null}
      />
      <ExportSheet
        xlsxLocked={!sub.canExportExcel}
        open={exportOpen}
        onOpenChange={setExportOpen}
        learnerId={learnerId}
        defaultKind="learner"
      />
    </AppShell>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Advanced section: pronouns for report comments. Collapsed by default.
// Never shown during bulk learner import or voice import.
// ──────────────────────────────────────────────────────────────────────────
function PronounsAdvanced({
  learnerId, initialValue,
}: { learnerId: string; initialValue: string | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string>(initialValue ?? "unset");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(initialValue ?? "unset");
  }, [initialValue]);

  async function save(next: string) {
    setSaving(true);
    const toSave = next === "unset" ? null : next;
    const { error } = await supabase
      .from("learners")
      .update({ pronouns: toSave })
      .eq("id", learnerId);
    setSaving(false);
    if (error) {
      toast.error("Couldn't save — try again.");
      return;
    }
    setValue(next);
    void qc.invalidateQueries({ queryKey: ["learner", learnerId] });
    toast.success("Saved");
  }

  return (
    <div className="rounded-2xl bg-card shadow-soft mt-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between p-4 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-medium">More options</span>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2">
          <Label className="text-sm font-medium">Pronouns used in report comments</Label>
          <Select value={value} onValueChange={save} disabled={saving}>
            <SelectTrigger className="h-11 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unset">Not set (Penny defaults to he/him)</SelectItem>
              <SelectItem value="she/her">She / Her</SelectItem>
              <SelectItem value="he/him">He / Him</SelectItem>
              <SelectItem value="they/them">They / Them</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            {saving ? "Saving…" : <><Check className="h-3 w-3" /> Used only for AI-generated comments and messages.</>}
          </p>
        </div>
      )}
    </div>
  );
}

