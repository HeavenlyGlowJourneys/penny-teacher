import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/penny/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  useCurrentAcademicYear, useTermPeriods, ASSESSMENT_CATEGORIES,
} from "@/hooks/use-academic-year";
import { useRequireWriteAccess } from "@/hooks/use-require-write";

export const Route = createFileRoute("/_authenticated/class/$classId/bulk-entry")({
  head: () => ({ meta: [{ title: "Enter marks – Penny" }] }),
  component: BulkEntryPage,
});

function BulkEntryPage() {
  const { classId } = Route.useParams();
  return <BulkEntryFlow classId={classId} />;
}

function BulkEntryFlow({ classId }: { classId: string }) {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const { requireWrite, canWrite, isTrialExpired } = useRequireWriteAccess();
  const { current: currentYear } = useCurrentAcademicYear();
  const { data: periods = [] } = useTermPeriods(currentYear?.id);

  const { data: learners = [] } = useQuery({
    queryKey: ["learners-active", classId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("learners").select("id, name, active")
        .eq("class_id", classId).order("sort_key");
      if (error) throw error;
      return (data ?? []).filter((l) => l.active !== false);
    },
  });

  const { data: assessments = [] } = useQuery({
    queryKey: ["class-assessments-list", classId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assessments").select("id, name, total_marks")
        .eq("class_id", classId).order("assessment_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const [mode, setMode] = useState<"existing" | "new">("new");
  const [assessmentId, setAssessmentId] = useState<string>("");
  const [name, setName] = useState("");
  const [total, setTotal] = useState<string>("50");
  const [termPeriodId, setTermPeriodId] = useState<string>("");
  const [category, setCategory] = useState<string>("Class Test");
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  const selected = assessments.find((a) => a.id === assessmentId);
  const effectiveTotal = mode === "existing" ? (selected?.total_marks ?? 0) : Number(total) || 0;

  const enteredCount = useMemo(
    () => Object.values(marks).filter((v) => v.trim() !== "").length,
    [marks],
  );
  const missingLearners = learners.filter((l) => !marks[l.id] || marks[l.id].trim() === "");

  function setMark(id: string, v: string) {
    const n = Number(v);
    if (v !== "" && (!Number.isFinite(n) || n < 0)) return;
    if (v !== "" && effectiveTotal > 0 && n > effectiveTotal) {
      toast.error(`Cannot exceed ${effectiveTotal}`);
      return;
    }
    setMarks((m) => ({ ...m, [id]: v }));
  }

  function focusNext(i: number) {
    const next = inputsRef.current[i + 1];
    if (next) next.focus();
  }

  async function save() {
    if (!requireWrite("save marks")) return;
    setSaving(true);
    try {
      let aid = assessmentId;
      if (mode === "new") {
        if (!name.trim()) { toast.error("Give the assessment a name."); setSaving(false); return; }
        if (!(Number(total) > 0)) { toast.error("Total marks must be greater than 0."); setSaving(false); return; }
        const { data: created, error } = await supabase.from("assessments").insert({
          class_id: classId, teacher_id: user.id,
          name: name.trim(), total_marks: Number(total),
          assessment_type: category, category,
          academic_year_id: currentYear?.id ?? null,
          term_period_id: termPeriodId || null,
        }).select("id").single();
        if (error) throw error;
        aid = created.id;
      }
      if (!aid) { toast.error("Pick or create an assessment first."); setSaving(false); return; }

      const rows = Object.entries(marks)
        .filter(([, v]) => v.trim() !== "")
        .map(([learner_id, v]) => ({
          assessment_id: aid!, learner_id, teacher_id: user.id,
          mark: Number(v), status: "captured" as const,
        }));
      if (rows.length === 0) { toast.error("Enter at least one mark."); setSaving(false); return; }

      const { error: upErr } = await supabase
        .from("marks")
        .upsert(rows, { onConflict: "assessment_id,learner_id" });
      if (upErr) throw upErr;

      toast.success(`Done. ${rows.length} marks saved.`);
      navigate({ to: "/assessment/$assessmentId", params: { assessmentId: aid } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell back={`/class/${classId}`}>
      <div className="mb-4">
        <h1 className="font-display text-2xl font-semibold leading-tight">Enter marks manually</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your class is listed below. Enter each learner's mark and tab to the next one.
        </p>
        {!canWrite && (
          <p className="mt-3 text-sm text-destructive">
            {isTrialExpired
              ? "Your trial has ended — saving marks is paused until you add a payment method."
              : "Saving marks requires an active subscription."}{" "}
            <Link to="/choose-plan" search={{ cancelled: undefined }} className="font-semibold underline underline-offset-2">
              Continue
            </Link>
          </p>
        )}
      </div>

      <div className="rounded-3xl bg-card p-4 shadow-soft space-y-3 mb-4">
        <div className="grid grid-cols-2 gap-2">
          <Button variant={mode === "new" ? "default" : "outline"} className="h-11 rounded-xl" onClick={() => setMode("new")}>
            New assessment
          </Button>
          <Button variant={mode === "existing" ? "default" : "outline"} className="h-11 rounded-xl" onClick={() => setMode("existing")}>
            Existing
          </Button>
        </div>

        {mode === "existing" ? (
          <div>
            <Label className="text-sm">Choose assessment</Label>
            <Select value={assessmentId} onValueChange={setAssessmentId}>
              <SelectTrigger className="mt-1 rounded-xl h-11"><SelectValue placeholder="Pick one" /></SelectTrigger>
              <SelectContent>
                {assessments.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name} (out of {a.total_marks})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <Label className="text-sm">Assessment name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Class Test 1" className="mt-1 h-11 rounded-xl" />
              </div>
              <div>
                <Label className="text-sm">Out of</Label>
                <Input value={total} type="number" inputMode="numeric" onChange={(e) => setTotal(e.target.value)} className="mt-1 h-11 rounded-xl" />
              </div>
              <div>
                <Label className="text-sm">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="mt-1 rounded-xl h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ASSESSMENT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {periods.length > 0 && (
                <div className="col-span-2">
                  <Label className="text-sm">Term period</Label>
                  <Select
                    value={termPeriodId === "" ? "__none__" : termPeriodId}
                    onValueChange={(v) => setTermPeriodId(v === "__none__" ? "" : v)}
                  >
                    <SelectTrigger className="mt-1 rounded-xl h-11"><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {periods.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {(mode === "new" || assessmentId) && (
        <div className="rounded-3xl bg-card shadow-soft overflow-hidden">
          <div className="px-4 py-3 flex items-center justify-between border-b border-border">
            <p className="text-sm font-medium">Learners</p>
            <p className="text-xs text-muted-foreground">
              {enteredCount} of {learners.length} marks entered
            </p>
          </div>
          {learners.length === 0 ? (
            <p className="text-sm text-muted-foreground p-6 text-center">No active learners in this class yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {learners.map((l, i) => (
                <li key={l.id} className="flex items-center gap-3 px-4 py-2">
                  <span className="text-xs text-muted-foreground w-6">{i + 1}.</span>
                  <span className="flex-1 truncate text-sm">{l.name}</span>
                  <Input
                    ref={(el) => { inputsRef.current[i] = el; }}
                    value={marks[l.id] ?? ""}
                    onChange={(e) => setMark(l.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); focusNext(i); }
                    }}
                    inputMode="decimal"
                    placeholder="—"
                    className="h-10 w-20 rounded-lg text-right text-sm"
                  />
                  <span className="text-xs text-muted-foreground w-14">/ {effectiveTotal || "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {missingLearners.length > 0 && enteredCount > 0 && (
        <p className="text-xs text-muted-foreground mt-3">
          {missingLearners.length} learner{missingLearners.length === 1 ? "" : "s"} have no mark — they'll be left blank.
        </p>
      )}

      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md flex gap-2">
        <Button asChild variant="outline" className="h-14 rounded-2xl px-4">
          <Link to="/class/$classId" params={{ classId }}>Cancel</Link>
        </Button>
        <Button
          onClick={save}
          disabled={saving || enteredCount === 0}
          className="flex-1 h-14 rounded-2xl text-base shadow-warm"
        >
          <Save className="h-5 w-5 mr-1" /> Save all marks
        </Button>
      </div>
    </AppShell>
  );
}
