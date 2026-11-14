import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, ChevronRight, BookOpen, Sparkles, Search, ClipboardCheck, Users, BarChart3, User, Download, X, Pencil, Check } from "lucide-react";
import { ExportSheet } from "@/components/penny/ExportSheet";
import { useSubscription } from "@/hooks/use-subscription";
import { supabase } from "@/integrations/supabase/client";
import { OnboardingChecklist } from "@/components/penny/OnboardingChecklist";
import { AppShell } from "@/components/penny/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pct } from "@/lib/penny";
import { toast } from "sonner";
import { useAcademicYears } from "@/hooks/use-academic-year";
import { useLearnerTerm } from "@/hooks/use-teacher-settings";
import { teacherDisplayName, teacherFirstName, updateTeacherDisplayName } from "@/lib/teacher-display-name";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Your classes – Penny" },
      { name: "description", content: "Manage your classes, learners, and assessments in Penny — capture marks and track progress across the term." },
      { property: "og:title", content: "Your classes – Penny" },
      { property: "og:description", content: "Manage your classes, learners, and assessments in Penny." },
      { property: "og:url", content: "https://app.pennyteacher.co.za/dashboard" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Dashboard,
});

const DEMO_LEARNERS: { name: string; pronunciation?: string; aliases?: string[] }[] = [
  { name: "Alex Morgan", aliases: ["Alex"] },
  { name: "Jordan Lee", pronunciation: "Jor-dan" },
  { name: "Taylor Brooks", aliases: ["Tay"] },
  { name: "Sam Rivera" },
  { name: "Riley Chen" },
  { name: "Quinn Parker", pronunciation: "Kwin" },
  { name: "Avery Cole" },
  { name: "Jamie Wells", aliases: ["Jay"] },
];

