import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, X, Layers, Hash } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/penny/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { type Section } from "@/lib/penny";
import { toast } from "sonner";
import {
  AssessmentMetadataFields,
  EMPTY_ASSESSMENT_METADATA,
  type AssessmentMetadata,
} from "@/components/penny/AssessmentMetadataFields";
import { TopicsCovered } from "@/components/penny/TopicsCovered";
import { useCurrentAcademicYear, useTermPeriods } from "@/hooks/use-academic-year";
import { useRequireWriteAccess } from "@/hooks/use-require-write";

export const Route = createFileRoute("/_authenticated/assessment/new/$classId")({
  head: () => ({ meta: [{ title: "New assessment – Penny" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    termPeriodId: typeof search.termPeriodId === "string" ? search.termPeriodId : undefined,
    subject: typeof search.subject === "string" ? search.subject : undefined,
  }),
  component: NewAssessment,
});

function NewAssessment() {
  const { classId } = Route.useParams();
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const { requireWrite, canWrite } = useRequireWriteAccess();
  const { termPeriodId: preselectTermPeriodId, subject: preselectSubject } = Route.useSearch();
  const [name, setName] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [totalMarks, setTotalMarks] = useState("20");
  const [passMark, setPassMark] = useState("50");
  const [mode, setMode] = useState<"final" | "sections">("final");
  const [sections, setSections] = useState<Section[]>([
    { name: "Section A", total: 10 },
    { name: "Section B", total: 10 },
  ]);
  const [busy, setBusy] = useState(false);

  // Sprint 2 — metadata + topics. All optional; default current year if available.
  const { current: currentYear } = useCurrentAcademicYear();
  const [meta, setMeta] = useState<AssessmentMetadata>(EMPTY_ASSESSMENT_METADATA);
  const [topics, setTopics] = useState("");

  useEffect(() => {
    if (currentYear && !meta.academic_year_id) {
      setMeta((m) => ({ ...m, academic_year_id: currentYear.id }));
    }
  }, [currentYear, meta.academic_year_id]);

  // Pre-select the term period passed via ?termPeriodId= (from the class tab bar).
  useEffect(() => {
    if (preselectTermPeriodId && !meta.term_period_id) {
      setMeta((m) => ({ ...m, term_period_id: preselectTermPeriodId }));
    }
  }, [preselectTermPeriodId, meta.term_period_id]);

  // Pull class's default subject/grade as a starting hint. When the class page
  // passed ?subject= (from the subject tab bar), that wins over the class default.
  useEffect(() => {
    void supabase.from("classes").select("subject, grade").eq("id", classId).single()
      .then(({ data }) => {
        if (!data) return;
        setMeta((m) => ({
          ...m,
          subject: m.subject || preselectSubject || data.subject || "",
          grade: m.grade || data.grade || "",
        }));
      });
  }, [classId, preselectSubject]);

  const sectionTotal = sections.reduce((s, x) => s + (Number(x.total) || 0), 0);
  const effectiveTotal = mode === "sections" ? sectionTotal : Number(totalMarks);

  // Look up the current term period name for the confirm dialog message.
  const { data: termPeriodsForYear = [] } = useTermPeriods(meta.academic_year_id);
  const currentTermName =
    termPeriodsForYear.find((p) => p.id === meta.term_period_id)?.name ?? null;

  const [duplicateOpen, setDuplicateOpen] = useState(false);

  function updateSection(i: number, patch: Partial<Section>) {
    setSections((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }

  async function attemptSave() {
    if (!requireWrite("create assessments")) return;
    if (!name.trim() || !effectiveTotal || effectiveTotal <= 0) {
      toast.error("Please enter a name and total marks");
      return;
    }
    if (mode === "sections" && sections.some((s) => !s.name.trim() || !s.total)) {
      toast.error("Each section needs a name and a max mark");
      return;
    }
    // Only warn about duplicates when BOTH name AND term period match an existing assessment.
    // If no term period is set, we never warn (teacher hasn't organised it yet).
    if (meta.term_period_id) {
      const { data: dupes } = await supabase
        .from("assessments")
        .select("id")
        .eq("class_id", classId)
        .eq("term_period_id", meta.term_period_id)
        .ilike("name", name.trim())
        .limit(1);
      if (dupes && dupes.length > 0) {
        setDuplicateOpen(true);
        return;
      }
    }
    await save();
  }

  async function save() {
    const pass = Number(passMark);
    setBusy(true);
    try {
      const weightingNum = meta.weighting.trim() === "" ? null : Number(meta.weighting);
      const { data, error } = await supabase
        .from("assessments")
        .insert({
          class_id: classId,
          teacher_id: user.id,
          name: name.trim(),
          assessment_type: meta.category || "Test",
          assessment_date: date,
          total_marks: effectiveTotal,
          pass_mark: isNaN(pass) ? 50 : pass,
          capture_mode: mode,
          sections: mode === "sections" ? sections : [],
          academic_year_id: meta.academic_year_id,
          term_period_id: meta.term_period_id,
          subject: meta.subject.trim() || null,
          grade: meta.grade || null,
          category: meta.category || null,
          weighting: weightingNum != null && !isNaN(weightingNum) ? weightingNum : null,
          counts_towards_report: meta.counts_towards_report,
          topics_covered: topics.trim() || null,
        })
        .select("id").single();
      if (error) throw error;
      toast.success("Assessment ready — let's capture marks!");
      navigate({ to: "/assessment/$assessmentId", params: { assessmentId: data.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell back={{ to: "/class/$classId", params: { classId } }} title="New assessment">
      <div className="space-y-5 pb-24">
        {!canWrite && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Creating assessments is paused.{" "}
            <Link to="/choose-plan" search={{ cancelled: undefined }} className="font-semibold underline underline-offset-2">
              Add a payment method
            </Link>
          </div>
        )}
        <div>
          <Label htmlFor="name" className="text-xs uppercase tracking-wide text-muted-foreground">Assessment name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Reading Assessment" className="h-12 rounded-xl mt-1" />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Assessment date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-12 rounded-xl mt-1" />
        </div>



        {/* Sprint 2 — academic year, term, subject, grade, category, weighting, counts-towards-report */}
        <AssessmentMetadataFields value={meta} onChange={setMeta} />

        <div>
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">How would you like to capture marks?</Label>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <button
              type="button"
              onClick={() => setMode("final")}
              className={`rounded-2xl p-3 text-left border-2 transition-colors ${mode === "final" ? "border-primary bg-primary-soft" : "border-border bg-card"}`}
            >
              <Hash className="h-4 w-4 text-primary" />
              <p className="font-medium text-sm mt-1">Final mark only</p>
              <p className="text-[11px] text-muted-foreground">e.g. "Alex 42"</p>
            </button>
            <button
              type="button"
              onClick={() => setMode("sections")}
              className={`rounded-2xl p-3 text-left border-2 transition-colors ${mode === "sections" ? "border-primary bg-primary-soft" : "border-border bg-card"}`}
            >
              <Layers className="h-4 w-4 text-primary" />
              <p className="font-medium text-sm mt-1">Section-based</p>
              <p className="text-[11px] text-muted-foreground">e.g. "Alex 8 7 10 9 6"</p>
            </button>
          </div>
        </div>

        {mode === "final" ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Out of</Label>
              <Input type="number" inputMode="numeric" min={1} value={totalMarks} onChange={(e) => setTotalMarks(e.target.value)} className="h-12 rounded-xl mt-1" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Pass (%)</Label>
              <Input type="number" inputMode="numeric" min={0} max={100} value={passMark} onChange={(e) => setPassMark(e.target.value)} className="h-12 rounded-xl mt-1" />
            </div>
          </div>
        ) : (
          <div className="rounded-2xl bg-card p-3 shadow-soft space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Sections</p>
              <p className="text-xs font-medium">Total: {sectionTotal}</p>
            </div>
            {sections.map((s, i) => (
              <div key={i} className="flex gap-2 items-center">
                <Input
                  value={s.name}
                  onChange={(e) => updateSection(i, { name: e.target.value })}
                  className="h-11 rounded-xl flex-1"
                  placeholder={`Section ${String.fromCharCode(65 + i)}`}
                />
                <Input
                  type="number" inputMode="numeric" min={1}
                  value={s.total}
                  onChange={(e) => updateSection(i, { total: Number(e.target.value) || 0 })}
                  className="h-11 rounded-xl w-20 text-center"
                />
                {sections.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setSections((arr) => arr.filter((_, j) => j !== i))}
                    className="p-2 text-muted-foreground hover:text-destructive"
                    aria-label="Remove section"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() => setSections((arr) => [...arr, { name: `Section ${String.fromCharCode(65 + arr.length)}`, total: 10 }])}
              className="w-full h-11 rounded-xl"
            >
              <Plus className="h-4 w-4 mr-1" /> Add section
            </Button>
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Pass (%)</Label>
              <Input type="number" inputMode="numeric" min={0} max={100} value={passMark} onChange={(e) => setPassMark(e.target.value)} className="h-12 rounded-xl mt-1" />
            </div>
          </div>
        )}

        {/* Sprint 2 — Topics covered (type or dictate) */}
        <div className="rounded-2xl bg-card p-3 shadow-soft">
          <TopicsCovered value={topics} onChange={setTopics} />
        </div>
      </div>

      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-md">
        <Button onClick={attemptSave} disabled={busy} className="w-full h-14 rounded-2xl text-base shadow-warm">
          {busy ? "Saving…" : `Create & start capturing${effectiveTotal ? ` (out of ${effectiveTotal})` : ""}`}
        </Button>
      </div>

      <AlertDialog open={duplicateOpen} onOpenChange={setDuplicateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Duplicate assessment name</AlertDialogTitle>
            <AlertDialogDescription>
              You already have a &lsquo;{name.trim()}&rsquo;
              {currentTermName ? ` in ${currentTermName}` : ""}. Are you sure you want to
              create another one in the same term?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDuplicateOpen(false);
                void save();
              }}
            >
              Create anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
