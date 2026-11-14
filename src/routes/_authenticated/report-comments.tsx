// Cross-class report comment generator.
// A class teacher selects multiple classes (the same group of learners taught
// across different subjects) and Penny writes ONE holistic report comment per
// learner, weaving all subjects into a single flowing comment plus per-subject
// Area of Focus bullets.
//
// The per-class version at /class/$classId/report-comments still exists for
// subject teachers who want per-subject comments only. Both flows share the
// same generateReportComment server function.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TopicsGapPrompt } from "@/components/penny/TopicsGapPrompt";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  BookOpen, Check, ChevronDown, ChevronRight, ChevronUp, Copy, Download, Info, Loader2, Mic, MicOff, RefreshCw, Sparkles,
} from "lucide-react";
import { useVoice } from "@/hooks/use-voice";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/penny/AppShell";
import { AILockedCard } from "@/components/penny/AILockedCard";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useSubscription } from "@/hooks/use-subscription";
import { useCurrentAcademicYear, useTermPeriods } from "@/hooks/use-academic-year";
import {
  useTeacherSettings, SENTENCE_BUCKET_LABEL, vocabFor,
  type CommentLengthType, type CommentLengthSentences,
} from "@/hooks/use-teacher-settings";
import { upsertDraft, useReportCommentDrafts } from "@/hooks/use-ai-drafts";
import {
  generateReportComment, resolvePronouns, formatReportResult,
  type NameFormat, type PronounSet, type ReportCommentInput,
  type ReportCommentResult, type SubjectData,
} from "@/lib/ai-service";
import { normalizeName, phoneticKey, pct } from "@/lib/penny";

