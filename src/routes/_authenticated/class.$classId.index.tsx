import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  Plus, Users, ClipboardCheck, MoreVertical, Sparkles, UserX, UserCheck, Edit3, BarChart3, Search, Download, Calculator, Filter, Upload, Keyboard, History,
} from "lucide-react";
import { ExportSheet } from "@/components/penny/ExportSheet";
import { useSubscription } from "@/hooks/use-subscription";
import { pct } from "@/lib/penny";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/penny/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useCurrentAcademicYear, useTermPeriods, ASSESSMENT_CATEGORIES } from "@/hooks/use-academic-year";
import { useLearnerTerm } from "@/hooks/use-teacher-settings";

export const Route = createFileRoute("/_authenticated/class/$classId/")({
  head: () => ({
    meta: [
      { title: "Class – Penny" },
      { name: "description", content: "View learners, capture marks, and review assessments for this class in Penny." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ClassDetail,
});

function ClassDetail() {
  const { classId } = Route.useParams();
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const vocab = useLearnerTerm(user.id);

  const { data: cls } = useQuery({
    queryKey: ["class", classId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classes").select("id, grade, subject, name").eq("id", classId).single();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (cls?.name) document.title = `${cls.name} – Penny`;
  }, [cls?.name]);



  const { data: learners = [] } = useQuery({
    queryKey: ["learners", classId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("learners")
        .select("id, name, pronunciation, aliases, active")
        .eq("class_id", classId)
        .order("sort_key", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { data: assessments = [] } = useQuery({
    queryKey: ["assessments", classId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assessments")
        .select("id, name, assessment_type, assessment_date, total_marks, capture_mode, academic_year_id, term_period_id, subject, grade, category, counts_towards_report")
        .eq("class_id", classId)
        .order("assessment_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // All term periods the teacher owns — used to label assessments that share a name
  // across different terms. RLS scopes this to the current teacher.
  const { data: allTermPeriods = [] } = useQuery({
    queryKey: ["term-periods-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("term_periods").select("id, name");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });
  const termPeriodNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of allTermPeriods) m.set(p.id, p.name);
    return m;
  }, [allTermPeriods]);

  const { data: allMarks = [] } = useQuery({
    queryKey: ["class-marks", classId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("marks")
        .select("mark, status, learner_id, assessment_id, assessments!inner(class_id, total_marks, name, assessment_date)")
        .eq("assessments.class_id", classId);
      if (error) throw error;
      return data ?? [];
    },
  });

  type ClassMark = { learner_id: string; mark: number | null; status: string; assessment_id: string; assessments: { total_marks: number; name: string; assessment_date: string } | null };
  const marks = allMarks as ClassMark[];

  const activeLearners = learners.filter((l) => l.active !== false);
  const inactiveLearners = learners.filter((l) => l.active === false);
  const needsLearning = activeLearners.filter((l) => !l.pronunciation && (!l.aliases || l.aliases.length === 0)).length;

  // Per-learner aggregates: average, count, and most-recent assessment name.
  const learnerStats = useMemo(() => {
    const map = new Map<string, { avg: number | null; completed: number; last: string | null }>();
    for (const l of activeLearners) {
      const mine = marks.filter((m) => m.learner_id === l.id && m.assessments);
      const captured = mine.filter((m) => m.status === "captured" && typeof m.mark === "number");
      const avg = captured.length
        ? Math.round(captured.reduce((s, m) => s + pct(m.mark as number, m.assessments!.total_marks), 0) / captured.length)
        : null;
      const sorted = [...mine].sort((a, b) =>
        (b.assessments!.assessment_date ?? "").localeCompare(a.assessments!.assessment_date ?? ""),
      );
      const last = sorted[0]?.assessments?.name ?? null;
      map.set(l.id, { avg, completed: captured.length, last });
    }
    return map;
  }, [activeLearners, marks]);

  const [newLearner, setNewLearner] = useState("");
  const [search, setSearch] = useState("");
  const [pendingAdd, setPendingAdd] = useState<string | null>(null);
  const [scope, setScope] = useState<"all" | "future" | "selected">("all");
  const [selectedAsmts, setSelectedAsmts] = useState<Set<string>>(new Set());
  const [exportOpen, setExportOpen] = useState(false);
  const sub = useSubscription();

  // Sprint 2 — assessment filters.
  const { current: currentYear } = useCurrentAcademicYear();
  const [filterYearId, setFilterYearId] = useState<string | "all">("all");
  const effectiveYearId = filterYearId === "all" ? currentYear?.id ?? null : filterYearId;
  const { data: filterPeriods = [] } = useTermPeriods(effectiveYearId);
  // Term periods for the current academic year — powers the quick toggle bar.
  const { data: currentYearPeriods = [] } = useTermPeriods(currentYear?.id ?? null);
  const [filterPeriodId, setFilterPeriodId] = useState<string | "all">("all");
  const [filterSubject, setFilterSubject] = useState("");
  const [filterGrade, setFilterGrade] = useState<string | "all">("all");
  const [filterCategory, setFilterCategory] = useState<string | "all">("all");
  const [filterCountsOnly, setFilterCountsOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Quick-access term tab bar — resets to "all" on each mount by design.
  const [termTab, setTermTab] = useState<string>("all");
  // Subject tab bar — also resets to "all" on mount by design.
  const [subjectTab, setSubjectTab] = useState<string>("all");

  type AssessmentRow = typeof assessments[number];
  const filteredAssessments = useMemo<AssessmentRow[]>(() => {
    return assessments.filter((a) => {
      if (currentYear && filterYearId === "all" && a.academic_year_id && a.academic_year_id !== currentYear.id) {
        // Default: hide other years when teacher has a current year and hasn't picked "all".
        return false;
      }
      if (filterYearId !== "all" && a.academic_year_id !== filterYearId) return false;
      if (filterPeriodId !== "all" && a.term_period_id !== filterPeriodId) return false;
      if (termTab !== "all" && a.term_period_id !== termTab) return false;
      if (subjectTab !== "all" && (a.subject ?? "").trim() !== subjectTab) return false;
      if (filterSubject.trim() && (a.subject ?? "").toLowerCase() !== filterSubject.trim().toLowerCase()) return false;
      if (filterGrade !== "all" && a.grade !== filterGrade) return false;
      if (filterCategory !== "all" && a.category !== filterCategory) return false;
      if (filterCountsOnly && !a.counts_towards_report) return false;
      return true;
    });
  }, [assessments, currentYear, filterYearId, filterPeriodId, termTab, subjectTab, filterSubject, filterGrade, filterCategory, filterCountsOnly]);

  // Unique subjects (from the assessment.subject field only — never category)
  // scoped to the current term tab so tabs reflect what the teacher sees.
  const subjectTabs = useMemo(() => {
    const set = new Set<string>();
    for (const a of assessments) {
      if (termTab !== "all" && a.term_period_id !== termTab) continue;
      const s = (a.subject ?? "").trim();
      if (s) set.add(s);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [assessments, termTab]);

  // Reset subject tab if the previously selected subject no longer exists
  // (e.g. after switching term tabs).
  useEffect(() => {
    if (subjectTab !== "all" && !subjectTabs.includes(subjectTab)) setSubjectTab("all");
  }, [subjectTabs, subjectTab]);

  // Group the filtered list by subject when showing "All" with multiple subjects.
  const groupedForAll = useMemo(() => {
    const groups = new Map<string, AssessmentRow[]>();
    for (const a of filteredAssessments) {
      const s = (a.subject ?? "").trim() || "No subject";
      const arr = groups.get(s) ?? [];
      arr.push(a);
      groups.set(s, arr);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredAssessments]);

  const subjectOptions = useMemo(
    () => Array.from(new Set(assessments.map((a) => a.subject).filter(Boolean) as string[])),
    [assessments],
  );
  const gradeOptions = useMemo(
    () => Array.from(new Set(assessments.map((a) => a.grade).filter(Boolean) as string[])),
    [assessments],
  );

  async function addLearner(name: string, applyScope: "all" | "future" | "selected" = "all", selected?: Set<string>) {
    const { data: created, error } = await supabase
      .from("learners")
      .insert({ class_id: classId, teacher_id: user.id, name })
      .select("id").single();
    if (error) { toast.error(error.message); return; }
    setNewLearner("");

    // For "future" or "selected", insert absent placeholder marks on excluded past assessments
    if (created && assessments.length > 0 && applyScope !== "all") {
      const excludeIds = applyScope === "future"
        ? assessments.map((a) => a.id)
        : assessments.filter((a) => !selected?.has(a.id)).map((a) => a.id);
      if (excludeIds.length > 0) {
        await supabase.from("marks").insert(
          excludeIds.map((aid) => ({
            assessment_id: aid, learner_id: created.id, teacher_id: user.id,
            mark: null, status: "absent" as const,
          })),
        );
      }
    }
    qc.invalidateQueries({ queryKey: ["learners", classId] });
    qc.invalidateQueries({ queryKey: ["marks"] });
    toast.success(`${name} added`);
  }

  function onAddClick() {
    const n = newLearner.trim();
    if (!n) return;
    if (!sub.canWrite) {
      toast.error("Your trial has ended — add a payment method to add learners.");
      void navigate({ to: "/choose-plan", search: { cancelled: undefined } });
      return;
    }
    if (assessments.length > 0) {
      setScope("all");
      setSelectedAsmts(new Set());
      setPendingAdd(n);
    } else {
      void addLearner(n);
    }
  }

  async function setActive(id: string, active: boolean) {
    const { error } = await supabase.from("learners").update({ active }).eq("id", id);
    if (error) toast.error(error.message);
    else {
      qc.invalidateQueries({ queryKey: ["learners", classId] });
      toast.success(active ? "Learner reactivated" : "Learner marked inactive — history kept");
    }
  }

  async function deleteClass() {
    const { error } = await supabase.from("classes").delete().eq("id", classId);
    if (error) return toast.error(error.message);
    toast.success("Class deleted");
    navigate({ to: "/dashboard" });
  }

  return (
    <AppShell
      back="/dashboard"
      action={
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setExportOpen(true)} aria-label="Export class">
            <Download className="h-5 w-5" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Class options"><MoreVertical className="h-5 w-5" /></Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this class?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes the class, all its {vocab.plural}, assessments, and captured marks.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={deleteClass} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Delete class
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      }
    >
      <div className="mb-5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{cls?.grade} · {cls?.subject}</p>
        <h1 className="font-display text-3xl font-semibold mt-1">{cls?.name ?? "Class"}</h1>
      </div>

      {needsLearning > 0 && (
        <button
          type="button"
          onClick={() => {
            navigate({ to: "/learn/$classId", params: { classId } });
          }}
          className="w-full text-left block rounded-2xl bg-primary-soft border border-primary/30 p-4 mb-4 active:bg-primary/20 hover:bg-primary/15 touch-manipulation"
        >
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-primary flex-none" />
            <div className="flex-1">
              <p className="font-medium text-sm">Let's Learn Your {vocab.Plural}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Add pronunciations & nicknames for {needsLearning} {needsLearning === 1 ? vocab.singular : vocab.plural} so Penny hears them correctly.
              </p>
            </div>
            <span className="text-primary font-medium text-sm">Open →</span>
          </div>
        </button>
      )}

      <Tabs defaultValue="assessments" className="w-full">
        <TabsList className="grid w-full grid-cols-3 rounded-xl h-11">
          <TabsTrigger value="assessments" className="rounded-lg text-xs sm:text-sm">
            <ClipboardCheck className="h-4 w-4 mr-1" /> Assessments
          </TabsTrigger>
          <TabsTrigger value="learners" className="rounded-lg text-xs sm:text-sm">
            <Users className="h-4 w-4 mr-1" /> {vocab.Plural}
          </TabsTrigger>
          <TabsTrigger value="summary" className="rounded-lg text-xs sm:text-sm">
            <BarChart3 className="h-4 w-4 mr-1" /> Summary
          </TabsTrigger>
        </TabsList>

        <TabsContent value="assessments" className="mt-4 space-y-3">
          {/* Term marks shortcut */}
          <Link
            to="/term-marks/$classId"
            params={{ classId }}
            className="flex items-center gap-3 rounded-2xl bg-primary-soft border border-primary/20 p-3 hover:bg-primary/15"
          >
            <Calculator className="h-5 w-5 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-medium">Term marks</p>
              <p className="text-[11px] text-muted-foreground">Calculate a term mark from assessments tagged to a period.</p>
            </div>
            <span className="text-primary text-sm font-medium">Open →</span>
          </Link>

          {/* Report comments shortcut — AI gated inside the route. */}
          <Link
            to="/class/$classId/report-comments"
            params={{ classId }}
            className="flex items-center gap-3 rounded-2xl bg-card border border-primary/20 p-3 hover:bg-card-warm shadow-soft"
          >
            <Sparkles className="h-5 w-5 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-medium">Report comments</p>
              <p className="text-[11px] text-muted-foreground">Let Penny draft a comment for every learner.</p>
            </div>
            <span className="text-primary text-sm font-medium">Open →</span>
          </Link>

          {/* Sprint 4 — Historical mark import & bulk manual entry. Plan-gated inside each route. */}
          <div className="grid grid-cols-2 gap-2">
            <Link
              to="/class/$classId/import"
              params={{ classId }}
              className="flex flex-col items-start gap-1 rounded-2xl bg-card border border-border p-3 hover:bg-card-warm shadow-soft"
            >
              <Upload className="h-4 w-4 text-primary" />
              <p className="text-sm font-medium leading-tight">Import historical marks</p>
              <p className="text-[11px] text-muted-foreground">From Excel or CSV</p>
            </Link>
            <Link
              to="/class/$classId/bulk-entry"
              params={{ classId }}
              className="flex flex-col items-start gap-1 rounded-2xl bg-card border border-border p-3 hover:bg-card-warm shadow-soft"
            >
              <Keyboard className="h-4 w-4 text-primary" />
              <p className="text-sm font-medium leading-tight">Enter marks manually</p>
              <p className="text-[11px] text-muted-foreground">From paper, by hand</p>
            </Link>
          </div>

          <ImportHistory classId={classId} />

          {/* Empty-state nudge for academic year setup */}
          {!currentYear && (
            <div className="rounded-2xl bg-card p-3 shadow-soft text-sm flex items-center gap-3">
              <div className="flex-1">
                <p className="font-medium">Set up your academic year</p>
                <p className="text-xs text-muted-foreground">…to organise assessments by term.</p>
              </div>
              <Button asChild size="sm" variant="outline" className="rounded-full">
                <Link to="/settings/academic-year">Set up now</Link>
              </Button>
            </div>
          )}

          {/* Quick-access term tab bar — horizontally scrollable */}
          <div className="-mx-1">
            <div className="flex gap-2 overflow-x-auto px-1 pb-1 no-scrollbar">
              <button
                type="button"
                onClick={() => setTermTab("all")}
                className={`shrink-0 h-9 px-4 rounded-full text-sm font-medium border transition-colors ${
                  termTab === "all"
                    ? "bg-primary text-primary-foreground border-primary shadow-soft"
                    : "bg-card border-border text-foreground hover:bg-card-warm"
                }`}
              >
                All
              </button>
              {currentYearPeriods.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setTermTab(p.id)}
                  className={`shrink-0 h-9 px-4 rounded-full text-sm font-medium border transition-colors ${
                    termTab === p.id
                      ? "bg-primary text-primary-foreground border-primary shadow-soft"
                      : "bg-card border-border text-foreground hover:bg-card-warm"
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
            {currentYearPeriods.length === 0 && currentYear == null && (
              <p className="text-xs text-muted-foreground px-1 mt-1">
                <Link to="/settings/academic-year" className="text-primary font-medium">Set up your academic year</Link>{" "}
                to organise assessments by term.
              </p>
            )}
          </div>

          {/* Subject tab bar — one tab per unique subject on the class's
              assessments (from the assessment.subject field only, never category).
              Hidden when the class has zero or one subject. */}
          {subjectTabs.length > 1 && (
            <div className="-mx-1">
              <div className="flex gap-2 overflow-x-auto px-1 pb-1 no-scrollbar">
                <button
                  type="button"
                  onClick={() => setSubjectTab("all")}
                  className={`shrink-0 h-8 px-3.5 rounded-full text-xs font-medium border transition-colors ${
                    subjectTab === "all"
                      ? "bg-primary text-primary-foreground border-primary shadow-soft"
                      : "bg-card border-border text-foreground hover:bg-card-warm"
                  }`}
                >
                  All
                </button>
                {subjectTabs.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSubjectTab(s)}
                    className={`shrink-0 h-8 px-3.5 rounded-full text-xs font-medium border transition-colors ${
                      subjectTab === s
                        ? "bg-primary text-primary-foreground border-primary shadow-soft"
                        : "bg-card border-border text-foreground hover:bg-card-warm"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Term heading — clearly indicates which term the teacher is viewing */}
          <div className="mb-1">
            <h2 className="font-display text-2xl font-semibold">
              {subjectTab !== "all"
                ? `${subjectTab} Assessments`
                : termTab === "all"
                  ? "All Assessments"
                  : `${currentYearPeriods.find((p) => p.id === termTab)?.name ?? "Selected term"} Assessments`}
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {filteredAssessments.length === 0
                ? subjectTab !== "all"
                  ? "No assessments yet in this subject"
                  : "No assessments yet in this term"
                : subjectTab !== "all"
                  ? `${filteredAssessments.length} assessment${filteredAssessments.length === 1 ? "" : "s"} in this subject`
                  : `${filteredAssessments.length} assessment${filteredAssessments.length === 1 ? "" : "s"} in this term`}
            </p>
          </div>

          {/* Filter bar */}
          {assessments.length > 0 && (
            <div className="rounded-2xl bg-card p-3 shadow-soft">
              <button
                type="button"
                onClick={() => setFiltersOpen((o) => !o)}
                className="flex items-center gap-2 text-sm w-full"
              >
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Filters</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  Showing {filteredAssessments.length} of {assessments.length}
                </span>
              </button>
              {filtersOpen && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Select value={filterYearId} onValueChange={(v) => { setFilterYearId(v); setFilterPeriodId("all"); }}>
                    <SelectTrigger className="h-10 rounded-lg text-xs"><SelectValue placeholder="Academic year" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All years</SelectItem>
                      {currentYear && <SelectItem value={currentYear.id}>{currentYear.name} (current)</SelectItem>}
                    </SelectContent>
                  </Select>
                  <Select value={filterPeriodId} onValueChange={setFilterPeriodId} disabled={filterPeriods.length === 0}>
                    <SelectTrigger className="h-10 rounded-lg text-xs"><SelectValue placeholder="Term period" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All periods</SelectItem>
                      {filterPeriods.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={filterSubject || "all"} onValueChange={(v) => setFilterSubject(v === "all" ? "" : v)}>
                    <SelectTrigger className="h-10 rounded-lg text-xs"><SelectValue placeholder="Subject" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All subjects</SelectItem>
                      {subjectOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={filterGrade} onValueChange={setFilterGrade}>
                    <SelectTrigger className="h-10 rounded-lg text-xs"><SelectValue placeholder="Grade" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All grades</SelectItem>
                      {gradeOptions.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={filterCategory} onValueChange={setFilterCategory}>
                    <SelectTrigger className="h-10 rounded-lg text-xs col-span-2"><SelectValue placeholder="Category" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All categories</SelectItem>
                      {ASSESSMENT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <label className="col-span-2 flex items-center gap-2 text-xs text-muted-foreground px-1">
                    <input
                      type="checkbox"
                      checked={filterCountsOnly}
                      onChange={(e) => setFilterCountsOnly(e.target.checked)}
                    />
                    Only show assessments that count towards the term mark
                  </label>
                </div>
              )}
            </div>
          )}

          {assessments.length === 0 ? (
            <div className="rounded-2xl bg-card p-6 text-center shadow-soft">
              <p className="text-sm text-muted-foreground">No assessments yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Tap below to create your first one.</p>
            </div>
          ) : filteredAssessments.length === 0 ? (
            <div className="rounded-2xl bg-card p-6 text-center shadow-soft text-sm text-muted-foreground">
              {termTab !== "all"
                ? "No assessments yet for this term."
                : "No assessments match these filters."}
            </div>
          ) : (() => {
            const renderRow = (a: AssessmentRow) => {
              // Only show the term suffix when another assessment in the visible list
              // shares this name — keeps clean lists uncluttered but disambiguates duplicates.
              const sameName = filteredAssessments.filter(
                (x) => x.name.trim().toLowerCase() === a.name.trim().toLowerCase(),
              ).length;
              const termName = a.term_period_id ? termPeriodNameById.get(a.term_period_id) ?? null : null;
              const showTermSuffix = sameName > 1 && termName;
              return (
                <Link
                  key={a.id}
                  to="/assessment/$assessmentId"
                  params={{ assessmentId: a.id }}
                  className="block rounded-2xl bg-card p-4 shadow-soft hover:bg-card-warm"
                >
                  <p className="font-display text-lg font-semibold leading-tight">
                    {a.name}{showTermSuffix ? ` — ${termName}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {a.category ?? "Assessment"} · out of {a.total_marks}
                    {a.capture_mode === "sections" ? " · sectioned" : ""} ·{" "}
                    {new Date(a.assessment_date).toLocaleDateString()}
                  </p>
                </Link>
              );
            };
            // When "All" is selected and the class has multiple subjects,
            // group the list by subject with a subject label above each group.
            if (subjectTab === "all" && subjectTabs.length > 1) {
              return (
                <div className="space-y-4">
                  {groupedForAll.map(([subject, rows]) => (
                    <div key={subject} className="space-y-2">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium px-1">
                        {subject}
                      </p>
                      {rows.map(renderRow)}
                    </div>
                  ))}
                </div>
              );
            }
            return <>{filteredAssessments.map(renderRow)}</>;
          })()}
        </TabsContent>

        <TabsContent value="learners" className="mt-4">
          {/* Search — separated so teachers immediately spot the find-a-learner affordance. */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${vocab.plural}…`}
              className="h-12 pl-10 rounded-xl text-base bg-card shadow-soft border-0"
            />
          </div>
          {/* Add */}
          <div className="rounded-2xl bg-card p-3 shadow-soft mb-3 flex gap-2">
            <Input
              value={newLearner}
              onChange={(e) => setNewLearner(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void onAddClick(); }}
              placeholder={`Add a ${vocab.singular}…`}
              className="h-12 rounded-xl text-base"
            />
            <Button onClick={onAddClick} className="h-12 rounded-xl px-4" aria-label={`Add ${vocab.singular}`}>
              <Plus className="h-5 w-5" />
            </Button>
          </div>
          {activeLearners.length === 0 ? (
            <div className="rounded-2xl bg-card p-6 text-center shadow-soft text-sm text-muted-foreground">
              No active {vocab.plural} yet.
            </div>
          ) : (
            <ul className="rounded-2xl bg-card shadow-soft divide-y divide-border">
              {activeLearners
                .filter((l) => !search.trim() || l.name.toLowerCase().includes(search.toLowerCase()))
                .map((l, i) => {
                  const stats = learnerStats.get(l.id);
                  return (
                  <li key={l.id} className="flex items-center gap-1 px-2 py-1">
                    <Link
                      to="/learner/$learnerId"
                      params={{ learnerId: l.id }}
                      className="flex-1 flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-card-warm"
                    >
                      <span className="text-xs text-muted-foreground w-6">{i + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <span className="block truncate font-medium">{l.name}</span>
                        {stats && (stats.completed > 0 || stats.last) && (
                          <span className="block text-[11px] text-muted-foreground truncate">
                            {stats.completed > 0 && `${stats.completed} assessment${stats.completed === 1 ? "" : "s"}`}
                            {stats.completed > 0 && stats.last && " · "}
                            {stats.last && `Last: ${stats.last}`}
                          </span>
                        )}
                        {(!stats || (stats.completed === 0 && !stats.last)) && (l.pronunciation || (l.aliases && l.aliases.length > 0)) && (
                          <span className="block text-[11px] text-muted-foreground truncate">
                            {l.pronunciation && `“${l.pronunciation}”`}
                            {l.pronunciation && l.aliases && l.aliases.length > 0 && " · "}
                            {l.aliases && l.aliases.length > 0 && l.aliases.join(", ")}
                          </span>
                        )}
                      </div>
                      {stats?.avg != null && (
                        <div className="text-right">
                          <span className="block text-sm font-semibold text-primary leading-tight">{stats.avg}%</span>
                          <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Overall</span>
                        </div>
                      )}
                    </Link>
                    <button
                      onClick={() => void setActive(l.id, false)}
                      className="text-muted-foreground hover:text-warning-foreground p-2"
                      aria-label={`Mark ${l.name} inactive`}
                      title="Mark inactive"
                    >
                      <UserX className="h-4 w-4" />
                    </button>
                  </li>
                  );
                })}
            </ul>
          )}

          {inactiveLearners.length > 0 && (
            <details className="mt-4 rounded-2xl bg-card shadow-soft">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-muted-foreground">
                Inactive {vocab.plural} ({inactiveLearners.length})
              </summary>
              <ul className="divide-y divide-border">
                {inactiveLearners.map((l) => (
                  <li key={l.id} className="flex items-center gap-2 px-4 py-2">
                    <span className="flex-1 truncate text-sm text-muted-foreground">{l.name}</span>
                    <button
                      onClick={() => void setActive(l.id, true)}
                      className="text-xs px-3 py-1.5 rounded-full bg-success/15 text-success-foreground font-medium flex items-center gap-1"
                    >
                      <UserCheck className="h-3.5 w-3.5" /> Reactivate
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </TabsContent>

        <TabsContent value="summary" className="mt-4 space-y-3">
          {assessments.length === 0 ? (
            <div className="rounded-2xl bg-card p-6 text-center shadow-soft text-sm text-muted-foreground">
              No assessments yet.
            </div>
          ) : (
            <>
              {assessments.map((a) => {
                const aMarks = marks.filter((m) => m.assessment_id === a.id && m.status === "captured" && typeof m.mark === "number");
                const avg = aMarks.length
                  ? Math.round(aMarks.reduce((s, m) => s + pct(m.mark as number, a.total_marks), 0) / aMarks.length)
                  : null;
                return (
                  <Link
                    key={a.id}
                    to="/assessment/$assessmentId"
                    params={{ assessmentId: a.id }}
                    className="flex items-center gap-3 rounded-2xl bg-card p-4 shadow-soft hover:bg-card-warm"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-display text-base font-semibold leading-tight truncate">{a.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {a.category ?? "Assessment"} · out of {a.total_marks} ·{" "}
                        {aMarks.length ? `${aMarks.length} captured` : "No marks yet"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Class avg</p>
                      <p className="font-display text-xl font-semibold">
                        {avg != null ? `${avg}%` : "—"}
                      </p>
                    </div>
                  </Link>
                );
              })}

              {/* Top learners — quick access to learner profiles from the summary view. */}
              {(() => {
                const ranked = activeLearners
                  .map((l) => ({ l, avg: learnerStats.get(l.id)?.avg }))
                  .filter((x): x is { l: typeof activeLearners[number]; avg: number } => typeof x.avg === "number")
                  .sort((a, b) => b.avg - a.avg)
                  .slice(0, 5);
                if (ranked.length === 0) return null;
                return (
                  <div className="rounded-2xl bg-card shadow-soft overflow-hidden">
                    <p className="px-4 py-3 text-xs uppercase tracking-wide text-muted-foreground font-medium border-b border-border">
                      Top {vocab.plural}
                    </p>
                    <ul className="divide-y divide-border">
                      {ranked.map(({ l, avg }) => (
                        <li key={l.id}>
                          <Link
                            to="/learner/$learnerId"
                            params={{ learnerId: l.id }}
                            className="flex items-center gap-3 px-4 py-3 hover:bg-card-warm"
                          >
                            <span className="flex-1 truncate font-medium">{l.name}</span>
                            <span className="text-sm font-semibold text-primary">{avg}%</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}
            </>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={pendingAdd != null} onOpenChange={(o) => !o && setPendingAdd(null)}>
        <DialogContent className="rounded-2xl max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Add {pendingAdd}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This class has {assessments.length} existing assessment{assessments.length === 1 ? "" : "s"}.
            Which should {pendingAdd} appear on?
          </p>
          <div className="space-y-2">
            {([
              ["all", "All assessments", "Shows as Missing Mark until captured"],
              ["future", "Future assessments only", "Marked Absent on existing ones"],
              ["selected", "Selected assessments", "Choose which ones below"],
            ] as const).map(([val, label, sub]) => (
              <button
                key={val}
                onClick={() => setScope(val)}
                className={`w-full text-left rounded-xl p-3 border-2 transition-colors ${scope === val ? "border-primary bg-primary-soft" : "border-border bg-card"}`}
              >
                <p className="font-medium text-sm">{label}</p>
                <p className="text-xs text-muted-foreground">{sub}</p>
              </button>
            ))}
            {scope === "selected" && (
              <div className="rounded-xl border border-border p-2 max-h-40 overflow-y-auto space-y-1">
                {assessments.map((a) => {
                  const checked = selectedAsmts.has(a.id);
                  return (
                    <label key={a.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setSelectedAsmts((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(a.id); else next.delete(a.id);
                          return next;
                        })}
                      />
                      <span className="text-sm flex-1 truncate">{a.name}</span>
                      <span className="text-xs text-muted-foreground">{new Date(a.assessment_date).toLocaleDateString()}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="ghost" onClick={() => setPendingAdd(null)}>Cancel</Button>
            <Button onClick={async () => { const n = pendingAdd!; setPendingAdd(null); await addLearner(n, scope, selectedAsmts); }}>
              Add {vocab.singular}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-md flex gap-2">
        {activeLearners.length > 0 && (
          <Button asChild variant="outline" className="h-14 rounded-2xl px-4" aria-label="Learn your learners">
            <Link to="/learn/$classId" params={{ classId }}>
              <Edit3 className="h-5 w-5" />
            </Link>
          </Button>
        )}
        <Button
          type="button"
          size="lg"
          className="flex-1 h-14 rounded-2xl text-base shadow-warm"
          onClick={() => {
            if (activeLearners.length === 0) {
              toast.error(`Add ${vocab.plural} first, then create an assessment.`);
              return;
            }
            if (!sub.canWrite) {
              toast.error("Your trial has ended — add a payment method to create assessments.");
              void navigate({ to: "/choose-plan", search: { cancelled: undefined } });
              return;
            }
            void navigate({
              to: "/assessment/new/$classId",
              params: { classId },
              search: {
                termPeriodId: termTab !== "all" ? termTab : undefined,
                subject: subjectTab !== "all" ? subjectTab : undefined,
              },
            });
          }}
        >
          <Plus className="h-5 w-5 mr-1" /> New assessment
        </Button>
      </div>
      <ExportSheet
        xlsxLocked={!sub.canExportExcel}
        open={exportOpen}
        onOpenChange={setExportOpen}
        classId={classId}
        teacherId={user.id}
        defaultKind="class"
      />
    </AppShell>
  );
}

function ImportHistory({ classId }: { classId: string }) {
  const { data: logs = [] } = useQuery({
    queryKey: ["import-logs", classId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("import_logs").select("*")
        .eq("class_id", classId)
        .order("imported_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });
  if (logs.length === 0) return null;
  return (
    <details className="rounded-2xl bg-card shadow-soft">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-muted-foreground flex items-center gap-2">
        <History className="h-4 w-4" /> Import history ({logs.length})
      </summary>
      <ul className="divide-y divide-border">
        {logs.map((l) => (
          <li key={l.id} className="px-4 py-2 text-xs">
            <p className="font-medium text-sm text-foreground truncate">
              {l.file_name ?? (l.import_method === "manual_entry" ? "Manual entry" : "Imported file")}
            </p>
            <p className="text-muted-foreground">
              {new Date(l.imported_at).toLocaleDateString()} · {l.rows_imported} marks · {l.import_method.replace("_", " ")}
            </p>
          </li>
        ))}
      </ul>
    </details>
  );
}