function Dashboard() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const router = useRouter();
  const vocab = useLearnerTerm(user.id);
  const qc = useQueryClient();
  const [seeding, setSeeding] = useState(false);
  const [search, setSearch] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const sub = useSubscription();
  const [greetingName, setGreetingName] = useState(() => teacherFirstName(user));
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(greetingName);
  const [savingName, setSavingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setGreetingName(teacherFirstName(user));
  }, [user]);

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus();
  }, [editingName]);
  const [browserWarningHidden, setBrowserWarningHidden] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem("penny_browser_warning_dismissed") === "1") return;
    const w = window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown };
    const hasSpeech = !!(w.SpeechRecognition || w.webkitSpeechRecognition);
    setBrowserWarningHidden(hasSpeech);
  }, []);

  const { data: classes, isLoading } = useQuery({
    queryKey: ["classes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classes")
        .select("id, grade, subject, name, learners(count), assessments(count)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Aggregates per class: latest assessment + class average from captured marks.
  const { data: classAggs = [] } = useQuery({
    queryKey: ["dashboard-class-aggs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assessments")
        .select("id, name, assessment_date, total_marks, class_id, marks(mark, status)")
        .order("assessment_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  type Aggregate = { latestName: string | null; avg: number | null };
  const aggByClass = useMemo(() => {
    const m = new Map<string, Aggregate>();
    type Row = { id: string; name: string; assessment_date: string; total_marks: number; class_id: string; marks: { mark: number | null; status: string }[] | null };
    const rows = classAggs as Row[];
    for (const r of rows) {
      const prev = m.get(r.class_id) ?? { latestName: null, avg: null };
      if (!prev.latestName) prev.latestName = r.name;
      m.set(r.class_id, prev);
    }
    // Compute class avg from all captured marks across all assessments in that class.
    const sums = new Map<string, { sum: number; n: number }>();
    for (const r of rows) {
      const captured = (r.marks ?? []).filter((x) => x.status === "captured" && typeof x.mark === "number");
      for (const c of captured) {
        const cur = sums.get(r.class_id) ?? { sum: 0, n: 0 };
        cur.sum += pct(c.mark as number, r.total_marks);
        cur.n += 1;
        sums.set(r.class_id, cur);
      }
    }
    for (const [cid, agg] of m) {
      const s = sums.get(cid);
      m.set(cid, { ...agg, avg: s && s.n > 0 ? Math.round(s.sum / s.n) : null });
    }
    return m;
  }, [classAggs]);

  // Global learner search across all classes.
  const { data: allLearners = [] } = useQuery({
    queryKey: ["dashboard-all-learners"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("learners")
        .select("id, name, pronunciation, aliases, class_id, classes(name, grade, subject)")
        .eq("active", true)
        .order("sort_key");
      if (error) throw error;
      return data ?? [];
    },
  });

  type LearnerHit = { id: string; name: string; pronunciation: string | null; aliases: string[] | null; class_id: string; classes: { name: string; grade: string; subject: string } | null };
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return (allLearners as LearnerHit[])
      .filter((l) => {
        if (l.name.toLowerCase().includes(q)) return true;
        if (l.pronunciation && l.pronunciation.toLowerCase().includes(q)) return true;
        if (l.aliases && l.aliases.some((a) => a.toLowerCase().includes(q))) return true;
        return false;
      })
      .slice(0, 12);
  }, [search, allLearners]);

  const firstName = greetingName;

  async function saveGreetingName() {
    const next = nameDraft.trim();
    if (!next || next === greetingName) {
      setEditingName(false);
      setNameDraft(greetingName);
      return;
    }
    setSavingName(true);
    try {
      // Keep surname/rest of profile name when only the greeting first name changes.
      const currentFull = teacherDisplayName(user);
      const parts = currentFull.split(/\s+/).filter(Boolean);
      const newFull =
        parts.length > 1 && teacherFirstName(user) === parts[0]
          ? [next, ...parts.slice(1)].join(" ")
          : next;
      await updateTeacherDisplayName(newFull);
      setGreetingName(next);
      setNameDraft(next);
      setEditingName(false);
      await router.invalidate();
      toast.success("Name updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update name");
    } finally {
      setSavingName(false);
    }
  }

  async function seedDemo() {
    setSeeding(true);
    try {
      const { data: cls, error } = await supabase
        .from("classes")
        .insert({ teacher_id: user.id, grade: "Grade 7", subject: "English", name: "Demo Class 7H" })
        .select("id").single();
      if (error) throw error;
      const { error: lerr } = await supabase.from("learners").insert(
        DEMO_LEARNERS.map((l) => ({
          class_id: cls.id, teacher_id: user.id,
          name: l.name,
          pronunciation: l.pronunciation ?? null,
          aliases: l.aliases ?? [],
        })),
      );
      if (lerr) throw lerr;
      const { data: a, error: aerr } = await supabase
        .from("assessments")
        .insert({
          class_id: cls.id, teacher_id: user.id,
          name: "Reading Assessment (Demo)",
          assessment_type: "Reading Assessment",
          assessment_date: new Date().toISOString().slice(0, 10),
          total_marks: 20, pass_mark: 50,
          capture_mode: "final",
        })
        .select("id").single();
      if (aerr) throw aerr;
      toast.success("Demo ready! Try saying: \"Alex 15\" or \"Tay 18\"");
      qc.invalidateQueries({ queryKey: ["classes"] });
      navigate({ to: "/assessment/$assessmentId", params: { assessmentId: a.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create demo");
    } finally {
      setSeeding(false);
    }
  }

  const hasClasses = !!classes && classes.length > 0;

  return (
    <AppShell
      showSignOut
      action={
        hasClasses ? (
          <Button variant="ghost" size="icon" onClick={() => setExportOpen(true)} aria-label="Share & export">
            <Download className="h-5 w-5" />
          </Button>
        ) : undefined
      }
    >
      <OnboardingChecklist userId={user.id} />
      <AcademicYearNudge />
      {/* Browser compatibility warning — one-time, dismissible. */}
      {!browserWarningHidden && (
        <div className="mb-4 rounded-2xl border border-warning/30 bg-warning/15 p-4 text-warning-foreground">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <p className="font-display font-semibold text-sm">Voice capture works best on Chrome</p>
              <p className="text-sm mt-1 leading-relaxed">
                Penny works on any browser, but voice mark capture requires Chrome. Switch to Chrome for the full experience.
              </p>
            </div>
            <button
              onClick={() => {
                try {
                  window.localStorage.setItem("penny_browser_warning_dismissed", "1");
                } catch {
                  // ignore private-mode / storage errors
                }
                setBrowserWarningHidden(true);
              }}
              className="flex-none -mr-1 -mt-1 p-1 rounded-full hover:bg-warning/30 focus:outline-none focus:ring-2 focus:ring-warning"
              aria-label="Dismiss browser warning"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      <div className="mb-5">
        {editingName ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void saveGreetingName();
            }}
          >
            <span className="text-sm text-muted-foreground shrink-0">Hi</span>
            <Input
              ref={nameInputRef}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => void saveGreetingName()}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setEditingName(false);
                  setNameDraft(greetingName);
                }
              }}
              maxLength={60}
              disabled={savingName}
              aria-label="Your name"
              className="h-9 max-w-[12rem] rounded-lg text-sm"
            />
            <button
              type="submit"
              disabled={savingName}
              className="p-1.5 rounded-full text-primary hover:bg-primary-soft"
              aria-label="Save name"
            >
              <Check className="h-4 w-4" />
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => {
              setNameDraft(greetingName);
              setEditingName(true);
            }}
            className="group inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Edit your name"
          >
            <span>Hi {firstName} 👋</span>
            <Pencil className="h-3.5 w-3.5 opacity-40 group-hover:opacity-100 transition-opacity" />
          </button>
        )}
        <h1 className="font-display text-3xl font-semibold mt-1">Your classes</h1>
      </div>

      {/* Global learner search — answers "How is Alex doing?" in seconds. */}
      {hasClasses && (
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${vocab.plural} across all classes…`}
              className="h-12 pl-10 rounded-xl text-base bg-card shadow-soft border-0"
            />
          </div>
          {search.trim() && (
            <div className="mt-2 rounded-2xl bg-card shadow-soft overflow-hidden">
              {searchResults.length === 0 ? (
                <p className="px-4 py-4 text-sm text-muted-foreground text-center">
                  No {vocab.plural} match "{search}".
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {searchResults.map((l) => (
                    <li key={l.id}>
                      <Link
                        to="/learner/$learnerId"
                        params={{ learnerId: l.id }}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-card-warm"
                      >
                        <div className="h-9 w-9 flex-none rounded-full bg-primary-soft text-primary flex items-center justify-center">
                          <User className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{l.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {l.classes?.grade} · {l.classes?.subject}
                            {l.aliases && l.aliases.length > 0 && ` · "${l.aliases.join(", ")}"`}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground flex-none" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-32 rounded-2xl bg-card animate-pulse" />
          ))}
        </div>
      ) : !hasClasses ? (
        <EmptyState onSeed={seedDemo} seeding={seeding} />
      ) : (
        <>
          {/* Cross-class report comments — for class teachers who teach
              multiple subjects to the same group of learners. */}
          <Link
            to="/report-comments"
            className="block mb-3 rounded-2xl bg-primary-soft border border-primary/20 p-4 shadow-soft hover:bg-primary-soft/70 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 flex-none rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-warm">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-display text-lg font-semibold">Report comments</p>
                <p className="text-xs text-muted-foreground leading-snug mt-0.5">
                  Generate comments for your whole class across all subjects.
                </p>
              </div>
              <Button size="sm" className="rounded-full shrink-0" tabIndex={-1}>
                Get started
              </Button>
            </div>
          </Link>

        <div className="space-y-3 pb-24">
          {classes!.map((c) => {
            const lc = (c.learners as { count: number }[] | null)?.[0]?.count ?? 0;
            const ac = (c.assessments as { count: number }[] | null)?.[0]?.count ?? 0;
            const agg = aggByClass.get(c.id);
            return (
              <div key={c.id} className="rounded-2xl bg-card shadow-soft overflow-hidden">
                <Link
                  to="/class/$classId"
                  params={{ classId: c.id }}
                  className="block p-4 hover:bg-card-warm transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 flex-none rounded-xl bg-primary-soft text-primary flex items-center justify-center">
                      <BookOpen className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-display text-lg font-semibold truncate">{c.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {c.grade} · {c.subject}
                      </p>
                    </div>
                    {agg?.avg != null && (
                      <div className="text-right">
                        <p className="font-display text-xl font-semibold text-primary leading-none">{agg.avg}%</p>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">Class avg</p>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-muted/50 px-2.5 py-1.5">
                      <span className="text-muted-foreground">Learners </span>
                      <span className="font-semibold text-foreground tabular-nums">{lc}</span>
                    </div>
                    <div className="rounded-lg bg-muted/50 px-2.5 py-1.5">
                      <span className="text-muted-foreground">Assessments </span>
                      <span className="font-semibold text-foreground tabular-nums">{ac}</span>
                    </div>
                  </div>
                  {agg?.latestName && (
                    <p className="text-xs text-muted-foreground mt-2 truncate">
                      <span className="uppercase tracking-wide text-[10px]">Latest:</span>{" "}
                      <span className="font-medium text-foreground">{agg.latestName}</span>
                    </p>
                  )}
                </Link>
                {/* Quick nav — jump directly to a section of this class. */}
                <div className="grid grid-cols-3 border-t border-border divide-x divide-border text-xs">
                  <Link
                    to="/class/$classId"
                    params={{ classId: c.id }}
                    className="flex items-center justify-center gap-1.5 py-2.5 hover:bg-card-warm text-foreground"
                  >
                    <ClipboardCheck className="h-3.5 w-3.5" /> Assessments
                  </Link>
                  <Link
                    to="/class/$classId"
                    params={{ classId: c.id }}
                    className="flex items-center justify-center gap-1.5 py-2.5 hover:bg-card-warm text-foreground"
                  >
                    <Users className="h-3.5 w-3.5" /> Learners
                  </Link>
                  <Link
                    to="/class/$classId"
                    params={{ classId: c.id }}
                    className="flex items-center justify-center gap-1.5 py-2.5 hover:bg-card-warm text-foreground"
                  >
                    <BarChart3 className="h-3.5 w-3.5" /> Summary
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
        </>
      )}


      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-10 w-[calc(100%-2rem)] max-w-md">
        <Button asChild size="lg" className="w-full h-16 rounded-2xl text-base shadow-warm">
          <Link to={sub.canAddClass ? "/class/new" : "/choose-plan"}>
            <Plus className="h-5 w-5 mr-1" /> Add a class
          </Link>
        </Button>
      </div>
      <ExportSheet
        xlsxLocked={!sub.canExportExcel}
        open={exportOpen}
        onOpenChange={setExportOpen}
        teacherId={user.id}
      />
    </AppShell>
  );
}

function EmptyState({ onSeed, seeding }: { onSeed: () => void; seeding: boolean }) {
  return (
    <div className="space-y-3">
      <div className="rounded-3xl bg-card p-6 text-center shadow-soft">
        <div className="text-4xl mb-2">📚</div>
        <h2 className="font-display text-xl font-semibold">Let's get you started</h2>
        <p className="text-sm text-muted-foreground mt-1.5">
          Try Penny in under a minute with a demo class — or set up your real class.
        </p>
      </div>
      <Button
        onClick={onSeed}
        disabled={seeding}
        className="w-full h-14 rounded-2xl text-base shadow-warm"
      >
        <Sparkles className="h-5 w-5 mr-1.5" />
        {seeding ? "Setting up demo…" : "Try a demo class (60 seconds)"}
      </Button>
      <Button asChild variant="outline" className="w-full h-14 rounded-2xl text-base">
        <Link to="/class/new">
          <Plus className="h-5 w-5 mr-1.5" /> Create my own class
        </Link>
      </Button>
    </div>
  );
}

/**
 * Gentle nudge for teachers who haven't set up their academic year yet.
 * Dismissed permanently via localStorage.
 */
function AcademicYearNudge() {
  const { data: years = [], isLoading } = useAcademicYears();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem("penny_year_nudge_dismissed") === "1") {
      setDismissed(true);
    }
  }, []);

  function dismiss() {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem("penny_year_nudge_dismissed", "1");
      }
    } catch {
      // ignore private-mode / storage errors
    }
    setDismissed(true);
  }

  if (isLoading || years.length > 0 || dismissed) return null;

  return (
    <div className="mb-4 rounded-2xl border border-primary/20 bg-primary-soft p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
        <div className="flex-1">
          <p className="font-display font-semibold text-sm">Want to organise assessments by term?</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Set up your academic year — takes two minutes.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button asChild size="sm" className="rounded-full h-8">
            <Link to="/settings/academic-year">Set up</Link>
          </Button>
          <Button variant="ghost" size="sm" className="rounded-full h-8 text-muted-foreground hover:text-foreground" onClick={dismiss}>
            Maybe later
          </Button>
        </div>
      </div>
    </div>
  );
}