export const Route = createFileRoute("/_authenticated/report-comments")({
  head: () => ({
    meta: [
      { title: "Class report comments – Penny" },
      { name: "description", content: "Generate one combined report comment per learner across every subject you teach them." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CrossClassReportCommentsPage,
});

type Step = "class-select" | "setup" | "review";
type AreaOfFocusSource = "topics" | "marks" | "both";

type ClassRow = {
  id: string;
  name: string;
  grade: string;
  subject: string;
  learners: { id: string; name: string; pronouns: string | null }[];
  assessmentCount: number;
};

type MergedLearner = {
  key: string;
  displayName: string;
  /** learner rows per class (learner_id → class_id). First entry is primary. */
  entries: { classId: string; learnerId: string; name: string; pronouns: string | null }[];
};

type GeneratedComment = {
  key: string;
  learnerName: string;
  primaryLearnerId: string;
  pronounSet: PronounSet;
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

const NAME_FORMAT_SHORT: Record<NameFormat, string> = {
  "first": "First",
  "full-then-first": "Full + First",
  "full": "Full",
};

const PRONOUN_OPTIONS: Array<{ value: PronounSet; label: string }> = [
  { value: "he/him", label: "He / Him" },
  { value: "she/her", label: "She / Her" },
  { value: "they/them", label: "They / Them" },
];

const AOF_SOURCE_OPTIONS: Array<{ value: AreaOfFocusSource; label: string; hint: string }> = [
  { value: "topics", label: "Based on topics I recorded", hint: "Penny uses the topics you captured for each assessment." },
  { value: "marks", label: "Based on lowest scoring assessments", hint: "Penny zooms in on the weakest assessment per subject." },
  { value: "both", label: "Both combined", hint: "Penny blends topics and lowest marks." },
];

function CrossClassReportCommentsPage() {
  const sub = useSubscription();
  if (sub.isLoading) {
    return (
      <AppShell back={{ to: "/dashboard" }}>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AppShell>
    );
  }
  if (!sub.canUseAIFeatures) {
    return (
      <AppShell back={{ to: "/dashboard" }}>
        <div className="mt-6">
          <AILockedCard
            heading="Class report comments"
            body="Let Penny draft one holistic report comment per learner across every subject you teach them. Available with an active Penny subscription."
          />
        </div>
      </AppShell>
    );
  }
  return <Flow />;
}

// ──────────────────────────────────────────────────────────────────────────
// Main flow
// ──────────────────────────────────────────────────────────────────────────

function Flow() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const { current: currentYear } = useCurrentAcademicYear();
  const { data: periods = [] } = useTermPeriods(currentYear?.id);
  const { data: teacherSettings } = useTeacherSettings(user.id);
  const vocab = vocabFor(teacherSettings?.learner_term ?? "learner");

  const [step, setStep] = useState<Step>("class-select");
  const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(new Set());

  // Setup
  const [termPeriodId, setTermPeriodId] = useState<string>("");
  const [commentType, setCommentType] = useState<"term" | "year-end">("term");
  const [commentStyle, setCommentStyle] = useState<"subject-based" | "holistic" | "both">("subject-based");
  const [nameFormat, setNameFormat] = useState<NameFormat>("full-then-first");
  const [generateGeneralComment, setGenerateGeneralComment] = useState(true);
  const [generateAreaOfFocus, setGenerateAreaOfFocus] = useState(true);
  const [aofSubjects, setAofSubjects] = useState<Set<string>>(new Set());
  const [aofSource, setAofSource] = useState<AreaOfFocusSource>("both");
  const [sampleComment, setSampleComment] = useState<string>("");
  const [lengthType, setLengthType] = useState<CommentLengthType>("sentences");
  const [lengthSentences, setLengthSentences] = useState<CommentLengthSentences>("medium");
  const [lengthWords, setLengthWords] = useState<string>("");
  // Per-learner teacher observations keyed by mergedLearner.key. Not persisted;
  // reset on refresh. Especially important for holistic comments where there
  // are no marks to reference.
  const [observations, setObservations] = useState<Record<string, string>>({});
  const setObservation = (key: string, text: string) =>
    setObservations((prev) => ({ ...prev, [key]: text }));

  // Review
  const [comments, setComments] = useState<GeneratedComment[]>([]);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [currentLearner, setCurrentLearner] = useState<string>("");

  // Seed length preferences from teacher settings.
  useEffect(() => {
    if (!teacherSettings) return;
    setLengthType(teacherSettings.comment_length_type);
    setLengthSentences(teacherSettings.comment_length_sentences);
    setLengthWords(
      teacherSettings.comment_length_words != null ? String(teacherSettings.comment_length_words) : "",
    );
  }, [teacherSettings]);

  const currentWordLimit: number | null =
    lengthType === "words"
      ? (() => {
          const n = parseInt(lengthWords, 10);
          return Number.isFinite(n) && n >= 50 && n <= 500 ? n : null;
        })()
      : null;

  // Restore preferences.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sc = window.localStorage.getItem(`penny_sample_comment_${user.id}`);
    if (sc) setSampleComment(sc);
    const nf = window.localStorage.getItem(`penny_name_format_${user.id}`);
    if (nf === "first" || nf === "full-then-first" || nf === "full") setNameFormat(nf);
  }, [user.id]);

  // Load all classes (with learners + assessment count).
  const { data: classes = [], isLoading } = useQuery({
    queryKey: ["cross-report:classes", user.id],
    queryFn: async (): Promise<ClassRow[]> => {
      const { data: cls, error } = await supabase
        .from("classes")
        .select("id, name, grade, subject, learners(id, name, pronouns, active), assessments(id)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (cls ?? []).map((c) => ({
        id: c.id, name: c.name, grade: c.grade, subject: c.subject,
        learners: ((c.learners ?? []) as { id: string; name: string; pronouns: string | null; active: boolean | null }[])
          .filter((l) => l.active !== false)
          .map((l) => ({ id: l.id, name: l.name, pronouns: l.pronouns })),
        assessmentCount: (c.assessments as { id: string }[] | null)?.length ?? 0,
      }));
    },
  });

  // Pre-select all classes on first load.
  useEffect(() => {
    if (classes.length && selectedClassIds.size === 0) {
      setSelectedClassIds(new Set(classes.map((c) => c.id)));
    }
  }, [classes, selectedClassIds.size]);

  // Detect "same group of learners" — clusters of classes that share ≥50%
  // learner name overlap. If any cluster has ≥2 classes we show the hint.
  const clusterHint = useMemo(() => {
    if (classes.length < 2) return false;
    const keySets = classes.map((c) => new Set(c.learners.map((l) => phoneticKey(l.name))));
    for (let i = 0; i < classes.length; i++) {
      for (let j = i + 1; j < classes.length; j++) {
        const a = keySets[i], b = keySets[j];
        if (a.size === 0 || b.size === 0) continue;
        let shared = 0;
        for (const k of a) if (b.has(k)) shared++;
        const smaller = Math.min(a.size, b.size);
        if (shared / smaller >= 0.5) return true;
      }
    }
    return false;
  }, [classes]);

  const selectedClasses = useMemo(
    () => classes.filter((c) => selectedClassIds.has(c.id)),
    [classes, selectedClassIds],
  );

  // Load assessments (metadata) + marks for the SELECTED classes only.
  const selectedIdList = useMemo(() => [...selectedClassIds].sort(), [selectedClassIds]);
  const { data: assessments = [] } = useQuery({
    queryKey: ["cross-report:assessments", selectedIdList],
    enabled: selectedIdList.length > 0 && step !== "class-select",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assessments")
        .select("id, name, category, assessment_type, total_marks, term_period_id, topics_covered, subject, class_id")
        .in("class_id", selectedIdList);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: allMarks = [] } = useQuery({
    queryKey: ["cross-report:marks", selectedIdList],
    enabled: selectedIdList.length > 0 && step !== "class-select",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("marks")
        .select("mark, status, learner_id, assessment_id, assessments!inner(class_id)")
        .in("assessments.class_id", selectedIdList);
      if (error) throw error;
      return (data ?? []) as Array<{
        mark: number | null; status: string; learner_id: string; assessment_id: string;
      }>;
    },
  });

  // Assessments scoped to term period (if chosen).
  const scopedAssessments = useMemo(
    () => assessments.filter((a) => !termPeriodId || a.term_period_id === termPeriodId),
    [assessments, termPeriodId],
  );

  // Unique subjects across selected classes' scoped assessments.
  const availableSubjects = useMemo(() => {
    const bySubject = new Set<string>();
    const classSubjectById = new Map(selectedClasses.map((c) => [c.id, c.subject] as const));
    for (const a of scopedAssessments) {
      const s = (a.subject ?? classSubjectById.get(a.class_id) ?? "").trim() || "General";
      bySubject.add(s);
    }
    return Array.from(bySubject).sort((a, b) => a.localeCompare(b));
  }, [scopedAssessments, selectedClasses]);

  // Default AoF subjects to all whenever the pool changes.
  useEffect(() => {
    setAofSubjects(new Set(availableSubjects));
  }, [availableSubjects]);

  // Merge learners across selected classes by phonetic key.
  const mergedLearners: MergedLearner[] = useMemo(() => {
    const map = new Map<string, MergedLearner>();
    // Iterate classes in selection order so the FIRST selected class provides
    // the primary learner record for draft persistence.
    for (const c of selectedClasses) {
      for (const l of c.learners) {
        const key = phoneticKey(normalizeName(l.name)) || normalizeName(l.name) || l.id;
        const entry = { classId: c.id, learnerId: l.id, name: l.name, pronouns: l.pronouns };
        const existing = map.get(key);
        if (!existing) {
          map.set(key, { key, displayName: l.name, entries: [entry] });
        } else {
          existing.entries.push(entry);
          // Prefer the longest / most complete name for display.
          if (l.name.length > existing.displayName.length) existing.displayName = l.name;
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [selectedClasses]);

  // Existing drafts (matched by primary learner id).
  const primaryLearnerIds = useMemo(
    () => mergedLearners.map((m) => m.entries[0].learnerId),
    [mergedLearners],
  );
  const { data: existingDrafts = [] } = useReportCommentDrafts(primaryLearnerIds, termPeriodId || null);

  const selectedPeriod = periods.find((p) => p.id === termPeriodId) ?? null;

  // ─── build combined data for one merged learner ───────────────────────
  function buildSubjectData(merged: MergedLearner): { subjectData: SubjectData[]; termMark: number | null } {
    const learnerIds = new Set(merged.entries.map((e) => e.learnerId));
    const classSubjectById = new Map(selectedClasses.map((c) => [c.id, c.subject] as const));
    const classNameById = new Map(selectedClasses.map((c) => [c.id, c.name] as const));
    const asmtsById = new Map(scopedAssessments.map((a) => [a.id, a] as const));

    const bySubject = new Map<string, SubjectData>();
    let sumMark = 0, sumTotal = 0;

    for (const m of allMarks) {
      if (!learnerIds.has(m.learner_id)) continue;
      if (m.status !== "captured" || typeof m.mark !== "number") continue;
      const a = asmtsById.get(m.assessment_id);
      if (!a) continue;
      const subject = (a.subject ?? classSubjectById.get(a.class_id) ?? "").trim() || "General";
      const className = classNameById.get(a.class_id) ?? "";
      const p = pct(m.mark, a.total_marks);
      const entry = bySubject.get(subject) ?? {
        subject, assessments: [], termMark: null, lowestAssessment: null,
      };
      entry.assessments.push({
        name: className ? `${a.name} (${className})` : a.name,
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

    for (const sd of bySubject.values()) {
      let sm = 0, st = 0, low = sd.assessments[0] ?? null;
      for (const a of sd.assessments) {
        sm += a.mark; st += a.total;
        if (low && a.percentage < low.percentage) low = a;
      }
      sd.termMark = st > 0 ? Math.round((sm / st) * 100) : null;
      sd.lowestAssessment = low ? `${low.name} (${low.percentage}%)` : null;
    }

    return {
      subjectData: Array.from(bySubject.values()).sort((a, b) => a.subject.localeCompare(b.subject)),
      termMark: sumTotal > 0 ? Math.round((sumMark / sumTotal) * 100) : null,
    };
  }

  function buildInput(
    merged: MergedLearner, pronounSet: PronounSet, nf: NameFormat,
  ): { input: ReportCommentInput; termMark: number | null } {
    const { subjectData, termMark } = buildSubjectData(merged);
    const input: ReportCommentInput = {
      learnerName: merged.displayName,
      pronounSet,
      nameFormat: nf,
      commentType,
      commentStyle,
      generateGeneralComment,
      generateAreaOfFocus,
      areaOfFocusSubjects: Array.from(aofSubjects),
      areaOfFocusSource: aofSource,
      termName: selectedPeriod?.name ?? "this term",
      academicYear: currentYear?.name ?? "this year",
      subjectData,
      teacherSampleComment: sampleComment.trim() || null,
      commentLengthType: lengthType,
      commentLengthValue: lengthType === "words" ? (currentWordLimit ?? undefined) : lengthSentences,
      teacherObservation: (observations[merged.key] ?? "").trim() || null,
      learnerTerm: teacherSettings?.learner_term ?? "learner",
    };
    return { input, termMark };
  }

  async function persistDraft(c: GeneratedComment, isEdited: boolean) {
    try {
      await upsertDraft({
        teacherId: user.id,
        draftType: "report_comment",
        learnerId: c.primaryLearnerId,
        termPeriodId: termPeriodId || null,
        content: JSON.stringify(c.result),
        commentType,
        isEdited,
      });
    } catch { /* silent */ }
  }

  async function generateForMerged(merged: MergedLearner): Promise<GeneratedComment> {
    const seed = merged.entries.find((e) => e.pronouns) ?? merged.entries[0];
    const { pronouns, needsConfirmation } = resolvePronouns(merged.displayName, seed.pronouns);
    const { input, termMark } = buildInput(merged, pronouns, nameFormat);
    try {
      const result = await generateReportComment({ data: input });
      return {
        key: merged.key,
        learnerName: merged.displayName,
        primaryLearnerId: merged.entries[0].learnerId,
        pronounSet: pronouns,
        needsPronounConfirmation: needsConfirmation,
        nameFormat, result, termMark,
      };
    } catch (e) {
      return {
        key: merged.key,
        learnerName: merged.displayName,
        primaryLearnerId: merged.entries[0].learnerId,
        pronounSet: pronouns,
        needsPronounConfirmation: needsConfirmation,
        nameFormat,
        result: { generalComment: null, areaOfFocus: null },
        termMark,
        error: e instanceof Error ? e.message : "Something went wrong — nothing was lost. Try again.",
      };
    }
  }

  async function handleGenerate() {
    if (mergedLearners.length === 0) {
      toast.error(`No ${vocab.plural} in the selected classes.`);
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
    if (typeof window !== "undefined") {
      if (sampleComment.trim()) window.localStorage.setItem(`penny_sample_comment_${user.id}`, sampleComment);
      else window.localStorage.removeItem(`penny_sample_comment_${user.id}`);
      window.localStorage.setItem(`penny_name_format_${user.id}`, nameFormat);
    }
    setGenerating(true);
    setStep("review");
    setProgress({ done: 0, total: mergedLearners.length });
    setComments(mergedLearners.map((m) => {
      const seed = m.entries.find((e) => e.pronouns) ?? m.entries[0];
      const { pronouns, needsConfirmation } = resolvePronouns(m.displayName, seed.pronouns);
      return {
        key: m.key,
        learnerName: m.displayName,
        primaryLearnerId: m.entries[0].learnerId,
        pronounSet: pronouns,
        needsPronounConfirmation: needsConfirmation,
        nameFormat,
        result: { generalComment: null, areaOfFocus: null },
        termMark: null,
        loading: true,
      };
    }));

    for (let i = 0; i < mergedLearners.length; i++) {
      const m = mergedLearners[i];
      setCurrentLearner(m.displayName);
      const r = await generateForMerged(m);
      setComments((prev) => prev.map((c) => (c.key === m.key ? { ...r, loading: false } : c)));
      setProgress({ done: i + 1, total: mergedLearners.length });
      void persistDraft(r, false);
    }
    setGenerating(false);
    setCurrentLearner("");
    const subjectCount = availableSubjects.length;
    toast.success(`Comments ready for all ${mergedLearners.length} ${vocab.plural} across ${subjectCount} subject${subjectCount === 1 ? "" : "s"}.`);
  }

  async function regenerateCard(key: string, pronounSet: PronounSet, nf: NameFormat) {
    const merged = mergedLearners.find((m) => m.key === key);
    if (!merged) return;
    setComments((prev) => prev.map((c) => (c.key === key
      ? { ...c, pronounSet, nameFormat: nf, loading: true, error: null }
      : c)));
    // Persist pronoun choice against the primary learner record.
    const primary = merged.entries[0].learnerId;
    void supabase.from("learners").update({ pronouns: pronounSet }).eq("id", primary);
    const { input, termMark } = buildInput(merged, pronounSet, nf);
    try {
      const result = await generateReportComment({ data: input });
      setComments((prev) => prev.map((c) => (c.key === key
        ? { ...c, pronounSet, needsPronounConfirmation: false, nameFormat: nf, result, termMark, loading: false }
        : c)));
      const primary = merged.entries[0].learnerId;
      void persistDraft({
        key, learnerName: merged.displayName,
        primaryLearnerId: primary,
        pronounSet, needsPronounConfirmation: false, nameFormat: nf, result, termMark,
      }, false);
    } catch (e) {
      setComments((prev) => prev.map((c) => (c.key === key
        ? { ...c, loading: false, error: e instanceof Error ? e.message : "Something went wrong." }
        : c)));
    }
  }

  function handleEditGeneral(key: string, text: string) {
    setComments((prev) => prev.map((c) => {
      if (c.key !== key) return c;
      const next = { ...c, result: { ...c.result, generalComment: text } };
      void persistDraft(next, true);
      return next;
    }));
  }

  function handleEditFocus(key: string, subject: string, bullets: string[]) {
    setComments((prev) => prev.map((c) => {
      if (c.key !== key) return c;
      const af = { ...(c.result.areaOfFocus ?? {}) };
      af[subject] = bullets;
      const next = { ...c, result: { ...c.result, areaOfFocus: af } };
      void persistDraft(next, true);
      return next;
    }));
  }

  function loadPreviousDrafts() {
    const byLearner = new Map(existingDrafts.map((d) => [d.learner_id, d]));
    const loaded: GeneratedComment[] = mergedLearners.map((m) => {
      const seed = m.entries.find((e) => e.pronouns) ?? m.entries[0];
      const { pronouns, needsConfirmation } = resolvePronouns(m.displayName, seed.pronouns);
      const primary = m.entries[0].learnerId;
      const d = byLearner.get(primary);
      let result: ReportCommentResult = { generalComment: null, areaOfFocus: null };
      if (d) {
        try {
          const obj = JSON.parse(d.content);
          if (obj && typeof obj === "object") {
            result = {
              generalComment: typeof obj.generalComment === "string" ? obj.generalComment : null,
              areaOfFocus: (obj.areaOfFocus && typeof obj.areaOfFocus === "object") ? obj.areaOfFocus : null,
            };
          }
        } catch { result = { generalComment: d.content, areaOfFocus: null }; }
      }
      return {
        key: m.key,
        learnerName: m.displayName,
        primaryLearnerId: primary,
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

  function exportToExcel() {
    const subjectSet = new Set<string>();
    for (const c of comments) {
      if (c.result.areaOfFocus) for (const k of Object.keys(c.result.areaOfFocus)) subjectSet.add(k);
    }
    const subjects = Array.from(subjectSet).sort((a, b) => a.localeCompare(b));
    const header = ["Learner Name", "General Comment", ...subjects.map((s) => `${s} Focus`), "Term Mark"];
    const rows = comments.map((c) => {
      const cols = subjects.map((s) => {
        const b = c.result.areaOfFocus?.[s];
        return b && b.length ? b.map((x) => `• ${x}`).join("\n") : "";
      });
      return [c.learnerName, c.result.generalComment ?? "", ...cols, c.termMark != null ? c.termMark / 100 : null];
    });
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const termCol = header.length - 1;
    for (let i = 0; i < rows.length; i++) {
      const addr = XLSX.utils.encode_cell({ r: i + 1, c: termCol });
      const cell = ws[addr];
      if (cell && typeof cell.v === "number") cell.z = "0%";
    }
    ws["!cols"] = [{ wch: 24 }, { wch: 70 }, ...subjects.map(() => ({ wch: 40 })), { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report Comments");
    XLSX.writeFile(wb, `penny_class_report_comments_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function toggleClass(id: string) {
    setSelectedClassIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSubject(s: string) {
    setAofSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  }

  // ─── STEP 1: class selection ─────────────────────────────────────────
  if (step === "class-select") {
    return (
      <AppShell back={{ to: "/dashboard" }}>
        <div className="mb-4">
          <h1 className="font-display text-3xl font-semibold leading-tight">
            Who are you writing comments for?
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            Select all the classes that belong to the same group of {vocab.plural}.
          </p>
        </div>

        {clusterHint && (
          <div className="mb-4 rounded-2xl bg-primary-soft border border-primary/20 p-4 flex gap-3">
            <Info className="h-4 w-4 text-primary flex-none mt-0.5" />
            <p className="text-xs leading-relaxed">
              These classes look like they might be the same group of {vocab.plural} taught across different subjects.
              Selecting them all will generate one combined comment per {vocab.singular}.
            </p>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-2xl bg-card animate-pulse" />
            ))}
          </div>
        ) : classes.length === 0 ? (
          <div className="rounded-2xl bg-card p-6 text-center shadow-soft">
            <p className="text-sm text-muted-foreground">
              Add a class first to generate report comments.
            </p>
            <Button asChild className="mt-3 rounded-xl">
              <Link to="/dashboard">Back to dashboard</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-2 pb-24">
            {classes.map((c) => {
              const selected = selectedClassIds.has(c.id);
              return (
                <label
                  key={c.id}
                  className={`flex items-center gap-3 rounded-2xl p-4 shadow-soft cursor-pointer transition-colors ${
                    selected ? "bg-primary-soft border-2 border-primary" : "bg-card border-2 border-transparent"
                  }`}
                >
                  <Checkbox
                    checked={selected}
                    onCheckedChange={() => toggleClass(c.id)}
                    className="h-5 w-5"
                  />
                  <div className="h-11 w-11 flex-none rounded-xl bg-background text-primary flex items-center justify-center">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-display text-base font-semibold truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {c.subject} — {c.learners.length} {c.learners.length === 1 ? vocab.singular : vocab.plural},{" "}
                      {c.assessmentCount} assessment{c.assessmentCount === 1 ? "" : "s"}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        )}

        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md">
          <Button
            size="lg"
            className="w-full h-14 rounded-2xl text-base shadow-warm"
            onClick={() => {
              if (selectedClassIds.size === 0) {
                toast.error("Select at least one class to get started.");
                return;
              }
              setStep("setup");
            }}
            disabled={classes.length === 0}
          >
            Next — set up comments <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </AppShell>
    );
  }

  // ─── STEP 2: setup ───────────────────────────────────────────────────
  if (step === "setup") {
    return (
      <AppShell
        back={{ to: "/dashboard" }}
        action={
          <Button variant="ghost" size="sm" onClick={() => setStep("class-select")} className="rounded-full">
            Change classes
          </Button>
        }
      >
        <div className="mb-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {selectedClasses.length} class{selectedClasses.length === 1 ? "" : "es"} · {mergedLearners.length} {vocab.plural}
          </p>
          <h1 className="font-display text-3xl font-semibold mt-1 leading-tight">Set up comments</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Penny will draft one holistic comment per {vocab.singular} that covers every subject you selected.
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
                <Link to="/settings/academic-year" className="underline text-primary">Set up your academic year</Link>{" "}
                to group assessments by term.
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
            onSaved={() => qc.invalidateQueries({ queryKey: ["cross-report:assessments", selectedIdList] })}
          />

          {/* Per-learner observations — optional personal notes (voice or typed). */}
          <div className="rounded-2xl border border-input p-4 space-y-3">
            <div>
              <p className="text-sm font-semibold">Tell Penny about your {vocab.plural}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Optional — add a personal note about any {vocab.singular}. Penny will weave your observations in naturally. Especially useful for holistic comments.
              </p>
            </div>
            <div className="space-y-2">
              {mergedLearners.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No {vocab.plural} in the selected classes yet.</p>
              ) : (
                mergedLearners.map((m) => (
                  <LearnerObservationRow
                    key={m.key}
                    learnerKey={m.key}
                    learnerName={m.displayName}
                    value={observations[m.key] ?? ""}
                    onChange={(text) => setObservation(m.key, text)}
                  />
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-input p-4 space-y-4">
            <p className="text-sm font-semibold">What to generate</p>

            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">General comment</p>
                <p className="text-xs text-muted-foreground">One flowing paragraph per {vocab.singular}.</p>
              </div>
              <Switch checked={generateGeneralComment} onCheckedChange={setGenerateGeneralComment} />
            </div>

            {generateGeneralComment && (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Comment type</p>
                <div className="space-y-2">
                  {([
                    { value: "subject-based", label: "Subject-based", hint: "Penny weaves marks and topics from selected subjects into one flowing comment." },
                    { value: "holistic", label: "General holistic", hint: `Penny writes about the ${vocab.singular} as a whole person — character, attitude, effort, classroom presence. No marks or subject references.` },
                    { value: "both", label: "Both", hint: "Holistic opening paragraph followed by subject performance." },
                  ] as const).map((opt) => {
                    const selected = commentStyle === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setCommentStyle(opt.value)}
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
                {(commentStyle === "holistic" || commentStyle === "both") && (
                  <p className="text-xs text-muted-foreground italic pt-1">
                    Tip: add a voice or typed observation for each {vocab.singular} below — for holistic comments there are no marks to lean on, so your notes shape the tone.
                  </p>
                )}
              </div>
            )}

            <div className="border-t pt-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Area of Focus</p>
                  <p className="text-xs text-muted-foreground">Bullet points per subject the {vocab.singular} can work on.</p>
                </div>
                <Switch checked={generateAreaOfFocus} onCheckedChange={setGenerateAreaOfFocus} />
              </div>

              {generateAreaOfFocus && (
                <div className="mt-3 space-y-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Subjects</p>
                    {availableSubjects.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">
                        No subjects found in {termPeriodId ? "this term" : "the selected classes"} yet. Capture assessments first.
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
            <Label className="text-sm font-medium">Style guide (optional)</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Paste a report comment you have written before. Penny will match your tone and style.
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
            <p className="font-medium">You have previous drafts.</p>
            <p className="text-xs text-muted-foreground mt-1">
              {existingDrafts.length} draft{existingDrafts.length === 1 ? "" : "s"} saved. Load them or generate fresh.
            </p>
            <div className="mt-3 flex gap-2">
              <Button variant="outline" className="flex-1 h-10 rounded-xl" onClick={loadPreviousDrafts}>Load previous drafts</Button>
              <Button variant="ghost" className="flex-1 h-10 rounded-xl" onClick={handleGenerate}>Generate fresh</Button>
            </div>
          </div>
        )}

        <Button
          className="w-full h-12 rounded-2xl text-base mt-4 shadow-warm"
          onClick={handleGenerate}
          disabled={mergedLearners.length === 0}
        >
          <Sparkles className="h-4 w-4 mr-1" /> Generate comments
        </Button>
        {mergedLearners.length === 0 && (
          <p className="text-xs text-muted-foreground text-center mt-2">
            No {vocab.plural} in the selected classes yet.
          </p>
        )}
      </AppShell>
    );
  }

  // ─── STEP 3: review ──────────────────────────────────────────────────
  return (
    <AppShell
      back={{ to: "/dashboard" }}
      action={
        <Button variant="ghost" size="sm" onClick={() => setStep("setup")} className="rounded-full">
          Setup
        </Button>
      }
    >
      <div className="mb-4">
        <h1 className="font-display text-2xl font-semibold">Class report comments</h1>
        {generating ? (
          <>
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Penny is getting to know your whole class — this might take a moment.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {progress.done}/{progress.total} · {currentLearner || "warming up…"}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground mt-1">
            Review and copy when you are. One comment per {vocab.singular}, all subjects included.
          </p>
        )}
      </div>

      <div className="space-y-3">
        {comments.map((c) => (
          <CommentCard
            key={c.key}
            comment={c}
            wordLimit={currentWordLimit}
            onEditGeneral={(text) => handleEditGeneral(c.key, text)}
            onEditFocus={(subject, bullets) => handleEditFocus(c.key, subject, bullets)}
            onRegenerate={() => regenerateCard(c.key, c.pronounSet, c.nameFormat)}
            onPronounChange={(p) => regenerateCard(c.key, p, c.nameFormat)}
            onNameFormatChange={(nf) => regenerateCard(c.key, c.pronounSet, nf)}
          />
        ))}
      </div>

      {!generating && comments.length > 0 && (
        <Button onClick={exportToExcel} className="w-full h-12 rounded-2xl text-base mt-4 shadow-warm">
          <Download className="h-4 w-4 mr-1" /> Export all to Excel
        </Button>
      )}
    </AppShell>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// CommentCard
// ──────────────────────────────────────────────────────────────────────────

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
  const wordCount = comment.result.generalComment
    ? comment.result.generalComment.trim().split(/\s+/).filter(Boolean).length
    : 0;
  const overLimit = wordLimit != null && wordCount > wordLimit;

  async function handleCopy() {
    const text = formatReportResult(comment.learnerName, comment.result);
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { toast.error("Couldn't copy — try again."); }
  }

  return (
    <div className="rounded-2xl bg-card p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold truncate">{comment.learnerName}</p>
          {comment.termMark != null && (
            <p className="text-xs text-muted-foreground">Overall term mark {comment.termMark}%</p>
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
                  {wordCount} {wordCount === 1 ? "word" : "words"}
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
            <div className={comment.needsPronounConfirmation ? "rounded-xl border border-amber-300/70 bg-amber-50/70 p-2" : ""}>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Pronouns</p>
              <div className={`inline-flex rounded-full border bg-background p-0.5 ${comment.needsPronounConfirmation ? "ring-2 ring-amber-400/70" : ""}`}>
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
                <p className="text-[11px] text-amber-800 mt-1.5">Please confirm pronouns for this {`\u200B`}learner.</p>
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
  learnerKey, learnerName, value, onChange,
}: {
  learnerKey: string;
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
        aria-controls={`obs-${learnerKey}`}
      >
        <span className="text-sm font-medium truncate">{learnerName}</span>
        <span className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
          {hasNote && !open && <span className="italic truncate max-w-[9rem]">Note added</span>}
          {open ? <ChevronUp className="h-4 w-4" /> : (
            <span className="inline-flex items-center gap-1 text-primary font-medium">+ Add observation</span>
          )}
          {open && <ChevronDown className="h-4 w-4 rotate-180" />}
        </span>
      </button>
      {open && (
        <div id={`obs-${learnerKey}`} className="px-3 pb-3 space-y-2 border-t border-input/60 pt-3">
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
            placeholder="e.g. Very shy but works hard. Kind to classmates. Growing in confidence this term."
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
