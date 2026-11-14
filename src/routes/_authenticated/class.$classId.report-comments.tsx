import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TopicsGapPrompt } from "@/components/penny/TopicsGapPrompt";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { ArrowLeft, Copy, Loader2, RefreshCw, Sparkles, Download, Check, Mic, MicOff, ChevronDown, ChevronUp } from "lucide-react";
import { useVoice } from "@/hooks/use-voice";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/penny/AppShell";
import { AILockedCard } from "@/components/penny/AILockedCard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useSubscription } from "@/hooks/use-subscription";
import { useTermPeriods, useCurrentAcademicYear } from "@/hooks/use-academic-year";
import {
  generateReportComment, normalisePronouns, resolvePronouns, formatReportResult,
  type ReportCommentInput, type ReportCommentResult,
  type PronounSet, type NameFormat, type SubjectData,
} from "@/lib/ai-service";
import { useReportCommentDrafts, upsertDraft } from "@/hooks/use-ai-drafts";
import {
  useTeacherSettings, SENTENCE_BUCKET_LABEL, vocabFor,
  type CommentLengthType, type CommentLengthSentences,
} from "@/hooks/use-teacher-settings";
import { pct } from "@/lib/penny";

export const Route = createFileRoute("/_authenticated/class/$classId/report-comments")({
  head: () => ({ meta: [{ title: "Report comments – Penny" }] }),
  component: ReportCommentsPage,
});

type AreaOfFocusSource = "topics" | "marks" | "both";

type GeneratedComment = {
  learnerId: string;
  learnerName: string;
  pronounSet: PronounSet;
  /** True when pronouns were inferred without confidence and the teacher should confirm. */
  needsPronounConfirmation: boolean;
  nameFormat: NameFormat;
  result: ReportCommentResult;
  termMark: number | null;
  loading?: boolean;
  error?: string | null;
};

const NAME_FORMAT_LABELS: Record<NameFormat, string> = {
  "first": "First name only",
  "full-then-first": "Full name first, first name after",
  "full": "Full name throughout",
};

const NAME_FORMAT_EXAMPLES: Record<NameFormat, string> = {
  "first": "e.g. \"Alex is a cheerful learner.\"",
  "full-then-first": "e.g. \"Alex Morgan settles well. Alex approaches tasks…\"",
  "full": "e.g. \"Alex Morgan is a cheerful learner. Alex Morgan approaches…\"",
};

const PRONOUN_OPTIONS: Array<{ value: PronounSet; label: string }> = [
  { value: "he/him", label: "He / Him" },
  { value: "she/her", label: "She / Her" },
  { value: "they/them", label: "They / Them" },
];

const NAME_FORMAT_SHORT: Record<NameFormat, string> = {
  "first": "First",
  "full-then-first": "Full + First",
  "full": "Full",
};

const AOF_SOURCE_OPTIONS: Array<{ value: AreaOfFocusSource; label: string; hint: string }> = [
  { value: "topics", label: "Based on topics I recorded", hint: "Penny uses the topics you captured for each assessment." },
  { value: "marks", label: "Based on lowest scoring assessments", hint: "Penny zooms in on the weakest assessment per subject." },
  { value: "both", label: "Both combined", hint: "Penny blends topics and lowest marks." },
];

function ReportCommentsPage() {
  const { classId } = Route.useParams();
  const sub = useSubscription();

  if (sub.isLoading) {
    return (
      <AppShell back={{ to: `/class/${classId}` }}>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AppShell>
    );
  }

  if (!sub.canUseAIFeatures) {
    return (
      <AppShell back={{ to: `/class/${classId}` }}>
        <div className="mt-6">
          <AILockedCard
            heading="AI Report Comments"
            body="Let Penny draft your report comments based on your class's marks and topics. Available with an active Penny subscription."
          />
        </div>
      </AppShell>
    );
  }

  return <ReportCommentsFlow classId={classId} />;
}

function ReportCommentsFlow({ classId }: { classId: string }) {
  const router = useRouter();
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const { current: currentYear } = useCurrentAcademicYear();
  const { data: periods = [] } = useTermPeriods(currentYear?.id);

  const { data: cls } = useQuery({
    queryKey: ["class", classId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classes").select("id, name, grade, subject").eq("id", classId).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: learners = [] } = useQuery({
    queryKey: ["learners-with-pronouns", classId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("learners")
        .select("id, name, active, pronouns")
        .eq("class_id", classId)
        .order("sort_key", { ascending: true });
      if (error) throw error;
      return (data ?? []).filter((l) => l.active !== false) as Array<{
        id: string; name: string; active: boolean | null; pronouns: string | null;
      }>;
    },
  });

  const { data: assessments = [] } = useQuery({
    queryKey: ["class-assessments-meta", classId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assessments")
        .select("id, name, category, assessment_type, total_marks, term_period_id, topics_covered, subject")
        .eq("class_id", classId);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: allMarks = [] } = useQuery({
    queryKey: ["class-marks-flat", classId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("marks")
        .select("mark, status, learner_id, assessment_id, assessments!inner(class_id)")
        .eq("assessments.class_id", classId);
      if (error) throw error;
      return (data ?? []) as Array<{
        mark: number | null; status: string; learner_id: string; assessment_id: string;
      }>;
    },
  });

  // Setup state
  const [step, setStep] = useState<"setup" | "review">("setup");
  const [termPeriodId, setTermPeriodId] = useState<string>("");
  const [commentType, setCommentType] = useState<"term" | "year-end">("term");
  const [sampleComment, setSampleComment] = useState<string>("");
  const [nameFormat, setNameFormat] = useState<NameFormat>("full-then-first");
  // Guarantee a valid value at every call site — never undefined/null.
  const safeNameFormat = (nf: NameFormat | null | undefined): NameFormat =>
    nf === "first" || nf === "full-then-first" || nf === "full" ? nf : "full-then-first";
  const [generateGeneralComment, setGenerateGeneralComment] = useState(true);
  const [generateAreaOfFocus, setGenerateAreaOfFocus] = useState(true);
  const [aofSubjects, setAofSubjects] = useState<Set<string>>(new Set());
  const [aofSource, setAofSource] = useState<AreaOfFocusSource>("both");
  const [generating, setGenerating] = useState(false);
  const [comments, setComments] = useState<GeneratedComment[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  // Session-level overrides for report-comment length, seeded from teacher settings.
  const { data: teacherSettings } = useTeacherSettings(user.id);
  const vocab = vocabFor(teacherSettings?.learner_term ?? "learner");
  const [lengthType, setLengthType] = useState<CommentLengthType>("sentences");
  const [lengthSentences, setLengthSentences] = useState<CommentLengthSentences>("medium");
  const [lengthWords, setLengthWords] = useState<string>("");
  useEffect(() => {
    if (!teacherSettings) return;
    setLengthType(teacherSettings.comment_length_type);
    setLengthSentences(teacherSettings.comment_length_sentences);
    setLengthWords(teacherSettings.comment_length_words != null ? String(teacherSettings.comment_length_words) : "");
  }, [teacherSettings]);
  const currentWordLimit: number | null =
    lengthType === "words" ? (() => {
      const n = parseInt(lengthWords, 10);
      return Number.isFinite(n) && n >= 50 && n <= 500 ? n : null;
    })() : null;

  // Per-session teacher observations per learner (learnerId → free text). Not
  // persisted — the note is a personal cue for this generation only.
  const [observations, setObservations] = useState<Record<string, string>>({});
  const setObservation = (learnerId: string, text: string) =>
    setObservations((prev) => ({ ...prev, [learnerId]: text }));

  // Assessments filtered to the chosen term period (or all if none selected).
  const scopedAssessments = useMemo(
    () => assessments.filter((a) => !termPeriodId || a.term_period_id === termPeriodId),
    [assessments, termPeriodId],
  );

  // Unique subjects discovered in the scoped assessments. Every assessment
  // is represented — those without an explicit subject fall back to the
  // class subject, then to "General", so the teacher always sees the full
  // spread of subjects she has actually used (no hardcoded list).
  const availableSubjects = useMemo(() => {
    const set = new Set<string>();
    for (const a of scopedAssessments) {
      const s = (a.subject ?? cls?.subject ?? "").trim() || "General";
      set.add(s);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [scopedAssessments, cls?.subject]);

  // Default all available subjects to checked whenever the set changes.
  useEffect(() => {
    setAofSubjects(new Set(availableSubjects));
  }, [availableSubjects]);

  // Persisted drafts for the currently selected term period.
  const learnerIds = useMemo(() => learners.map((l) => l.id), [learners]);
  const { data: existingDrafts = [] } = useReportCommentDrafts(learnerIds, termPeriodId || null);

  function parseDraftContent(content: string): ReportCommentResult {
    try {
      const obj = JSON.parse(content);
      if (obj && typeof obj === "object" && ("generalComment" in obj || "areaOfFocus" in obj)) {
        return {
          generalComment: typeof obj.generalComment === "string" ? obj.generalComment : null,
          areaOfFocus: (obj.areaOfFocus && typeof obj.areaOfFocus === "object") ? obj.areaOfFocus : null,
        };
      }
    } catch {
      // legacy plain-text draft
    }
    return { generalComment: content || null, areaOfFocus: null };
  }

  async function persistDraft(c: GeneratedComment, isEdited: boolean) {
    try {
      await upsertDraft({
        teacherId: user.id, draftType: "report_comment",
        learnerId: c.learnerId, termPeriodId: termPeriodId || null,
        content: JSON.stringify(c.result), commentType, isEdited,
      });
    } catch {
      // Silent — drafts are an enhancement.
    }
  }

  function loadPreviousDrafts() {
    const byLearner = new Map(existingDrafts.map((d) => [d.learner_id, d]));
    const loaded: GeneratedComment[] = learners.map((l) => {
      const d = byLearner.get(l.id);
      const result: ReportCommentResult = d
        ? parseDraftContent(d.content)
        : { generalComment: null, areaOfFocus: null };
      const { pronouns, needsConfirmation } = resolvePronouns(l.name, l.pronouns);
      return {
        learnerId: l.id, learnerName: l.name,
        pronounSet: pronouns,
        needsPronounConfirmation: needsConfirmation,
        nameFormat,
        result,
        termMark: null,
        error: d ? null : "No previous draft.",
      };
    });
    setComments(loaded);
    setStep("review");
    toast.success(`Loaded ${existingDrafts.length} previous draft${existingDrafts.length === 1 ? "" : "s"}.`);
  }

  // Restore sample comment + name format from localStorage
  useEffect(() => {
    void (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return;
      const stored = localStorage.getItem(`penny_sample_comment_${uid}`);
      if (stored) setSampleComment(stored);
      const nf = localStorage.getItem(`penny_name_format_${uid}`);
      if (nf === "first" || nf === "full-then-first" || nf === "full") setNameFormat(nf);
    })();
  }, []);

  async function persistSample(value: string) {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) return;
    if (value.trim()) localStorage.setItem(`penny_sample_comment_${uid}`, value);
    else localStorage.removeItem(`penny_sample_comment_${uid}`);
  }

  function persistNameFormat(nf: NameFormat) {
    localStorage.setItem(`penny_name_format_${user.id}`, nf);
  }

  const selectedPeriod = periods.find((p) => p.id === termPeriodId) ?? null;

  function buildSubjectData(learnerId: string): { subjectData: SubjectData[]; termMark: number | null } {
    const marksByAsmt = new Map(
      allMarks.filter((m) => m.learner_id === learnerId).map((m) => [m.assessment_id, m]),
    );
    const bySubject = new Map<string, SubjectData>();
    let sumMark = 0, sumTotal = 0;

    for (const a of scopedAssessments) {
      const subject = (a.subject ?? cls?.subject ?? "").trim() || "General";
      const m = marksByAsmt.get(a.id);
      if (!m || m.status !== "captured" || typeof m.mark !== "number") continue;
      const p = pct(m.mark, a.total_marks);
      const entry = bySubject.get(subject) ?? {
        subject,
        assessments: [],
        termMark: null,
        lowestAssessment: null,
      };
      entry.assessments.push({
        name: a.name,
        category: a.category ?? a.assessment_type ?? "Assessment",
        mark: m.mark,
        total: a.total_marks,
        percentage: p,
        topicsCovered: a.topics_covered ?? null,
      });
      bySubject.set(subject, entry);
      sumMark += m.mark;
      sumTotal += a.total_marks;
    }

    // Compute per-subject term mark + lowest assessment.
    for (const sd of bySubject.values()) {
      let sm = 0, st = 0, low = sd.assessments[0] ?? null;
      for (const a of sd.assessments) {
        sm += a.mark;
        st += a.total;
        if (low && a.percentage < low.percentage) low = a;
      }
      sd.termMark = st > 0 ? Math.round((sm / st) * 100) : null;
      sd.lowestAssessment = low ? `${low.name} (${low.percentage}%)` : null;
    }

    return {
      subjectData: Array.from(bySubject.values()),
      termMark: sumTotal > 0 ? Math.round((sumMark / sumTotal) * 100) : null,
    };
  }

  function buildLearnerInput(
    learnerName: string,
    learnerId: string,
    pronounSet: PronounSet,
    nf: NameFormat,
  ): { input: ReportCommentInput; termMark: number | null } {
    const { subjectData, termMark } = buildSubjectData(learnerId);
    // Defensive: always send concrete, defined values for every field — even
    // when local state hasn't been touched, was reset by a draft load, or a
    // stale closure reads it mid-render.
    const wantGeneral = generateGeneralComment !== false;
    const wantAOF = generateAreaOfFocus !== false;
    const aofList = Array.from(aofSubjects ?? []);
    const input: ReportCommentInput = {
      learnerName,
      pronounSet,
      nameFormat: safeNameFormat(nf),
      commentType: commentType ?? "term",
      generateGeneralComment: wantGeneral,
      generateAreaOfFocus: wantAOF,
      areaOfFocusSubjects: aofList,
      areaOfFocusSource: aofSource ?? "both",
      termName: selectedPeriod?.name ?? "this term",
      academicYear: currentYear?.name ?? "this year",
      subjectData: subjectData ?? [],
      teacherSampleComment: sampleComment.trim() || null,
      commentLengthType: lengthType,
      commentLengthValue: lengthType === "words" ? (currentWordLimit ?? undefined) : lengthSentences,
      teacherObservation: (observations[learnerId] ?? "").trim() || null,
      learnerTerm: teacherSettings?.learner_term ?? "learner",
    };
    return { input, termMark };
  }

  async function generateForLearner(
    learnerId: string,
    learnerName: string,
    pronounSet: PronounSet,
    nf: NameFormat,
    needsPronounConfirmation: boolean,
  ): Promise<GeneratedComment> {
    const { input, termMark } = buildLearnerInput(learnerName, learnerId, pronounSet, nf);
    try {
      const result = await generateReportComment({ data: input });
      return { learnerId, learnerName, pronounSet, needsPronounConfirmation, nameFormat: nf, result, termMark };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong — nothing was lost. Try again.";
      return {
        learnerId, learnerName, pronounSet, needsPronounConfirmation, nameFormat: nf,
        result: { generalComment: null, areaOfFocus: null },
        termMark, error: msg,
      };
    }
  }

  async function handleGenerate() {
    if (learners.length === 0) {
      toast.error(`No ${vocab.plural} in this class yet.`);
      return;
    }
    if (!generateGeneralComment && !generateAreaOfFocus) {
      toast.error("Choose at least one of General comment or Area of Focus.");
      return;
    }
    if (generateAreaOfFocus && aofSubjects.size === 0) {
      toast.error("Pick at least one subject for Area of Focus — or turn it off.");
      return;
    }
    await persistSample(sampleComment);
    persistNameFormat(nameFormat);
    setGenerating(true);
    setStep("review");
    setProgress({ done: 0, total: learners.length });
    setComments(
      learners.map((l) => {
        const { pronouns, needsConfirmation } = resolvePronouns(l.name, l.pronouns);
        return {
          learnerId: l.id, learnerName: l.name,
          pronounSet: pronouns,
          needsPronounConfirmation: needsConfirmation,
          nameFormat,
          result: { generalComment: null, areaOfFocus: null },
          termMark: null, loading: true,
        };
      }),
    );

    const results: GeneratedComment[] = [];
    for (let i = 0; i < learners.length; i++) {
      const l = learners[i];
      const { pronouns, needsConfirmation } = resolvePronouns(l.name, l.pronouns);
      const r = await generateForLearner(l.id, l.name, pronouns, safeNameFormat(nameFormat), needsConfirmation);
      results.push(r);
      setComments((prev) => prev.map((c) => (c.learnerId === l.id ? { ...r, loading: false } : c)));
      setProgress({ done: i + 1, total: learners.length });
      void persistDraft(r, false);
    }
    setGenerating(false);
    const ok = results.filter((r) => !r.error).length;
    toast.success(`Comments ready — ${ok} of ${results.length} written.`);
  }

  async function regenerateCard(
    learnerId: string,
    pronounSet: PronounSet,
    nf: NameFormat,
    needsPronounConfirmation: boolean,
  ) {
    const l = learners.find((x) => x.id === learnerId);
    if (!l) return;
    const safeNf = safeNameFormat(nf);
    setComments((prev) =>
      prev.map((c) => (c.learnerId === learnerId
        ? { ...c, pronounSet, needsPronounConfirmation, nameFormat: safeNf, loading: true, error: null }
        : c)),
    );
    const r = await generateForLearner(l.id, l.name, pronounSet, safeNf, needsPronounConfirmation);
    setComments((prev) => prev.map((c) => (c.learnerId === learnerId ? { ...r, loading: false } : c)));
    void persistDraft(r, false);
  }

  async function handleRegenerate(learnerId: string) {
    const c = comments.find((x) => x.learnerId === learnerId);
    if (!c) return;
    await regenerateCard(learnerId, c.pronounSet, safeNameFormat(c.nameFormat), c.needsPronounConfirmation);
  }

  async function handlePronounChange(learnerId: string, pronounSet: PronounSet) {
    const c = comments.find((x) => x.learnerId === learnerId);
    if (!c || c.pronounSet === pronounSet) return;
    void supabase.from("learners").update({ pronouns: pronounSet }).eq("id", learnerId);
    // Teacher has explicitly chosen pronouns — clear the confirmation prompt.
    await regenerateCard(learnerId, pronounSet, safeNameFormat(c.nameFormat), false);
  }

  async function handleNameFormatChange(learnerId: string, nf: NameFormat) {
    const c = comments.find((x) => x.learnerId === learnerId);
    if (!c || c.nameFormat === nf) return;
    await regenerateCard(learnerId, c.pronounSet, safeNameFormat(nf), c.needsPronounConfirmation);
  }

  function handleEditGeneral(learnerId: string, text: string) {
    setComments((prev) => prev.map((c) => {
      if (c.learnerId !== learnerId) return c;
      const next = { ...c, result: { ...c.result, generalComment: text } };
      void persistDraft(next, true);
      return next;
    }));
  }

  function handleEditFocus(learnerId: string, subject: string, bullets: string[]) {
    setComments((prev) => prev.map((c) => {
      if (c.learnerId !== learnerId) return c;
      const af = { ...(c.result.areaOfFocus ?? {}) };
      af[subject] = bullets;
      const next = { ...c, result: { ...c.result, areaOfFocus: af } };
      void persistDraft(next, true);
      return next;
    }));
  }

  function exportToExcel() {
    // Collect every subject that appears in any card's areaOfFocus.
    const subjectSet = new Set<string>();
    for (const c of comments) {
      if (c.result.areaOfFocus) for (const k of Object.keys(c.result.areaOfFocus)) subjectSet.add(k);
    }
    const subjects = Array.from(subjectSet).sort((a, b) => a.localeCompare(b));

    const header = [
      "Learner Name",
      "General Comment",
      ...subjects.map((s) => `${s} Focus`),
      "Term Mark",
    ];
    const rows = comments.map((c) => {
      const subjectCols = subjects.map((s) => {
        const bullets = c.result.areaOfFocus?.[s];
        return bullets && bullets.length ? bullets.map((b) => `• ${b}`).join("\n") : "";
      });
      return [
        c.learnerName,
        c.result.generalComment ?? "",
        ...subjectCols,
        c.termMark != null ? c.termMark / 100 : null,
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    // Format the term mark column as a percentage.
    const termCol = header.length - 1;
    for (let i = 0; i < rows.length; i++) {
      const addr = XLSX.utils.encode_cell({ r: i + 1, c: termCol });
      const cell = ws[addr];
      if (cell && typeof cell.v === "number") cell.z = "0%";
    }
    ws["!cols"] = [
      { wch: 24 },
      { wch: 70 },
      ...subjects.map(() => ({ wch: 40 })),
      { wch: 12 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report Comments");
    const fname = `penny_report_comments_${(cls?.name ?? "class").replace(/[^a-z0-9]+/gi, "_")}.xlsx`;
    XLSX.writeFile(wb, fname);
  }

  function toggleSubject(s: string) {
    setAofSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  if (step === "setup") {
    return (
      <AppShell back={{ to: `/class/${classId}` }}>
        <div className="mb-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{cls?.name}</p>
          <h1 className="font-display text-3xl font-semibold mt-1 leading-tight">Report comments</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Penny will draft content for every {vocab.singular} based on their marks and topics.
          </p>
        </div>

        <div className="rounded-3xl bg-card p-5 shadow-soft space-y-5">
          <div>
            <Label className="text-sm font-medium">Term period</Label>
            <Select value={termPeriodId} onValueChange={setTermPeriodId}>
              <SelectTrigger className="mt-1 rounded-xl h-11">
                <SelectValue placeholder={periods.length ? "Select a term period" : "Set up an academic year first"} />
              </SelectTrigger>
              <SelectContent>
                {periods.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {periods.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                <Link to="/settings/academic-year" className="underline text-primary">Set up your academic year</Link> to group assessments by term.
              </p>
            )}
          </div>

          <div>
            <Label className="text-sm font-medium">Comment type</Label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <Button type="button" variant={commentType === "term" ? "default" : "outline"} className="h-11 rounded-xl" onClick={() => setCommentType("term")}>Term comment</Button>
              <Button type="button" variant={commentType === "year-end" ? "default" : "outline"} className="h-11 rounded-xl" onClick={() => setCommentType("year-end")}>Year-end comment</Button>
            </div>
          </div>

          <TopicsGapPrompt
            assessments={scopedAssessments.map((a) => ({
              id: a.id, name: a.name, topicsCovered: a.topics_covered ?? null,
            }))}
            onSaved={() => qc.invalidateQueries({ queryKey: ["class-assessments-meta", classId] })}
          />

          {/* Learner observations — optional per-learner personal notes */}
          <div className="rounded-2xl border border-input p-4 space-y-3">
            <div>
              <p className="text-sm font-semibold">Tell Penny about your {vocab.plural}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Optional — add a personal note about any {vocab.singular}. Penny will weave your observations into their comment naturally.
              </p>
            </div>
            <div className="space-y-2">
              {learners.map((l) => (
                <LearnerObservationRow
                  key={l.id}
                  learnerId={l.id}
                  learnerName={l.name}
                  value={observations[l.id] ?? ""}
                  onChange={(text) => setObservation(l.id, text)}
                />
              ))}
              {learners.length === 0 && (
                <p className="text-xs text-muted-foreground italic">Add {vocab.plural} to this class first.</p>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-input p-4 space-y-4">
            <p className="text-sm font-semibold">What to generate</p>

            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">General comment</p>
                <p className="text-xs text-muted-foreground">A holistic paragraph about the whole {vocab.singular}.</p>
              </div>
              <Switch checked={generateGeneralComment} onCheckedChange={setGenerateGeneralComment} />
            </div>

            <div className="border-t pt-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Area of Focus</p>
                  <p className="text-xs text-muted-foreground">Per-subject bullet points the {vocab.singular} can work on.</p>
                </div>
                <Switch checked={generateAreaOfFocus} onCheckedChange={setGenerateAreaOfFocus} />
              </div>

              {generateAreaOfFocus && (
                <div className="mt-3 space-y-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Subjects</p>
                    {availableSubjects.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">
                        No subjects found in {termPeriodId ? "this term" : "this class"} yet. Capture assessments first.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {availableSubjects.map((s) => {
                          const checked = aofSubjects.has(s);
                          return (
                            <label key={s} className="flex items-center gap-2 rounded-xl border bg-background px-3 py-2 cursor-pointer">
                              <Checkbox checked={checked} onCheckedChange={() => toggleSubject(s)} />
                              <span className="text-sm">{s}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Source</p>
                    <div className="space-y-2">
                      {AOF_SOURCE_OPTIONS.map((opt) => {
                        const selected = aofSource === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setAofSource(opt.value)}
                            className={`w-full text-left rounded-xl border p-3 transition-colors ${
                              selected ? "border-primary bg-primary-soft" : "border-input bg-background hover:bg-accent"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span className={`h-4 w-4 rounded-full border-2 flex-shrink-0 ${selected ? "border-primary bg-primary" : "border-muted-foreground/40"}`} />
                              <span className="text-sm font-medium">{opt.label}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 ml-6">{opt.hint}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl bg-card-warm p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Label className="text-sm font-medium">Comment length for this session</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Defaults from your school preferences. Change here to override for this batch only.
                </p>
              </div>
              <Link to="/settings/preferences" className="text-xs text-primary underline underline-offset-2 shrink-0">
                Manage default
              </Link>
            </div>

            {lengthType === "sentences" ? (
              <div className="grid grid-cols-2 gap-2">
                {(["short", "medium", "long", "extended"] as CommentLengthSentences[]).map((b) => {
                  const selected = lengthSentences === b;
                  return (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setLengthSentences(b)}
                      className={`rounded-xl border p-2 text-left text-xs transition-colors ${
                        selected ? "border-primary bg-primary-soft" : "border-input bg-background hover:bg-accent"
                      }`}
                    >
                      {SENTENCE_BUCKET_LABEL[b]}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div>
                <Label htmlFor="session-word-cap" className="text-sm font-medium">Maximum words per comment</Label>
                <input
                  id="session-word-cap"
                  type="number"
                  min={50}
                  max={500}
                  placeholder="e.g. 200"
                  value={lengthWords}
                  onChange={(e) => setLengthWords(e.target.value)}
                  className="mt-1 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">Between 50 and 500 words.</p>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-muted-foreground">My school uses a word limit</span>
              <Switch
                checked={lengthType === "words"}
                onCheckedChange={(v) => setLengthType(v ? "words" : "sentences")}
              />
            </div>
          </div>

          <div>
            <Label className="text-sm font-medium">Name format</Label>
            <div className="mt-2 space-y-2">
              {(["first", "full-then-first", "full"] as NameFormat[]).map((opt) => {
                const selected = nameFormat === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setNameFormat(opt)}
                    className={`w-full text-left rounded-xl border p-3 transition-colors ${
                      selected ? "border-primary bg-primary-soft" : "border-input bg-background hover:bg-accent"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`h-4 w-4 rounded-full border-2 flex-shrink-0 ${selected ? "border-primary bg-primary" : "border-muted-foreground/40"}`} />
                      <span className="text-sm font-medium">{NAME_FORMAT_LABELS[opt]}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 ml-6 italic">{NAME_FORMAT_EXAMPLES[opt]}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Label className="text-sm font-medium">Help Penny match your style</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Paste a report comment you have written before. Penny will match your tone and style. (Optional)
            </p>
            <Textarea
              value={sampleComment}
              onChange={(e) => setSampleComment(e.target.value)}
              placeholder="(optional) Paste an example of your own report comment here…"
              className="mt-2 rounded-xl min-h-[120px]"
            />
          </div>
        </div>

        {existingDrafts.length > 0 && (
          <div className="mt-4 rounded-2xl bg-primary-soft border border-primary/20 p-4 text-sm">
            <p className="font-medium">You have previous drafts for this term.</p>
            <p className="text-xs text-muted-foreground mt-1">
              {existingDrafts.length} draft{existingDrafts.length === 1 ? "" : "s"} saved. Load them or generate fresh comments.
            </p>
            <div className="mt-3 flex gap-2">
              <Button variant="outline" className="flex-1 h-10 rounded-xl" onClick={loadPreviousDrafts}>Load previous drafts</Button>
              <Button variant="ghost" className="flex-1 h-10 rounded-xl" onClick={handleGenerate}>Generate fresh</Button>
            </div>
          </div>
        )}

        <Button className="w-full h-12 rounded-2xl text-base mt-4 shadow-warm" onClick={handleGenerate} disabled={learners.length === 0}>
          <Sparkles className="h-4 w-4 mr-1" /> Generate comments
        </Button>
        {learners.length === 0 && (
          <p className="text-xs text-muted-foreground text-center mt-2">Add learners to this class before generating comments.</p>
        )}
      </AppShell>
    );
  }

  // Review step
  return (
    <AppShell
      back={{ to: `/class/${classId}` }}
      action={
        <Button variant="ghost" size="sm" onClick={() => setStep("setup")} className="rounded-full">
          <ArrowLeft className="h-4 w-4 mr-1" /> Setup
        </Button>
      }
    >
      <div className="mb-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{cls?.name}</p>
        <h1 className="font-display text-2xl font-semibold mt-1">Report comments</h1>
        {generating ? (
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Writing comments for your class — nearly there. ({progress.done}/{progress.total})
          </p>
        ) : (
          <p className="text-sm text-muted-foreground mt-1">Comments ready — review and copy when you are.</p>
        )}
      </div>

      <div className="space-y-3">
        {comments.map((c) => (
          <CommentCard
            key={c.learnerId}
            comment={c}
            onEditGeneral={(text) => handleEditGeneral(c.learnerId, text)}
            onEditFocus={(subject, bullets) => handleEditFocus(c.learnerId, subject, bullets)}
            onRegenerate={() => handleRegenerate(c.learnerId)}
            onPronounChange={(p) => handlePronounChange(c.learnerId, p)}
            onNameFormatChange={(nf) => handleNameFormatChange(c.learnerId, nf)}
            wordLimit={currentWordLimit}
          />
        ))}
      </div>

      {!generating && comments.length > 0 && (
        <Button onClick={exportToExcel} className="w-full h-12 rounded-2xl text-base mt-4 shadow-warm">
          <Download className="h-4 w-4 mr-1" /> Export all comments to Excel
        </Button>
      )}
      <button onClick={() => router.history.back()} className="hidden" aria-hidden />
    </AppShell>
  );
}

function CommentCard({
  comment, onEditGeneral, onEditFocus, onRegenerate, onPronounChange, onNameFormatChange, wordLimit,
}: {
  comment: GeneratedComment;
  onEditGeneral: (text: string) => void;
  onEditFocus: (subject: string, bullets: string[]) => void;
  onRegenerate: () => void;
  onPronounChange: (p: PronounSet) => void;
  onNameFormatChange: (nf: NameFormat) => void;
  wordLimit: number | null;
}) {
  const [copied, setCopied] = useState(false);
  const [editingGeneral, setEditingGeneral] = useState(false);
  const [editingFocus, setEditingFocus] = useState(false);
  const disabled = !!comment.loading;

  const focusEntries = comment.result.areaOfFocus ? Object.entries(comment.result.areaOfFocus) : [];
  const generalWordCount = comment.result.generalComment
    ? comment.result.generalComment.trim().split(/\s+/).filter(Boolean).length
    : 0;
  const overLimit = wordLimit != null && generalWordCount > wordLimit;


  async function handleCopy() {
    const text = formatReportResult(comment.learnerName, comment.result);
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — try again.");
    }
  }

  return (
    <div className="rounded-2xl bg-card p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold truncate">{comment.learnerName}</p>
          {comment.termMark != null && (
            <p className="text-xs text-muted-foreground">Term mark {comment.termMark}%</p>
          )}
        </div>
      </div>

      {comment.loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Penny is thinking…
        </div>
      ) : comment.error ? (
        <div className="text-sm text-destructive bg-destructive/10 rounded-xl p-3">
          {comment.error}
          <Button variant="outline" size="sm" className="rounded-full mt-2" onClick={onRegenerate}>
            <RefreshCw className="h-3 w-3 mr-1" /> Try again
          </Button>
        </div>
      ) : (
        <>
          {comment.result.generalComment != null && (
            <section className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">General comment</p>
                <p className={`text-[11px] tabular-nums ${overLimit ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                  {generalWordCount} {generalWordCount === 1 ? "word" : "words"}
                  {wordLimit != null ? ` / ${wordLimit}` : ""}
                </p>
              </div>
              {editingGeneral ? (
                <Textarea
                  value={comment.result.generalComment}
                  onChange={(e) => onEditGeneral(e.target.value)}
                  onBlur={() => setEditingGeneral(false)}
                  autoFocus
                  className="rounded-xl min-h-[110px] text-sm"
                />
              ) : (
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{comment.result.generalComment}</p>
              )}
            </section>
          )}

          {focusEntries.length > 0 && (
            <section className="mb-3 space-y-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Area of Focus</p>
              {focusEntries.map(([subject, bullets]) => (
                <div key={subject} className="rounded-xl bg-background border p-3">
                  <p className="text-sm font-semibold mb-1">{subject}</p>
                  {editingFocus ? (
                    <Textarea
                      value={bullets.join("\n")}
                      onChange={(e) => onEditFocus(subject, e.target.value.split("\n").map((b) => b.replace(/^•\s*/, "").trim()).filter(Boolean))}
                      onBlur={() => setEditingFocus(false)}
                      className="rounded-lg min-h-[70px] text-sm"
                    />
                  ) : (
                    <ul className="text-sm space-y-0.5 list-disc list-inside marker:text-muted-foreground">
                      {bullets.map((b, i) => <li key={i}>{b}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </section>
          )}

          {!comment.result.generalComment && focusEntries.length === 0 && (
            <p className="text-sm text-muted-foreground italic py-2">Nothing generated yet.</p>
          )}

          <div className="mt-3 space-y-2">
            <div
              className={
                comment.needsPronounConfirmation
                  ? "rounded-xl border border-amber-300/70 bg-amber-50/70 p-2"
                  : ""
              }
            >
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Pronouns</p>
              <div
                className={`inline-flex rounded-full border bg-background p-0.5 ${
                  comment.needsPronounConfirmation ? "ring-2 ring-amber-400/70" : ""
                }`}
              >
                {PRONOUN_OPTIONS.map((opt) => {
                  const selected = comment.pronounSet === opt.value;
                  return (
                    <button key={opt.value} type="button" disabled={disabled} onClick={() => onPronounChange(opt.value)}
                      className={`px-3 py-1 text-xs rounded-full transition-colors disabled:opacity-50 ${selected ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:text-foreground"}`}>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              {comment.needsPronounConfirmation && (
                <p className="text-[11px] text-amber-800 mt-1.5">
                  Please confirm pronouns for this learner.
                </p>
              )}
            </div>


            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Name format</p>
              <div className="inline-flex rounded-full border bg-background p-0.5">
                {(["first", "full-then-first", "full"] as NameFormat[]).map((opt) => {
                  const selected = comment.nameFormat === opt;
                  return (
                    <button key={opt} type="button" disabled={disabled} onClick={() => onNameFormatChange(opt)}
                      className={`px-3 py-1 text-xs rounded-full transition-colors disabled:opacity-50 ${selected ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:text-foreground"}`}>
                      {NAME_FORMAT_SHORT[opt]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 mt-3 flex-wrap">
            {comment.result.generalComment != null && (
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => setEditingGeneral((v) => !v)}>
                {editingGeneral ? "Done" : "Edit general"}
              </Button>
            )}
            {focusEntries.length > 0 && (
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => setEditingFocus((v) => !v)}>
                {editingFocus ? "Done" : "Edit focus"}
              </Button>
            )}
            <Button variant="outline" size="sm" className="rounded-full" onClick={onRegenerate}>
              <RefreshCw className="h-3 w-3 mr-1" /> Regenerate
            </Button>
            <Button size="sm" className="rounded-full" onClick={handleCopy}>
              {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
              {copied ? "Copied" : "Copy all"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// Collapsible per-learner observation row with voice + text input.
function LearnerObservationRow({
  learnerId, learnerName, value, onChange,
}: {
  learnerId: string;
  learnerName: string;
  value: string;
  onChange: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const voice = useVoice((text) => {
    const next = value.trim() ? `${value.trim()} ${text}` : text;
    onChange(next);
  });
  const listening = voice.state === "listening";
  const supported = voice.state !== "unsupported";
  const hasNote = value.trim().length > 0;

  return (
    <div className={`rounded-xl border ${hasNote ? "border-primary/40 bg-primary-soft/40" : "border-input bg-background"}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left"
        aria-expanded={open}
        aria-controls={`obs-${learnerId}`}
      >
        <span className="text-sm font-medium truncate">{learnerName}</span>
        <span className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
          {hasNote && !open && <span className="italic truncate max-w-[9rem]">Note added</span>}
          {open ? <ChevronUp className="h-4 w-4" /> : (
            <span className="inline-flex items-center gap-1 text-primary font-medium">
              + Add observation
            </span>
          )}
          {open && <ChevronDown className="h-4 w-4 rotate-180" />}
        </span>
      </button>
      {open && (
        <div id={`obs-${learnerId}`} className="px-3 pb-3 space-y-2 border-t border-input/60 pt-3">
          <div className="flex items-start gap-2">
            <Button
              type="button"
              variant={listening ? "default" : "outline"}
              size="sm"
              className="rounded-full h-9"
              onClick={() => (listening ? voice.stop() : voice.start())}
              disabled={!supported}
              aria-label={listening ? "Stop recording" : "Tap and speak about this learner"}
            >
              {listening ? <MicOff className="h-3.5 w-3.5 mr-1" /> : <Mic className="h-3.5 w-3.5 mr-1" />}
              {listening ? "Listening…" : "Tap and speak"}
            </Button>
            {!supported && (
              <span className="text-xs text-muted-foreground pt-2">Voice not supported in this browser.</span>
            )}
            {voice.errorMsg && supported && (
              <span className="text-xs text-destructive pt-2">Voice error: {voice.errorMsg}</span>
            )}
          </div>
          {voice.interim && (
            <p className="text-xs text-muted-foreground italic">{voice.interim}…</p>
          )}
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="e.g. Very shy but works hard. Struggles with group work. Parents are supportive."
            className="rounded-xl min-h-[90px] text-sm"
          />
          {hasNote && (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-full text-xs"
                onClick={() => onChange("")}
              >
                Clear note
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
