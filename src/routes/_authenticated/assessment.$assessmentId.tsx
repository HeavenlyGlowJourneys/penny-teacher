import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Mic, MicOff, Download, ListChecks, BarChart3, Edit3, UserX, ChevronRight,
  AlertCircle, Sparkles, Settings, Save, RefreshCw, Trash2, Plus, X, Check, MessageSquare,
  Layers, Hash, User, Loader2,
} from "lucide-react";

import { ExportSheet } from "@/components/penny/ExportSheet";
import { useSubscription } from "@/hooks/use-subscription";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/penny/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useVoice } from "@/hooks/use-voice";
import {
  matchLearnerEx, parseUtterance, parseSectionUtterance, pct, sumSections, splitMergedSectionDigits,
  isFillerToken, type LearnerLike, type Section, type MatchResult,
} from "@/lib/penny";
import { parseTranscriptWithAI } from "@/lib/ai-parse.functions";
import { dlog } from "@/lib/debug-log";
import { toast } from "sonner";
import {
  AssessmentMetadataFields, EMPTY_ASSESSMENT_METADATA,
  type AssessmentMetadata,
} from "@/components/penny/AssessmentMetadataFields";
import { TopicsCovered } from "@/components/penny/TopicsCovered";
import { ParentMessagesDialog } from "@/components/penny/ParentMessagesDialog";
import { AILockedCard } from "@/components/penny/AILockedCard";
import { useLearnerTerm, type LearnerVocab } from "@/hooks/use-teacher-settings";

export const Route = createFileRoute("/_authenticated/assessment/$assessmentId")({
  head: () => ({ meta: [{ title: "Capture marks – Penny" }] }),
  component: AssessmentPage,
});

type Mark = {
  learner_id: string;
  mark: number | null;
  status: "captured" | "absent";
  section_marks: number[] | null;
};

type Learner = LearnerLike & { active: boolean; pronouns: string | null };

function AssessmentPage() {
  const { assessmentId } = Route.useParams();
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [saveError, setSaveError] = useState<{ id: string; message: string; retry: () => Promise<void> }[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const sub = useSubscription();
  const vocab = useLearnerTerm(user.id);

  const { data: assessment } = useQuery({
    queryKey: ["assessment", assessmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assessments")
        .select("id, name, assessment_type, assessment_date, total_marks, pass_mark, capture_mode, sections, class_id, academic_year_id, term_period_id, subject, grade, category, weighting, counts_towards_report, topics_covered, classes(name, grade, subject)")
        .eq("id", assessmentId)
        .single();
      if (error) throw error;
      return data;
    },
    staleTime: 0,
    refetchOnMount: "always",
  });


  const { data: learners = [], isFetched: learnersFetched, isError: learnersError, refetch: refetchLearners } = useQuery({
    queryKey: ["learners-for", assessment?.class_id],
    enabled: !!assessment?.class_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("learners")
        .select("id, name, pronunciation, aliases, active, pronouns")
        .eq("class_id", assessment!.class_id)
        .eq("active", true)
        .order("sort_key");
      if (error) throw error;
      return (data ?? []).map((l) => ({
        id: l.id, name: l.name,
        pronunciation: l.pronunciation, aliases: (l.aliases as string[] | null) ?? [],
        active: l.active !== false,
        pronouns: l.pronouns ?? null,
      })) as Learner[];
    },
  });

  const { data: marksData = [] } = useQuery({
    queryKey: ["marks", assessmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("marks")
        .select("learner_id, mark, status, section_marks")
        .eq("assessment_id", assessmentId);
      if (error) throw error;
      return (data ?? []).map((m) => ({
        ...m,
        section_marks: (m.section_marks as number[] | null) ?? null,
      })) as Mark[];
    },
  });

  const marksMap = useMemo(() => {
    const m = new Map<string, Mark>();
    for (const x of marksData) m.set(x.learner_id, x);
    return m;
  }, [marksData]);

  const totalMarks = assessment?.total_marks ?? 0;
  const passMarkPct = assessment?.pass_mark ?? 50;
  const captureMode = (assessment?.capture_mode as "final" | "sections") ?? "final";
  const sections = (assessment?.sections as Section[] | null) ?? [];

  // Diagnostic: confirm the capture screen is using the active assessment's section config.
  useEffect(() => {
    if (!assessment) return;
    dlog("[penny:assessment-loaded]", {
      assessmentId: assessment.id,
      assessmentName: assessment.name,
      captureMode,
      loadedSections: sections.map((s) => `${s.name} /${s.total}`),
      expectedSectionCount: captureMode === "sections" ? sections.length : 1,
    });
  }, [assessment, captureMode, sections]);


  // Debounce invalidations so multi-learner segments don't trigger N refetches.
  const invalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleMarksInvalidation = useCallback(() => {
    if (invalidateTimerRef.current) clearTimeout(invalidateTimerRef.current);
    invalidateTimerRef.current = setTimeout(() => {
      qc.invalidateQueries({ queryKey: ["marks", assessmentId] });
      invalidateTimerRef.current = null;
    }, 250);
  }, [qc, assessmentId]);

  async function upsertMark(
    learnerId: string,
    mark: number | null,
    status: "captured" | "absent",
    sectionMarks: number[] | null = null,
  ): Promise<{ ok: boolean; previous?: Mark }> {
    const previous = marksMap.get(learnerId);
    // Optimistic cache update — keeps marksMapRef fresh for back-to-back captures.
    qc.setQueryData<Mark[]>(["marks", assessmentId], (old = []) => {
      const next = old.filter((m) => m.learner_id !== learnerId);
      next.push({ learner_id: learnerId, mark, status, section_marks: sectionMarks } as Mark);
      return next;
    });
    const { error } = await supabase
      .from("marks")
      .upsert(
        {
          assessment_id: assessmentId,
          learner_id: learnerId,
          teacher_id: user.id,
          mark,
          status,
          section_marks: sectionMarks,
        },
        { onConflict: "assessment_id,learner_id" },
      );
    if (error) {
      // Roll back optimistic update on failure.
      qc.setQueryData<Mark[]>(["marks", assessmentId], (old = []) => {
        const next = old.filter((m) => m.learner_id !== learnerId);
        if (previous) next.push(previous);
        return next;
      });
      const failureId = crypto.randomUUID();
      setSaveError((queue) => [
        ...queue,
        {
          id: failureId,
          message: error.message,
          retry: async () => {
            const result = await upsertMark(learnerId, mark, status, sectionMarks);
            if (result.ok) {
              setSaveError((q) => q.filter((item) => item.id !== failureId));
            }
          },
        },
      ]);
      return { ok: false };
    }
    scheduleMarksInvalidation();
    return { ok: true, previous };
  }

  async function clearMark(learnerId: string): Promise<{ ok: boolean }> {
    const previous = marksMap.get(learnerId);
    qc.setQueryData<Mark[]>(["marks", assessmentId], (old = []) =>
      old.filter((m) => m.learner_id !== learnerId),
    );
    const { error } = await supabase
      .from("marks").delete()
      .eq("assessment_id", assessmentId).eq("learner_id", learnerId);
    if (error) {
      qc.setQueryData<Mark[]>(["marks", assessmentId], (old = []) => {
        const next = old.slice();
        if (previous) next.push(previous);
        return next;
      });
      const failureId = crypto.randomUUID();
      setSaveError((queue) => [
        ...queue,
        {
          id: failureId,
          message: error.message,
          retry: async () => {
            const result = await clearMark(learnerId);
            if (result.ok) {
              setSaveError((q) => q.filter((item) => item.id !== failureId));
            }
          },
        },
      ]);
      return { ok: false };
    }
    scheduleMarksInvalidation();
    return { ok: true };
  }


  async function deleteAssessment() {
    const { error } = await supabase.from("assessments").delete().eq("id", assessmentId);
    if (error) { toast.error(error.message); return; }
    toast.success("Assessment deleted");
    navigate({ to: "/class/$classId", params: { classId: assessment!.class_id } });
  }

  function handleExport() {
    setExportOpen(true);
  }



  if (!assessment) {
    return (
      <AppShell back="/dashboard">
        <div className="rounded-2xl bg-card p-6 animate-pulse h-40" />
      </AppShell>
    );
  }

  return (
    <AppShell
      back={{ to: `/class/${assessment.class_id}` }}
      action={
        <div className="flex items-center gap-1">
          <EditAssessmentButton assessment={assessment} onSaved={() => qc.invalidateQueries({ queryKey: ["assessment", assessmentId] })} />
          <DeleteAssessmentButton onConfirm={deleteAssessment} />
          <Button variant="ghost" size="icon" onClick={handleExport} aria-label="Export"><Download className="h-5 w-5" /></Button>
        </div>
      }
    >
      <div className="mb-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {assessment.classes?.name} · out of {totalMarks}
        </p>
        <h1 className="font-display text-3xl font-semibold mt-1 leading-tight">{assessment.name}</h1>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${captureMode === "sections" ? "bg-primary-soft text-foreground" : "bg-muted text-foreground"}`}>
            {captureMode === "sections" ? <Layers className="h-3 w-3" /> : <Hash className="h-3 w-3" />}
            {captureMode === "sections" ? `Section-based · expects ${sections.length} mark${sections.length === 1 ? "" : "s"}` : "Final mark only"}
          </span>

          {captureMode === "sections" && sections.length > 0 && (
            <span className="text-[11px] text-muted-foreground">
              {sections.map((s) => `${s.name} ${s.total}`).join(" · ")}
            </span>
          )}
        </div>
      </div>

      {saveError.length > 0 && (
        <div role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 mb-3 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive flex-none mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm text-destructive">
              {saveError.length} save{saveError.length === 1 ? "" : "s"} failed. Nothing has been lost.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              const queue = saveError;
              void (async () => {
                for (const item of queue) {
                  await item.retry();
                }
              })();
            }}
            className="flex-none"
          >
            Retry
          </Button>
        </div>
      )}

      <ParentMessagesPromoCard
        canUseAI={sub.canUseAIFeatures}
        learners={learners}
        marks={marksData}
        assessmentId={assessmentId}
        teacherId={user.id}
        assessmentName={assessment.name}
        assessmentDate={assessment.assessment_date}
        subject={(assessment.subject ?? assessment.classes?.subject ?? "this subject") as string}
        totalMarks={totalMarks}
        topicsCovered={assessment.topics_covered ?? null}
      />

      <Tabs defaultValue="capture" className="w-full">
        <TabsList className="grid w-full grid-cols-3 rounded-xl h-11">
          <TabsTrigger value="capture" className="rounded-lg text-xs"><Mic className="h-4 w-4 mr-1" /> Capture</TabsTrigger>
          <TabsTrigger value="review" className="rounded-lg text-xs"><ListChecks className="h-4 w-4 mr-1" /> Review</TabsTrigger>
          <TabsTrigger value="summary" className="rounded-lg text-xs"><BarChart3 className="h-4 w-4 mr-1" /> Summary</TabsTrigger>
        </TabsList>

        <TabsContent value="capture" className="mt-4">
          <CaptureView
            learners={learners}
            learnersReady={learnersFetched && !learnersError}
            learnersError={learnersError}
            onRetryLearners={() => { void refetchLearners(); }}
            marksMap={marksMap}
            totalMarks={totalMarks}
            captureMode={captureMode}
            sections={sections}
            upsertMark={upsertMark}
            clearMark={clearMark}
            saveError={saveError}
            vocab={vocab}
            canWrite={sub.canWrite}
          />
        </TabsContent>

        <TabsContent value="review" className="mt-4">
          <ReviewView
            learners={learners}
            marksMap={marksMap}
            totalMarks={totalMarks}
            captureMode={captureMode}
            sections={sections}
            upsertMark={upsertMark}
            clearMark={clearMark}
            vocab={vocab}
          />
        </TabsContent>

        <TabsContent value="summary" className="mt-4">
          <SummaryView
            learners={learners}
            marksMap={marksMap}
            totalMarks={totalMarks}
            passMarkPct={passMarkPct}
            onExport={handleExport}
            vocab={vocab}
          />
          <div className="mt-4">
            <ParentMessagesSection
              canUseAI={sub.canUseAIFeatures}
              learners={learners}
              marks={marksData}
              assessmentId={assessmentId}
              teacherId={user.id}
              assessmentName={assessment.name}
              assessmentDate={assessment.assessment_date}
              subject={(assessment.subject ?? assessment.classes?.subject ?? "this subject") as string}
              totalMarks={totalMarks}
              topicsCovered={assessment.topics_covered ?? null}
            />
          </div>
        </TabsContent>
      </Tabs>
      <ExportSheet
        xlsxLocked={!sub.canExportExcel}
        open={exportOpen}
        onOpenChange={setExportOpen}
        assessmentId={assessmentId}
        classId={assessment.class_id}
        teacherId={user.id}
        defaultKind="assessment"
      />
    </AppShell>
  );
}

// ============================================================================
// CAPTURE — silent during listening, problems surfaced afterwards
// ============================================================================

type ActivityEntry =
  | { kind: "captured"; name: string; mark: number; previous?: number }
  | { kind: "updated"; name: string; oldMark: number; newMark: number }
  | { kind: "absent"; name: string }
  | { kind: "sections"; name: string; marks: number[]; total: number }
  | { kind: "issue"; transcript: string; reason: string; label?: string; detail?: string };

type PendingMatch =
  | { id: string; kind: "mark"; heard: string; matched: MatchResult; mark: number }
  | { id: string; kind: "absent"; heard: string; matched: MatchResult }
  | { id: string; kind: "sections"; heard: string; matched: MatchResult; marks: number[] };

function CaptureView({
  learners, learnersReady, learnersError, onRetryLearners,
  marksMap, totalMarks, captureMode, sections, upsertMark, clearMark,
  saveError, vocab, canWrite,
}: {
  learners: Learner[];
  learnersReady: boolean;
  learnersError: boolean;
  onRetryLearners: () => void;
  marksMap: Map<string, Mark>;
  totalMarks: number;
  captureMode: "final" | "sections";
  sections: Section[];
  upsertMark: (id: string, mark: number | null, status: "captured" | "absent", sectionMarks?: number[] | null) => Promise<{ ok: boolean; previous?: Mark }>;
  clearMark: (id: string) => Promise<{ ok: boolean }>;
  saveError: { id: string; message: string; retry: () => Promise<void> }[];
  vocab: LearnerVocab;
  canWrite: boolean;
}) {
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [pending, setPending] = useState<PendingMatch[]>([]);
  // Undo target — the most recent successful capture only (single-level).
  const [lastCapture, setLastCapture] = useState<
    { learnerId: string; name: string; previous: Mark | undefined } | null
  >(null);
  const aiParse = useServerFn(parseTranscriptWithAI);
  const learnersRef = useRef(learners);
  learnersRef.current = learners;
  const marksMapRef = useRef(marksMap);
  marksMapRef.current = marksMap;

  /**
   * Stateful capture context. When a learner name is recognised it becomes
   * the "current learner". Subsequent numbers-only utterances ("10", "9", "8")
   * are appended to that learner's mark buffer until: (1) the expected count
   * is reached and we flush, (2) a new learner name arrives, or (3) the
   * silence timeout expires. This makes Penny treat a marking session as one
   * conversation instead of independent fragments.
   */
  const ctxRef = useRef<{
    learner: MatchResult;
    marks: number[];
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  const clearCtx = useCallback(() => {
    if (ctxRef.current?.timer) clearTimeout(ctxRef.current.timer);
    ctxRef.current = null;
  }, []);
  const armCtxTimeout = useCallback(() => {
    if (!ctxRef.current) return;
    if (ctxRef.current.timer) clearTimeout(ctxRef.current.timer);
    ctxRef.current.timer = setTimeout(() => { ctxRef.current = null; }, 5000);
  }, []);

  const pushActivity = useCallback((e: ActivityEntry) => {
    setActivity((a) => [e, ...a].slice(0, 50));
  }, []);

  /**
   * After a successful capture for `learnerName`, remove any earlier "issue"
   * entries that mention the same learner. This is what prevents a learner
   * from appearing as BOTH "Recently captured" AND "Needs attention" — the
   * speech engine often emits a noisy trailing final after a clean utterance
   * (e.g. "Jordan 10 9 8 7 6" then "next") and that trailing piece was being
   * queued as an error against the same learner.
   */
  const pruneIssuesFor = useCallback((learnerName: string) => {
    const key = learnerName.toLowerCase();
    setActivity((a) =>
      a.filter((entry) => {
        if (entry.kind !== "issue") return true;
        const hay = `${entry.transcript} ${entry.reason}`.toLowerCase();
        return !hay.includes(key);
      }),
    );
  }, []);

  const LOW_CONFIDENCE = 0.7;

  /**
   * Single canonical save path. Every successful capture — voice (applyMark /
   * applySections / applySectionUpdate) AND manual accept of a low-confidence
   * suggestion (PendingRow) — funnels through here so we keep ONE place that
   * owns: upsert, activity feed, issue pruning, and SAVE diagnostics.
   */
  const commitCapture = useCallback(async (
    learner: LearnerLike,
    payload:
      | { kind: "mark"; mark: number }
      | { kind: "sections"; marks: number[] }
      | { kind: "absent" }
      | { kind: "sectionUpdate"; sectionIndex: number; mark: number },
  ): Promise<boolean> => {
    const prev = marksMapRef.current.get(learner.id);
    const recordUndo = () =>
      setLastCapture({ learnerId: learner.id, name: learner.name, previous: prev });

    if (payload.kind === "absent") {
      const res = await upsertMark(learner.id, null, "absent");
      if (!res.ok) {
        dlog("[penny:capture] SAVE FAIL (absent):", learner.name);
        pushActivity({ kind: "issue", label: learner.name, detail: "Save failed — tap Retry above", transcript: learner.name, reason: "Save failed — tap Retry above" });
        return false;
      }
      dlog("[penny:capture] SAVE SUCCESS (absent):", learner.name);
      pushActivity({ kind: "absent", name: learner.name });
      pruneIssuesFor(learner.name);
      recordUndo();
      return true;
    }

    if (payload.kind === "mark") {
      const res = await upsertMark(learner.id, payload.mark, "captured");
      if (!res.ok) {
        dlog("[penny:capture] SAVE FAIL (mark):", { name: learner.name, mark: payload.mark });
        pushActivity({ kind: "issue", label: learner.name, detail: "Save failed — tap Retry above", transcript: `${learner.name} ${payload.mark}`, reason: "Save failed — tap Retry above" });
        return false;
      }
      dlog("[penny:capture] SAVE SUCCESS (mark):", { name: learner.name, mark: payload.mark });
      if (prev?.status === "captured" && typeof prev.mark === "number" && prev.mark !== payload.mark) {
        pushActivity({ kind: "updated", name: learner.name, oldMark: prev.mark, newMark: payload.mark });
      } else {
        pushActivity({ kind: "captured", name: learner.name, mark: payload.mark });
      }
      pruneIssuesFor(learner.name);
      recordUndo();
      return true;
    }

    if (payload.kind === "sections") {
      const total = sumSections(payload.marks);
      const res = await upsertMark(learner.id, total, "captured", payload.marks);
      if (!res.ok) {
        dlog("[penny:capture] SAVE FAIL (sections):", { name: learner.name, marks: payload.marks });
        pushActivity({ kind: "issue", label: learner.name, detail: "Save failed — tap Retry above", transcript: `${learner.name} ${payload.marks.join(" ")}`, reason: "Save failed — tap Retry above" });
        return false;
      }
      dlog("[penny:capture] SAVE SUCCESS (sections):", { name: learner.name, marks: payload.marks, total });
      pushActivity({ kind: "sections", name: learner.name, marks: payload.marks, total });
      pruneIssuesFor(learner.name);
      recordUndo();
      return true;
    }

    // sectionUpdate
    const existing = marksMapRef.current.get(learner.id);
    const nextSections = sections.map((_, i) => existing?.section_marks?.[i] ?? 0);
    const oldVal = nextSections[payload.sectionIndex];
    nextSections[payload.sectionIndex] = payload.mark;
    const total = sumSections(nextSections);
    const res = await upsertMark(learner.id, total, "captured", nextSections);
    if (!res.ok) {
      dlog("[penny:capture] SAVE FAIL (sectionUpdate):", { name: learner.name, idx: payload.sectionIndex, mark: payload.mark });
      pushActivity({ kind: "issue", label: learner.name, detail: "Save failed — tap Retry above", transcript: `${learner.name} ${sections[payload.sectionIndex].name} ${payload.mark}`, reason: "Save failed — tap Retry above" });
      return false;
    }
    dlog("[penny:capture] SAVE SUCCESS (sectionUpdate):", { name: learner.name, idx: payload.sectionIndex, mark: payload.mark });
    pushActivity({ kind: "updated", name: `${learner.name} · ${sections[payload.sectionIndex].name}`, oldMark: oldVal, newMark: payload.mark });
    pruneIssuesFor(learner.name);
    recordUndo();
    return true;

  }, [upsertMark, pushActivity, pruneIssuesFor, sections]);

  const undoLastCapture = useCallback(async () => {
    if (!lastCapture) return;
    const { learnerId, name, previous } = lastCapture;
    if (previous) {
      const res = await upsertMark(learnerId, previous.mark, previous.status, previous.section_marks);
      if (!res.ok) return;
    } else {
      await clearMark(learnerId);
    }
    setActivity((a) => {
      // Drop the most recent non-issue entry for this learner.
      const idx = a.findIndex((e) => e.kind !== "issue" && "name" in e && e.name.startsWith(name));
      if (idx === -1) return a;
      return [...a.slice(0, idx), ...a.slice(idx + 1)];
    });
    setLastCapture(null);
    toast.success(`Undid last capture for ${name}`);
  }, [lastCapture, upsertMark, clearMark]);

  const applyMark = useCallback(async (name: string, mark: number) => {
    dlog("[penny:capture] SAVE attempt (mark):", { name, mark });
    const matched = matchLearnerEx(name, learnersRef.current);
    if (!matched) {
      pushActivity({ kind: "issue", transcript: `${name} ${mark}`, reason: `No learner matched "${name}"` });
      return;
    }
    if (mark > totalMarks) {
      pushActivity({ kind: "issue", transcript: `${matched.learner.name} ${mark}`, reason: `${mark} is above total (${totalMarks})` });
      return;
    }
    if (matched.confidence < LOW_CONFIDENCE) {
      // On uncertainty, clear any active context — we don't want a wrong learner
      // anchored as the default for subsequent numbers-only utterances.
      clearCtx();
      setPending((p) => [...p, { id: `${Date.now()}-${Math.random()}`, kind: "mark", heard: name, matched, mark }]);
      return;
    }
    await commitCapture(matched.learner, { kind: "mark", mark });
  }, [totalMarks, commitCapture, pushActivity, clearCtx]);

  const applySections = useCallback(async (name: string, marks: number[]) => {
    dlog("[penny:capture] SAVE attempt (sections):", { name, marks });
    const matched = matchLearnerEx(name, learnersRef.current);
    if (!matched) {
      pushActivity({ kind: "issue", transcript: `${name} ${marks.join(" ")}`, reason: `No learner matched "${name}"` });
      return;
    }
    for (let i = 0; i < marks.length; i++) {
      if (marks[i] > sections[i].total) {
        pushActivity({ kind: "issue", transcript: `${matched.learner.name} ${marks.join(" ")}`, reason: `Section ${sections[i].name}: ${marks[i]} > ${sections[i].total}` });
        return;
      }
    }
    if (matched.confidence < LOW_CONFIDENCE) {
      clearCtx();
      setPending((p) => [...p, { id: `${Date.now()}-${Math.random()}`, kind: "sections", heard: name, matched, marks }]);
      return;
    }
    await commitCapture(matched.learner, { kind: "sections", marks });
  }, [commitCapture, pushActivity, sections, clearCtx]);

  const applyAbsent = useCallback(async (name: string) => {
    const matched = matchLearnerEx(name, learnersRef.current);
    if (!matched) {
      pushActivity({ kind: "issue", transcript: `${name} absent`, reason: `No learner matched "${name}"` });
      return;
    }
    if (matched.confidence < LOW_CONFIDENCE) {
      clearCtx();
      setPending((p) => [...p, { id: `${Date.now()}-${Math.random()}`, kind: "absent", heard: name, matched }]);
      return;
    }
    await commitCapture(matched.learner, { kind: "absent" });
  }, [commitCapture, pushActivity, clearCtx]);

  const applySectionUpdate = useCallback(async (name: string, idx: number, mark: number) => {
    const matched = matchLearnerEx(name, learnersRef.current);
    if (!matched) {
      pushActivity({ kind: "issue", transcript: `${name} section ${idx + 1} ${mark}`, reason: `No learner matched "${name}"` });
      return;
    }
    if (mark > sections[idx].total) {
      pushActivity({ kind: "issue", transcript: `${matched.learner.name} ${sections[idx].name} ${mark}`, reason: `${mark} > ${sections[idx].total}` });
      return;
    }
    await commitCapture(matched.learner, { kind: "sectionUpdate", sectionIndex: idx, mark });
  }, [commitCapture, pushActivity, sections]);


  /**
   * Detect when a transcript is just trailing speech-engine noise targeting a
   * learner who is ALREADY captured. Returns true if we should silently drop
   * the utterance instead of queueing a misleading "needs review" item.
   */
  const isStaleEcho = useCallback((spokenName: string): boolean => {
    const matched = matchLearnerEx(spokenName, learnersRef.current);
    if (!matched || matched.confidence < LOW_CONFIDENCE) return false;
    const existing = marksMapRef.current.get(matched.learner.id);
    return !!existing && (existing.status === "captured" || existing.status === "absent");
  }, []);

  const processFinal = useCallback(async (text: string) => {
    // Debug — exposes the (coalesced) transcript we get back from the browser speech engine.
    // This is crucial because some engines collapse spoken digits ("6 6 12 13 6" → "6612136").
    dlog("[penny:capture] coalesced transcript:", text, "| mode:", captureMode, "| sections:", sections.length);

    // ============================================================
    // Stateful capture: separate the leading name tokens from the
    // trailing numeric tokens, then route the utterance based on
    // what's present. Fillers/discourse words don't count as a name.
    // ============================================================
    // Shared filler set (single source of truth in src/lib/penny.ts).
    const isFiller = (t: string) => isFillerToken(t);
    const tokens = text.replace(/[,.!?;:]+/g, " ").split(/\s+/).filter(Boolean);

    // ============================================================
    // Multi-learner segmentation. Teachers often read several learners
    // in one breath ("Aaron 55 Amara 79 Julian 68") and the speech
    // engine returns it as a single transcript. Before doing anything
    // else, scan for known-learner name boundaries inside the stream;
    // if we find ≥2 learners, split and recurse so each gets its own
    // capture path with no review-queue noise.
    // ============================================================
    // A new segment opens whenever a non-filler word appears after we've
    // already collected numbers for the current segment. We do NOT require
    // the name to match a known learner here — an unknown name must still
    // become its own segment so the rest of the transcript is preserved.
    // Each segment is then processed independently (try/catch) so a single
    // bad learner can never abort processing of later learners.
    type Segment = { name: string; nums: number[] };
    const isNumTok = (t: string) => /^\d+(\.\d+)?$/.test(t);
    const segments: Segment[] = [];
    const openSegment = () => {
      segments.push({ name: "", nums: [] });
    };
    for (const t of tokens) {
      if (isNumTok(t)) {
        if (segments.length === 0) openSegment();
        segments[segments.length - 1].nums.push(Number(t));
      } else if (!isFiller(t)) {
        const seg = segments[segments.length - 1];
        if (!seg || seg.nums.length > 0) {
          // New learner starts: either nothing yet, or previous learner
          // already has marks and a new name word arrives.
          openSegment();
        }
        // Append the word to the current segment's name buffer.
        const cur = segments[segments.length - 1];
        cur.name = cur.name ? `${cur.name} ${t}` : t;
      }
    }
    // Drop any trailing name-only segment (no numbers) so it doesn't become
    // a phantom review item — it's usually a partial utterance the engine
    // will deliver more numbers for next tick.
    while (segments.length && segments[segments.length - 1].nums.length === 0) {
      segments.pop();
    }

    dlog(
      "[penny:capture] SEGMENTS detected:",
      segments.length,
      segments.map((s) => `"${s.name} ${s.nums.join(" ")}"`),
    );

    if (segments.length >= 2) {
      dlog("[penny:capture] multi-learner segmentation:", segments);
      clearCtx();
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        const label = `[segment ${i + 1}/${segments.length}] "${s.name}" nums=[${s.nums.join(",")}]`;
        dlog(`${label} → processing`);
        try {
          await processFinal(`${s.name} ${s.nums.join(" ")}`.trim());
          dlog(`${label} ✓ done`);
        } catch (err) {
          // Error isolation: never let one segment abort the others.
          console.error(`${label} ⚠ failed — continuing`, err);
          pushActivity({
            kind: "issue",
            transcript: `${s.name} ${s.nums.join(" ")}`.trim(),
            reason: `Couldn't process "${s.name || "unknown"}" — tap to review.`,
          });
        }
      }
      return;
    }

    const numTokens: number[] = [];
    const nameTokens: string[] = [];
    let seenNum = false;
    for (const t of tokens) {
      if (/^\d+(\.\d+)?$/.test(t)) { numTokens.push(Number(t)); seenNum = true; }
      else if (!seenNum && !isFiller(t)) nameTokens.push(t);
    }
    const nameText = nameTokens.join(" ").trim();
    const expectedCount = captureMode === "sections" ? sections.length : 1;
    dlog("[segment]", {
      learner: nameText || "(none)",
      numbersDetected: numTokens,
      expectedSectionCount: expectedCount,
      willRoute:
        !nameText && numTokens.length > 0 ? "numbers-only → append to active context"
        : nameText && numTokens.length === 0 ? "name-only → set context, wait for marks"
        : nameText && numTokens.length === expectedCount ? "exact count → SAVE"
        : nameText && captureMode === "sections" && numTokens.length < sections.length ? `partial (${numTokens.length}/${sections.length}) → BUFFER, wait for more`
        : nameText && captureMode === "sections" && numTokens.length > sections.length ? `over count → trim to first ${sections.length} and SAVE`
        : "fallback parser path",
    });


    const flushCtx = async (): Promise<boolean> => {
      const c = ctxRef.current;
      if (!c) return false;
      if (c.marks.length < expectedCount) return false;
      const marks = c.marks.slice(0, expectedCount);
      const learnerName = c.learner.learner.name;
      clearCtx();
      if (captureMode === "sections") await applySections(learnerName, marks);
      else await applyMark(learnerName, marks[marks.length - 1]);
      return true;
    };

    // (a) Numbers-only utterance — attach to the current learner if any.
    if (!nameText && numTokens.length > 0) {
      if (!ctxRef.current) {
        dlog("[penny:capture] numbers without active learner — ignoring", numTokens);
        return;
      }
      ctxRef.current.marks.push(...numTokens);
      armCtxTimeout();
      dlog("[penny:capture] appended to", ctxRef.current.learner.learner.name, ctxRef.current.marks);
      await flushCtx();
      return;
    }

    // (b) Name-only utterance — set context and wait for marks.
    if (nameText && numTokens.length === 0) {
      const matched = matchLearnerEx(nameText, learnersRef.current);
      if (matched && matched.confidence >= LOW_CONFIDENCE) {
        clearCtx();
        ctxRef.current = { learner: matched, marks: [], timer: null };
        armCtxTimeout();
        dlog("[penny:capture] context set:", matched.learner.name);
        return;
      }
      // Unknown name with no marks — silently drop rather than queue an issue.
      dlog("[penny:capture] unknown name-only utterance, ignoring:", nameText);
      return;
    }

    // (c) Name + marks — route by count using our trusted inline tokenizer.
    // Digit-only tokens here means filler words like "a one day" never become
    // phantom numbers (penny.ts's word-number parser would turn "one" into 1).
    if (nameText && numTokens.length > 0) {
      // Exact count → apply directly. This is the canonical happy path.
      if (numTokens.length === expectedCount) {
        clearCtx();
        if (captureMode === "sections") return applySections(nameText, numTokens);
        return applyMark(nameText, numTokens[0]);
      }
      // Section mode, partial marks → try merged-digit recovery FIRST.
      // The speech engine often returns "2 3 5 7" as a single token "2357".
      // Split it against the section totals before falling back to BUFFER.
      if (captureMode === "sections" && numTokens.length < sections.length) {
        const sectionTotals = sections.map((s) => s.total);
        const digitConcat = numTokens.map((n) => String(Math.trunc(n))).join("");
        const recovered = splitMergedSectionDigits(digitConcat, sectionTotals);
        if (recovered && recovered.length === sections.length) {
          dlog("[merged-recovery]", { input: digitConcat, output: recovered, action: "SAVE" });
          clearCtx();
          return applySections(nameText, recovered);
        }
        dlog("[merged-recovery]", { input: digitConcat, output: null, action: "BUFFER" });
        const matched = matchLearnerEx(nameText, learnersRef.current);
        if (matched && matched.confidence >= LOW_CONFIDENCE) {
          clearCtx();
          ctxRef.current = { learner: matched, marks: [...numTokens], timer: null };
          armCtxTimeout();
          dlog("[penny:capture] context with partial marks:", matched.learner.name, numTokens);
          if (await flushCtx()) return;
          return;
        }
      }
      // Section mode, too many digit tokens → take the first N. Trailing noise
      // ("Aaron 10 10 10 10 10 6") shouldn't punish a clean read.
      if (captureMode === "sections" && numTokens.length > sections.length) {
        clearCtx();
        return applySections(nameText, numTokens.slice(0, sections.length));
      }
    }

    // A new name-bearing complete utterance starts fresh — drop any stale ctx.
    if (nameText) clearCtx();

    if (captureMode === "sections") {
      const sectionTotals = sections.map((s) => s.total);
      const parsed = parseSectionUtterance(text, sections.length, sectionTotals);
      dlog("[penny:capture] parsed section utterance:", parsed, "| totals:", sectionTotals);
      if (parsed.kind === "sectionUpdate") return applySectionUpdate(parsed.name, parsed.sectionIndex, parsed.mark);
      if (parsed.kind === "sections") return applySections(parsed.name, parsed.marks);
      if (parsed.kind === "absent") return applyAbsent(parsed.name);
      if (parsed.kind === "mark") {
        // Single number in section mode — usually noisy trailing audio for a
        // learner we just captured. Silently ignore if that learner is already saved.
        if (isStaleEcho(parsed.name)) {
          dlog("[penny:capture] dropping stale echo for already-captured learner:", parsed.name);
          return;
        }
        // Only queue a review item if the speaker is a known learner in this class.
        // Otherwise we'd surface noise like "Alex 8" when no Alex exists.
        const matched = matchLearnerEx(parsed.name, learnersRef.current);
        if (!matched || matched.confidence < LOW_CONFIDENCE) {
          dlog("[penny:capture] dropping single-mark utterance for unknown speaker:", parsed.name);
          return;
        }
        pushActivity({ kind: "issue", transcript: text, reason: `Heard only 1 mark — expected ${sections.length}. Tap to enter the rest.` });
        return;
      }
    } else {
      const parsed = parseUtterance(text);
      dlog("[penny:capture] parsed final utterance:", parsed);
      if (parsed.kind === "mark") return applyMark(parsed.name, parsed.mark);
      if (parsed.kind === "absent") return applyAbsent(parsed.name);
    }
    if (captureMode === "final") {
      try {
        const { entries } = await aiParse({
          data: { transcript: text, totalMarks, learnerNames: learnersRef.current.map((l) => l.name) },
        });
        if (entries.length === 0) {
          pushActivity({ kind: "issue", transcript: text, reason: "Couldn't understand" });
          return;
        }
        for (const e of entries) {
          if (e.kind === "mark") await applyMark(e.name, e.mark);
          else await applyAbsent(e.name);
        }
      } catch {
        pushActivity({ kind: "issue", transcript: text, reason: "Couldn't understand" });
      }
    } else {
      // Section-mode "unknown": often a trailing fragment for a learner we just
      // saved ("next", "okay", repeated digits). Try to recover a name from the
      // leading tokens — if it matches an already-captured learner, drop it.
      const leadingName = text.replace(/[0-9]+/g, " ").trim().split(/\s+/).slice(0, 3).join(" ");
      if (leadingName && isStaleEcho(leadingName)) {
        dlog("[penny:capture] dropping stale section echo:", text);
        return;
      }
      // Don't queue review items for unknown speakers — they're almost always
      // mis-recognised filler, not a real learner the teacher meant to mark.
      const matched = leadingName ? matchLearnerEx(leadingName, learnersRef.current) : null;
      if (!matched || matched.confidence < LOW_CONFIDENCE) {
        dlog("[penny:capture] dropping unknown-speaker section utterance:", text);
        return;
      }
      pushActivity({ kind: "issue", transcript: text, reason: "Didn't catch all the marks — tap to finish." });
    }
  }, [captureMode, sections, applySectionUpdate, applySections, applyAbsent, applyMark, aiParse, totalMarks, pushActivity, isStaleEcho, clearCtx, armCtxTimeout]);

  // ============================================================
  // Speech-event coalescer.
  // Chrome's webkitSpeechRecognition in continuous mode emits multiple
  // isFinal=true results for the same spoken utterance as it stabilises
  // ("Alex" → "Alex 8" → "Alex 88" → "Alex 888" → "Alex 8 8 8 8 8").
  // Without coalescing, every intermediate final hits the parser and the
  // review queue. We debounce ~800ms and keep the longest variant.
  // ============================================================
  const pendingRef = useRef<{ text: string; timer: ReturnType<typeof setTimeout> | null }>({ text: "", timer: null });
  const COALESCE_MS = 800;
  // Tracks work that hasn't reached the UI yet: a queued coalesce timer
  // and/or one-or-more in-flight processFinal calls. While > 0 the mic is
  // disabled so the teacher can't start a new recording mid-save.
  const [coalescePending, setCoalescePending] = useState(false);
  const [activeProcessing, setActiveProcessing] = useState(0);

  /**
   * Flush the currently-buffered transcript NOW (no debounce wait). Used both
   * by the debounce timer and by "unrelated next utterance" / "mic stopped" —
   * we never want to silently drop a final utterance just because another one
   * arrived close behind it.
   */
  const flushPending = useCallback(async (reason: string) => {
    const finalText = pendingRef.current.text;
    if (pendingRef.current.timer) clearTimeout(pendingRef.current.timer);
    pendingRef.current = { text: "", timer: null };
    setCoalescePending(false);
    if (!finalText) return;
    dlog("[penny:capture] flush", reason, "→", JSON.stringify(finalText));
    setActiveProcessing((n) => n + 1);
    try {
      await processFinal(finalText);
    } finally {
      setActiveProcessing((n) => Math.max(0, n - 1));
    }
  }, [processFinal]);

  const onFinal = useCallback((text: string) => {
    dlog("[penny:capture] raw final:", text);
    const prev = pendingRef.current.text;
    // If the new text extends the previous one (or vice-versa), keep the longer.
    // If they're UNRELATED utterances, flush the previous immediately rather
    // than silently dropping it — two learners spoken back-to-back must both
    // reach the parser.
    if (prev) {
      const extends_ = text.startsWith(prev) || text.includes(prev);
      const extendedBy = prev.startsWith(text) || prev.includes(text);
      if (extends_) {
        pendingRef.current.text = text;
      } else if (extendedBy) {
        pendingRef.current.text = prev;
      } else {
        // Unrelated: flush the previous utterance now, then buffer the new one.
        void flushPending("unrelated-next");
        pendingRef.current.text = text;
      }
    } else {
      pendingRef.current.text = text;
    }
    if (pendingRef.current.timer) clearTimeout(pendingRef.current.timer);
    setCoalescePending(true);
    pendingRef.current.timer = setTimeout(() => { void flushPending("debounce"); }, COALESCE_MS);
  }, [flushPending]);


  const { state, interim, start, stop: stopVoice } = useVoice(onFinal);

  // Stopping the mic must FLUSH the pending buffer, not abandon it. Teachers
  // expect "tap stop → my last utterance still saves".
  const stop = useCallback(() => {
    stopVoice();
    void flushPending("mic-stop");
  }, [stopVoice, flushPending]);


  const captured = marksMap.size;
  const total = learners.length;
  const issues = activity.filter((a) => a.kind === "issue");
  const isListening = state === "listening";
  const isProcessing = coalescePending || activeProcessing > 0;

  // -------------------------------------------------------------------------
  // First-time preparation. Teachers should never wonder whether Penny is
  // working — surface every background step (learners, voice engine, matcher,
  // final checks) and only enable the mic once everything is genuinely ready.
  // -------------------------------------------------------------------------
  type StepState = "pending" | "done" | "warn" | "error";
  const [prep, setPrep] = useState<{ learners: StepState; voice: StepState; matcher: StepState; final: StepState }>({
    learners: "pending", voice: "pending", matcher: "pending", final: "pending",
  });
  const [prepAttempt, setPrepAttempt] = useState(0);

  // Step 1: learners loaded (or surface error so teacher can retry).
  useEffect(() => {
    if (learnersError) setPrep((p) => ({ ...p, learners: "error" }));
    else if (learnersReady) setPrep((p) => (p.learners === "done" ? p : { ...p, learners: "done" }));
  }, [learnersReady, learnersError, prepAttempt]);

  // Step 2: voice engine. "unsupported" still counts as ready (manual entry).
  useEffect(() => {
    if (state === "unsupported") {
      const t = setTimeout(() => setPrep((p) => ({ ...p, voice: "warn" })), 250);
      return () => clearTimeout(t);
    }
    if (state === "idle" || state === "listening") {
      const t = setTimeout(() => setPrep((p) => (p.voice === "done" ? p : { ...p, voice: "done" })), 300);
      return () => clearTimeout(t);
    }
  }, [state, prepAttempt]);

  // Step 3: matcher warm-up — runs once learners are loaded.
  useEffect(() => {
    if (prep.learners !== "done") return;
    if (prep.matcher === "done") return;
    const t = setTimeout(() => {
      try { if (learnersRef.current.length) matchLearnerEx(learnersRef.current[0].name, learnersRef.current); } catch { /* noop */ }
      setPrep((p) => ({ ...p, matcher: "done" }));
    }, 200);
    return () => clearTimeout(t);
  }, [prep.learners, prep.matcher, prepAttempt]);

  // Step 4: final checks once everything else has settled.
  useEffect(() => {
    if (prep.learners !== "done" || (prep.voice !== "done" && prep.voice !== "warn") || prep.matcher !== "done") return;
    if (prep.final === "done") return;
    const t = setTimeout(() => setPrep((p) => ({ ...p, final: "done" })), 250);
    return () => clearTimeout(t);
  }, [prep.learners, prep.voice, prep.matcher, prep.final, prepAttempt]);

  const prepReady = prep.learners === "done" && (prep.voice === "done" || prep.voice === "warn") && prep.matcher === "done" && prep.final === "done";
  const prepFailed = prep.learners === "error";

  // Retry preparation — also nudges the learners query in case that's what failed.
  const retryPrep = useCallback(() => {
    setPrep({ learners: "pending", voice: "pending", matcher: "pending", final: "pending" });
    setPrepAttempt((n) => n + 1);
    if (learnersError) onRetryLearners();
  }, [learnersError, onRetryLearners]);

  // Stuck-preparation safety net: if we never reach "ready" within 12s, surface the retry card.
  const [prepStuck, setPrepStuck] = useState(false);
  useEffect(() => {
    setPrepStuck(false);
    if (prepReady || prepFailed) return;
    const t = setTimeout(() => setPrepStuck(true), 12000);
    return () => clearTimeout(t);
  }, [prepReady, prepFailed, prepAttempt]);

  // "Saved!" flash after a successful capture — fades automatically.
  const [savedFlash, setSavedFlash] = useState(false);
  const savedCountRef = useRef(0);
  useEffect(() => {
    const savedCount = activity.filter((a) => a.kind === "captured" || a.kind === "updated" || a.kind === "sections" || a.kind === "absent").length;
    if (savedCount > savedCountRef.current) {
      savedCountRef.current = savedCount;
      setSavedFlash(true);
      const t = setTimeout(() => setSavedFlash(false), 1800);
      return () => clearTimeout(t);
    }
    savedCountRef.current = savedCount;
  }, [activity]);

  // "Still working…" reassurance when processing exceeds ~2s.
  const [longProcessing, setLongProcessing] = useState(false);
  useEffect(() => {
    if (!isProcessing) { setLongProcessing(false); return; }
    const t = setTimeout(() => setLongProcessing(true), 2000);
    return () => clearTimeout(t);
  }, [isProcessing]);

  const micDisabled = !canWrite || state === "unsupported" || !prepReady || (!isListening && isProcessing);



  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------------------- */}
      {/* First-time preparation card. Only renders until Penny is ready.   */}
      {/* ---------------------------------------------------------------- */}
      {!prepReady && (
        <PreparationCard
          prep={prep}
          stuck={prepStuck}
          failed={prepFailed}
          onRetry={retryPrep}
        />
      )}

      {prepReady && (
        <div className="rounded-2xl bg-success/10 border border-success/40 p-3 text-sm flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-success/20">
            <Check className="h-3.5 w-3.5 text-success" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-medium">Penny is ready.</p>
            <p className="text-xs text-muted-foreground">Press the microphone and start speaking naturally.</p>
          </div>
        </div>
      )}

      {/* Capture mode reminder — prevents wrong-format mistakes */}
      <div className={`rounded-2xl p-3 text-sm ${captureMode === "sections" ? "bg-primary-soft border border-primary/30" : "bg-card-warm border border-border"}`}>
        <p className="font-medium flex items-center gap-1.5">
          {captureMode === "sections" ? <Layers className="h-4 w-4 text-primary" /> : <Hash className="h-4 w-4 text-primary" />}
          {captureMode === "sections" ? "Section mode" : "Final mark mode"}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Say e.g. {captureMode === "sections"
            ? `"Alex ${sections.map((s) => Math.max(1, Math.floor(s.total * 0.8))).join(" ")}"`
            : `"Alex ${Math.floor(totalMarks * 0.8)}"`}
        </p>
      </div>

      <div className="rounded-2xl bg-card p-4 shadow-soft flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Progress</p>
          <p className="font-display text-xl font-semibold">{captured} / {total}</p>
        </div>
        {captureMode === "sections" && (
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Sections</p>
            <p className="text-xs">{sections.map((s) => `${s.name.slice(0, 1)}·${s.total}`).join(" ")}</p>
          </div>
        )}
      </div>

      <div className="rounded-3xl bg-card p-6 shadow-warm flex flex-col items-center">
        {!canWrite && (
          <div className="w-full mb-4 rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive text-center">
            Your trial has ended — viewing is fine, but capturing marks is paused.{" "}
            <Link to="/choose-plan" search={{ cancelled: undefined }} className="font-semibold underline underline-offset-2">
              Add a payment method
            </Link>
          </div>
        )}
        <button
          onClick={isListening ? stop : start}
          disabled={micDisabled}
          className={`h-32 w-32 rounded-full flex items-center justify-center text-primary-foreground transition-all ${
            isListening ? "bg-primary mic-pulse"
              : state === "unsupported" ? "bg-muted text-muted-foreground"
              : !prepReady ? "bg-muted text-muted-foreground cursor-not-allowed"
              : isProcessing ? "bg-muted text-muted-foreground cursor-not-allowed"
              : "bg-primary hover:scale-105 shadow-warm"
          }`}
          aria-label={
            isListening ? "Stop listening"
              : state === "unsupported" ? "Voice capture unavailable — use manual entry"
              : !prepReady ? "Penny is getting ready"
              : isProcessing ? "Processing previous capture"
              : "Start listening"
          }
          aria-busy={isProcessing || !prepReady}
        >
          {isListening ? <MicOff className="h-12 w-12" />
            : (!prepReady || isProcessing) ? <Loader2 className="h-12 w-12 animate-spin" />
            : <Mic className="h-12 w-12" />}
        </button>
        <p
          className="text-base font-medium mt-4 text-center"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {!prepReady ? "Getting ready…"
            : !canWrite ? "Read-only — add a payment method to capture"
            : isListening ? "🎤 Listening…"
            : savedFlash ? "✅ Saved!"
            : isProcessing ? (longProcessing ? "Just finishing up…" : "💾 Saving marks…")
            : state === "unsupported" ? "Voice isn't supported on this browser"
            : captured === 0 ? "Tap the mic and start reading marks"
            : "Tap to continue capturing"}
        </p>
        {isListening && (
          <p className="text-sm text-muted-foreground italic mt-2 text-center min-h-[1.25rem]">
            {interim ? `"${interim}"` : `I'm listening. Say the ${vocab.singular}'s name and mark.`}
          </p>
        )}
        {!isListening && savedFlash && (
          <p className="text-sm text-muted-foreground mt-2 text-center min-h-[1.25rem]">
            Got it. Keep going whenever you're ready.
          </p>
        )}
        {!isListening && !savedFlash && isProcessing && (
          <p className="text-sm text-muted-foreground mt-2 text-center min-h-[1.25rem]">
            {longProcessing
              ? "Still working… thanks for your patience."
              : "Just a moment while I match what I heard."}
          </p>
        )}


        {!isListening && captured === 0 && (
          <div className="text-xs text-muted-foreground mt-4 text-center max-w-xs space-y-1">
            <p>Try saying:</p>
            {captureMode === "final" ? (
              <>
                <p className="font-medium text-foreground">"Anna got 15"</p>
                <p className="font-medium text-foreground">"Jordan 18"</p>
                <p className="font-medium text-foreground">"Sarah was absent"</p>
              </>
            ) : (
              <>
                <p className="font-medium text-foreground">"Alex 8 7 10 9 6"</p>
                <p className="font-medium text-foreground">"Taylor 9 8 7 10 8"</p>
              </>
            )}
          </div>
        )}
      </div>

      {saveError.length > 0 && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-sm flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-destructive flex-none" />
          <p className="font-medium text-destructive">Last save failed — check banner above</p>
        </div>
      )}

      {state === "unsupported" && (
        <div className="rounded-2xl border border-warning/40 bg-warning/10 p-3 text-sm">
          <p className="font-medium">Voice capture works best on Chrome.</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            You can still enter marks manually below or in the Review tab.
          </p>
        </div>
      )}

      {!isListening && lastCapture && (
        <div className="rounded-2xl bg-card p-3 shadow-soft flex items-center gap-3">
          <span className="text-sm flex-1 truncate">
            Last capture: <span className="font-medium">{lastCapture.name}</span>
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => { void undoLastCapture(); }}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Undo
          </Button>
        </div>
      )}

      {!isListening && !isProcessing && activity.length > 0 && (() => {
        const saved = activity.filter((a) => a.kind === "captured" || a.kind === "updated" || a.kind === "sections" || a.kind === "absent").length;
        const review = pending.length + issues.length;
        const missing = learners.filter((l) => !marksMap.has(l.id)).length;
        return (
          <div className="rounded-2xl bg-card-warm border border-border p-3 text-sm">
            <p className="font-display text-sm font-semibold mb-1">That's a wrap — here's how we did.</p>
            <ul className="text-xs space-y-0.5">
              <li>✓ {saved === 1 ? "1 mark saved" : `${saved} marks saved`}</li>
              <li>👀 {review === 1 ? "1 item needs your eye" : `${review} items need your eye`}</li>
              <li>⚠ {missing === 1 ? `1 ${vocab.singular} still missing` : `${missing} ${vocab.plural} still missing`}</li>
            </ul>
          </div>
        );
      })()}


      {/* Tiny silent feed — last 3 only, no popups, no errors */}
      {!isListening && activity.length > 0 && (
        <div className="rounded-2xl bg-card p-4 shadow-soft">
          <h3 className="font-display text-sm font-semibold flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Recently captured
          </h3>
          <ul className="mt-2 divide-y divide-border">
            {activity.filter((a) => a.kind !== "issue").slice(0, 5).map((a, i) => (
              <li key={i} className="flex items-center gap-2 py-2 text-sm">
                <span className="flex-1 truncate">{"name" in a ? a.name : ""}</span>
                <span className="text-xs font-medium">
                  {a.kind === "captured" && `${a.mark}/${totalMarks}`}
                  {a.kind === "updated" && (
                    <span className="text-primary">
                      <RefreshCw className="inline h-3 w-3 mr-1" />
                      {a.oldMark} → {a.newMark}
                    </span>
                  )}
                  {a.kind === "absent" && <span className="text-warning-foreground">Absent</span>}
                  {a.kind === "sections" && `${a.marks.join(" ")} = ${a.total}/${totalMarks}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Low-confidence review queue — never interrupts, accept or change */}
      {!isListening && pending.length > 0 && (
        <div className="rounded-2xl bg-warning/10 border border-warning/40 p-4">
          <h3 className="font-display text-sm font-semibold flex items-center gap-1.5 mb-2">
            <AlertCircle className="h-4 w-4 text-warning-foreground" />
            {pending.length} low-confidence match{pending.length === 1 ? "" : "es"}
          </h3>
          <ul className="space-y-2">
            {pending.map((p) => (
              <PendingRow
                key={p.id}
                item={p}
                learners={learners}
                totalMarks={totalMarks}
                onAccept={async (learnerId) => {
                  // Route through the same canonical save path the voice
                  // pipeline uses — keeps activity feed, issue pruning and
                  // SAVE diagnostics consistent regardless of entry point.
                  const learner = learners.find((l) => l.id === learnerId);
                  if (!learner) return;
                  if (p.kind === "mark") await commitCapture(learner, { kind: "mark", mark: p.mark });
                  else if (p.kind === "absent") await commitCapture(learner, { kind: "absent" });
                  else await commitCapture(learner, { kind: "sections", marks: p.marks });
                  setPending((arr) => arr.filter((x) => x.id !== p.id));
                }}
                onDismiss={() => setPending((arr) => arr.filter((x) => x.id !== p.id))}
              />

            ))}
          </ul>
        </div>
      )}

      {/* Issues panel — only shown when NOT listening */}
      {!isListening && issues.length > 0 && (
        <div className="rounded-2xl bg-destructive/10 border border-destructive/30 p-4">
          <h3 className="font-display text-sm font-semibold flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4 text-destructive" />
            {issues.length} item{issues.length === 1 ? "" : "s"} need your attention
          </h3>
          <ul className="mt-2 divide-y divide-destructive/15 max-h-48 overflow-y-auto">
            {issues.map((a, i) => (
              <li key={i} className="py-2 text-sm">
                <p className="font-medium truncate">"{(a as { transcript: string }).transcript}"</p>
                <p className="text-xs text-muted-foreground">{(a as { reason: string }).reason}</p>
              </li>
            ))}
          </ul>
          <button
            onClick={() => setActivity((arr) => arr.filter((a) => a.kind !== "issue"))}
            className="text-xs text-muted-foreground mt-2"
          >
            Clear issues
          </button>
        </div>
      )}

      {/* Missing-learners quick capture */}
      {!isListening && captured > 0 && (() => {
        const missing = learners.filter((l) => !marksMap.has(l.id));
        if (missing.length === 0) {
          return (
            <div className="rounded-2xl bg-success/15 border border-success/40 p-4 text-sm">
              <p className="font-medium">🎉 Every {vocab.singular} has a mark. Head to Summary.</p>
            </div>
          );
        }
        return (
          <div className="rounded-2xl bg-card p-4 shadow-soft">
            <h3 className="font-display text-sm font-semibold flex items-center gap-1.5 mb-2">
              <AlertCircle className="h-4 w-4 text-warning-foreground" />
              Missing learners ({missing.length})
            </h3>
            <p className="text-xs text-muted-foreground mb-3">Type a mark or tap Absent — no need to leave this screen.</p>
            <ul className="space-y-2 max-h-80 overflow-y-auto">
              {missing.map((l) => (
                <MissingRow
                  key={l.id}
                  learner={l}
                  totalMarks={totalMarks}
                  captureMode={captureMode}
                  sections={sections}
                  onSave={(mark, sectionMarks) => upsertMark(l.id, mark, "captured", sectionMarks)}
                  onAbsent={() => upsertMark(l.id, null, "absent")}
                />
              ))}
            </ul>
          </div>
        );
      })()}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Preparation card — shows a calm, friendly checklist while Penny boots up.
// Teachers should never wonder whether the app is working.
// ----------------------------------------------------------------------------
function PreparationCard({
  prep, stuck, failed, onRetry,
}: {
  prep: { learners: "pending" | "done" | "warn" | "error"; voice: "pending" | "done" | "warn" | "error"; matcher: "pending" | "done" | "warn" | "error"; final: "pending" | "done" | "warn" | "error" };
  stuck: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const steps: { key: keyof typeof prep; label: string; warnLabel?: string }[] = [
    { key: "learners", label: "Loading learners" },
    { key: "voice", label: "Preparing voice capture", warnLabel: "Voice not available — manual entry only" },
    { key: "matcher", label: "Building learner matching" },
    { key: "final", label: "Final checks" },
  ];
  return (
    <div className="rounded-2xl bg-card p-5 shadow-warm border border-border">
      <h3 className="font-display text-lg font-semibold">Preparing Penny…</h3>
      <p className="text-sm text-muted-foreground mt-0.5">
        Getting everything ready for voice capture. This only takes a moment.
      </p>
      <ul className="mt-4 space-y-2.5">
        {steps.map((s) => {
          const status = prep[s.key];
          return (
            <li key={s.key} className="flex items-center gap-3 text-sm">
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full flex-none ${
                  status === "done" ? "bg-success/20 text-success"
                    : status === "warn" ? "bg-warning/20 text-warning-foreground"
                    : status === "error" ? "bg-destructive/20 text-destructive"
                    : "bg-muted text-muted-foreground"
                }`}
                aria-hidden="true"
              >
                {status === "done" ? <Check className="h-3.5 w-3.5" />
                  : status === "warn" ? <AlertCircle className="h-3.5 w-3.5" />
                  : status === "error" ? <X className="h-3.5 w-3.5" />
                  : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              </span>
              <span className={status === "done" ? "text-foreground" : "text-muted-foreground"}>
                {status === "warn" && s.warnLabel ? s.warnLabel : s.label}
              </span>
            </li>
          );
        })}
      </ul>

      {(stuck || failed) && (
        <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 p-3">
          <p className="text-sm font-medium text-destructive">Penny couldn't finish getting ready.</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            This is usually a one-tap fix — no need to refresh the browser.
          </p>
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onRetry}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Retry preparation
          </Button>
        </div>
      )}
    </div>
  );
}



function MissingRow({
  learner, totalMarks, captureMode, sections, onSave, onAbsent,
}: {
  learner: Learner;
  totalMarks: number;
  captureMode: "final" | "sections";
  sections: Section[];
  onSave: (mark: number, sectionMarks: number[] | null) => Promise<{ ok: boolean }>;
  onAbsent: () => Promise<{ ok: boolean }>;
}) {
  const [val, setVal] = useState("");
  const [secVals, setSecVals] = useState<string[]>(sections.map(() => ""));

  async function save() {
    if (captureMode === "sections") {
      const nums = secVals.map((s) => Number(s));
      if (nums.some((n) => isNaN(n) || n < 0)) return toast.error("Fill all sections");
      for (let i = 0; i < nums.length; i++) {
        if (nums[i] > sections[i].total) return toast.error(`${sections[i].name}: ${nums[i]} > ${sections[i].total}`);
      }
      const total = sumSections(nums);
      await onSave(total, nums);
    } else {
      const n = Number(val);
      if (val === "" || isNaN(n)) return toast.error("Enter a mark");
      if (n < 0 || n > totalMarks) return toast.error(`Must be 0–${totalMarks}`);
      await onSave(n, null);
    }
  }

  return (
    <li className="rounded-xl border border-border bg-card-warm p-3 space-y-2">
      <p className="font-medium text-sm truncate">{learner.name}</p>
      {captureMode === "sections" ? (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 items-center">
          {sections.map((s, i) => (
            <Fragment key={i}>
              <label className="text-xs text-muted-foreground" htmlFor={`${learner.id}-sec-${i}`}>
                {s.name} <span className="text-muted-foreground/60">/{s.total}</span>
              </label>
              <Input
                id={`${learner.id}-sec-${i}`}
                type="number" inputMode="numeric" min={0} max={s.total}
                value={secVals[i]}
                onChange={(e) => setSecVals((arr) => arr.map((x, j) => j === i ? e.target.value : x))}
                onKeyDown={(e) => e.key === "Enter" && save()}
                className="h-11 rounded-lg text-base"
              />
            </Fragment>
          ))}
        </div>
      ) : (
        <Input
          type="number" inputMode="decimal" min={0} max={totalMarks}
          placeholder={`Mark out of ${totalMarks}`}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          className="h-11 rounded-lg text-base"
        />
      )}
      <div className="grid grid-cols-[1fr_1fr] gap-2 pt-1">
        <Button
          onClick={onAbsent}
          variant="outline"
          className="h-11 rounded-lg text-sm"
        >
          <UserX className="h-4 w-4 mr-1" /> Absent
        </Button>
        <Button onClick={save} className="h-11 rounded-lg text-sm">
          <Save className="h-4 w-4 mr-1" /> Save
        </Button>
      </div>
    </li>
  );
}

// ============================================================================
// REVIEW
// ============================================================================

function ReviewView({
  learners, marksMap, totalMarks, captureMode, sections, upsertMark, clearMark, vocab,
}: {
  learners: Learner[];
  marksMap: Map<string, Mark>;
  totalMarks: number;
  captureMode: "final" | "sections";
  sections: Section[];
  upsertMark: (id: string, mark: number | null, status: "captured" | "absent", sectionMarks?: number[] | null) => Promise<{ ok: boolean }>;
  clearMark: (id: string) => Promise<{ ok: boolean }>;
  vocab: LearnerVocab;
}) {
  return (
    <div className="rounded-2xl bg-card shadow-soft divide-y divide-border">
      {learners.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">No {vocab.plural} in this class.</div>
      ) : (
        learners.map((l) => (
          <ReviewRow
            key={l.id}
            learner={l}
            mark={marksMap.get(l.id)}
            totalMarks={totalMarks}
            captureMode={captureMode}
            sections={sections}
            upsertMark={upsertMark}
            clearMark={clearMark}
          />
        ))
      )}
    </div>
  );
}

function ReviewRow({
  learner, mark, totalMarks, captureMode, sections, upsertMark, clearMark,
}: {
  learner: Learner;
  mark: Mark | undefined;
  totalMarks: number;
  captureMode: "final" | "sections";
  sections: Section[];
  upsertMark: (id: string, mark: number | null, status: "captured" | "absent", sectionMarks?: number[] | null) => Promise<{ ok: boolean }>;
  clearMark: (id: string) => Promise<{ ok: boolean }>;

}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(mark?.mark != null ? String(mark.mark) : "");
  const [secVals, setSecVals] = useState<string[]>(
    sections.map((_, i) => (mark?.section_marks?.[i] != null ? String(mark!.section_marks![i]) : "")),
  );

  useEffect(() => {
    setValue(mark?.mark != null ? String(mark.mark) : "");
    setSecVals(sections.map((_, i) => (mark?.section_marks?.[i] != null ? String(mark!.section_marks![i]) : "")));
  }, [mark?.mark, mark?.section_marks, sections]);

  const status = !mark
    ? { label: "Missing", className: "text-muted-foreground bg-muted" }
    : mark.status === "absent"
    ? { label: "Absent", className: "text-warning-foreground bg-warning/30" }
    : { label: `${mark.mark}/${totalMarks}`, className: "text-success-foreground bg-success/20" };

  async function save() {
    if (captureMode === "sections") {
      const nums = secVals.map((s) => Number(s));
      if (nums.some((n) => isNaN(n) || n < 0)) return toast.error("Fill all sections");
      for (let i = 0; i < nums.length; i++) {
        if (nums[i] > sections[i].total) return toast.error(`${sections[i].name}: ${nums[i]} > ${sections[i].total}`);
      }
      const total = sumSections(nums);
      const res = await upsertMark(learner.id, total, "captured", nums);
      if (res.ok) setOpen(false);
    } else {
      const n = Number(value);
      if (value === "" || isNaN(n)) return toast.error("Enter a valid number");
      if (n < 0 || n > totalMarks) return toast.error(`Mark must be 0–${totalMarks}`);
      const res = await upsertMark(learner.id, n, "captured");
      if (res.ok) setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="w-full flex items-center gap-2 px-2 py-1 hover:bg-card-warm">
        {/* Tap name → learner profile (cross-view nav). */}
        <Link
          to="/learner/$learnerId"
          params={{ learnerId: learner.id }}
          className="flex-1 flex items-center gap-2 px-2 py-2 rounded-lg min-w-0"
          title={`Open ${learner.name}'s profile`}
        >
          <User className="h-3.5 w-3.5 text-muted-foreground flex-none" />
          <span className="flex-1 truncate font-medium">{learner.name}</span>
        </Link>
        {/* Tap mark area → edit dialog. */}
        <button onClick={() => setOpen(true)} className="flex items-center gap-2 px-2 py-2 rounded-lg" aria-label={`Edit ${learner.name}'s mark`}>
          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${status.className}`}>{status.label}</span>
          {mark != null && typeof mark.mark === "number" && mark.status === "captured" && (
            <span className="text-xs text-muted-foreground w-10 text-right">{pct(mark.mark, totalMarks)}%</span>
          )}
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
      <DialogContent className="rounded-2xl max-w-sm">
        <DialogHeader><DialogTitle className="font-display text-xl">{learner.name}</DialogTitle></DialogHeader>
        {captureMode === "sections" ? (
          <div className="space-y-2">
            {sections.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <label className="text-sm flex-1">{s.name} <span className="text-xs text-muted-foreground">/{s.total}</span></label>
                <Input
                  type="number" inputMode="decimal" min={0} max={s.total}
                  value={secVals[i]}
                  onChange={(e) => setSecVals((arr) => arr.map((x, j) => j === i ? e.target.value : x))}
                  className="h-11 w-20 rounded-lg text-center text-base"
                />
              </div>
            ))}
            <p className="text-xs text-muted-foreground text-right">
              Total: {sumSections(secVals.map(Number))} / {totalMarks}
            </p>
          </div>
        ) : (
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Mark (out of {totalMarks})</label>
            <Input
              type="number" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)}
              className="h-14 text-2xl text-center rounded-xl mt-1" min={0} max={totalMarks} autoFocus
            />
          </div>
        )}
        <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
          <Button type="button" variant="ghost" onClick={async () => { await upsertMark(learner.id, null, "absent"); setOpen(false); }} className="text-warning-foreground">
            <UserX className="h-4 w-4 mr-1" /> Absent
          </Button>
          <div className="flex gap-2">
            {mark && (
              <Button variant="ghost" onClick={async () => { await clearMark(learner.id); setOpen(false); }} className="text-destructive">Clear</Button>
            )}
            <Button onClick={save}><Edit3 className="h-4 w-4 mr-1" /> Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// SUMMARY
// ============================================================================

function SummaryView({
  learners, marksMap, totalMarks, passMarkPct, onExport, vocab,
}: {
  learners: Learner[];
  marksMap: Map<string, Mark>;
  totalMarks: number;
  passMarkPct: number;
  onExport: () => void;
  vocab: LearnerVocab;
}) {
  const stats = useMemo(() => {
    let sum = 0, count = 0, absent = 0, missing = 0, passed = 0, failed = 0;
    let highest: { id: string; name: string; mark: number } | null = null;
    let lowest: { id: string; name: string; mark: number } | null = null;
    const bands = [
      { label: "0–39", min: 0, max: 39, count: 0 },
      { label: "40–49", min: 40, max: 49, count: 0 },
      { label: "50–59", min: 50, max: 59, count: 0 },
      { label: "60–69", min: 60, max: 69, count: 0 },
      { label: "70–79", min: 70, max: 79, count: 0 },
      { label: "80+", min: 80, max: 100, count: 0 },
    ];
    for (const l of learners) {
      const m = marksMap.get(l.id);
      if (!m) { missing++; continue; }
      if (m.status === "absent") { absent++; continue; }
      if (typeof m.mark !== "number") continue;
      sum += m.mark; count++;
      const p = pct(m.mark, totalMarks);
      if (p >= passMarkPct) passed++; else failed++;
      const band = bands.find((b) => p >= b.min && p <= b.max);
      if (band) band.count++;
      if (!highest || m.mark > highest.mark) highest = { id: l.id, name: l.name, mark: m.mark };
      if (!lowest || m.mark < lowest.mark) lowest = { id: l.id, name: l.name, mark: m.mark };
    }
    const passRate = (passed + failed) > 0 ? Math.round((passed / (passed + failed)) * 100) : 0;
    return { sum, count, absent, missing, passed, failed, passRate, highest, lowest, bands };
  }, [learners, marksMap, totalMarks, passMarkPct]);

  const avg = stats.count ? stats.sum / stats.count : 0;
  const avgPct = pct(avg, totalMarks);
  const maxBand = Math.max(1, ...stats.bands.map((b) => b.count));

  const headline =
    stats.count === 0 ? "No marks captured yet — let's get started!"
    : stats.missing > 0 ? `Almost there — ${stats.missing} learner${stats.missing === 1 ? "" : "s"} still need${stats.missing === 1 ? "s" : ""} a mark.`
    : avgPct >= 70 ? `Wonderful — your class is averaging ${avgPct}%.`
    : avgPct >= 50 ? `Nicely done — your class average is ${avgPct}%.`
    : `Your class average is ${avgPct}%. They may need a little support.`;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-primary-soft border border-primary/20 p-4 text-sm">
        <p className="font-medium text-foreground">{headline}</p>
      </div>
      <div className="rounded-3xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground p-5 shadow-warm">
        <p className="text-xs uppercase tracking-wide opacity-80">Class average</p>
        <p className="font-display text-5xl font-semibold mt-1">{avgPct}%</p>
        <p className="text-sm opacity-90 mt-1">
          {stats.count ? `${avg.toFixed(1)} / ${totalMarks} across ${stats.count} learner${stats.count === 1 ? "" : "s"}` : "No marks captured yet"}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Stat label={`Passed (${stats.passRate}%)`} value={stats.passed} tone="success" />
        <Stat label="Failed" value={stats.failed} tone="destructive" />
        <Stat label="Absent" value={stats.absent} tone="warning" />
        <Stat label="Missing" value={stats.missing} tone="muted" />
      </div>
      {stats.count > 0 && (
        <div className="rounded-2xl bg-card p-4 shadow-soft">
          <h3 className="font-display text-sm font-semibold mb-3">Mark distribution</h3>
          <div className="flex items-end justify-between gap-1.5 h-32">
            {stats.bands.map((b) => {
              const heightPct = (b.count / maxBand) * 100;
              const isPass = b.min >= passMarkPct;
              return (
                <div key={b.label} className="flex-1 flex flex-col items-center justify-end gap-1.5 min-w-0">
                  <span className="text-xs font-semibold text-foreground tabular-nums">{b.count || ""}</span>
                  <div className={`w-full rounded-t-lg ${isPass ? "bg-primary" : "bg-destructive/60"}`}
                    style={{ height: `${Math.max(heightPct, b.count > 0 ? 8 : 2)}%`, minHeight: b.count > 0 ? 8 : 4 }} />
                  <span className="text-[10px] text-muted-foreground tabular-nums">{b.label}</span>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-center">Percentage bands · pass mark {passMarkPct}%</p>
        </div>
      )}
      {(stats.highest || stats.lowest) && (
        <div className="rounded-2xl bg-card p-4 shadow-soft grid grid-cols-2 gap-3">
          {stats.highest && (
            <Link to="/learner/$learnerId" params={{ learnerId: stats.highest.id }} className="block rounded-xl -m-1 p-1 hover:bg-card-warm">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Highest</p>
              <p className="font-display text-lg font-semibold mt-0.5">{stats.highest.mark}/{totalMarks}</p>
              <p className="text-xs text-primary truncate underline-offset-2 hover:underline">{stats.highest.name}</p>
            </Link>
          )}
          {stats.lowest && (
            <Link to="/learner/$learnerId" params={{ learnerId: stats.lowest.id }} className="block rounded-xl -m-1 p-1 hover:bg-card-warm">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Lowest</p>
              <p className="font-display text-lg font-semibold mt-0.5">{stats.lowest.mark}/{totalMarks}</p>
              <p className="text-xs text-primary truncate underline-offset-2 hover:underline">{stats.lowest.name}</p>
            </Link>
          )}
        </div>
      )}
      <Button onClick={onExport} className="w-full h-14 rounded-2xl text-base shadow-warm mt-2">
        <Download className="h-5 w-5 mr-1" /> Share &amp; Export
      </Button>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "success" | "destructive" | "warning" | "muted" }) {
  const colors: Record<string, string> = {
    success: "bg-success/15 text-success-foreground",
    destructive: "bg-destructive/15 text-destructive",
    warning: "bg-warning/25 text-warning-foreground",
    muted: "bg-muted text-muted-foreground",
  };
  return (
    <div className={`rounded-2xl p-4 ${colors[tone]}`}>
      <p className="text-xs uppercase tracking-wide opacity-80">{label}</p>
      <p className="font-display text-3xl font-semibold mt-1">{value}</p>
    </div>
  );
}

// ============================================================================
// EDIT / DELETE / PENDING REVIEW
// ============================================================================

type AssessmentRow = {
  id: string;
  name: string;
  assessment_type: string;
  assessment_date: string;
  total_marks: number;
  pass_mark: number;
  capture_mode?: string;
  sections?: unknown;
  academic_year_id?: string | null;
  term_period_id?: string | null;
  subject?: string | null;
  grade?: string | null;
  category?: string | null;
  weighting?: number | string | null;
  counts_towards_report?: boolean | null;
  topics_covered?: string | null;
};

function EditAssessmentButton({ assessment, onSaved }: { assessment: AssessmentRow; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(assessment.name);
  const [date, setDate] = useState(assessment.assessment_date);
  const [total, setTotal] = useState(String(assessment.total_marks));
  const [pass, setPass] = useState(String(assessment.pass_mark));
  const mode = (assessment.capture_mode as "final" | "sections") ?? "final";
  const [sections, setSections] = useState<Section[]>(
    Array.isArray(assessment.sections) ? (assessment.sections as Section[]) : [],
  );
  const [busy, setBusy] = useState(false);
  const [metadata, setMetadata] = useState<AssessmentMetadata>(EMPTY_ASSESSMENT_METADATA);
  const [topics, setTopics] = useState<string>("");

  useEffect(() => {
    if (open) {
      setName(assessment.name);
      setDate(assessment.assessment_date);
      setTotal(String(assessment.total_marks));
      setPass(String(assessment.pass_mark));
      setSections(Array.isArray(assessment.sections) ? (assessment.sections as Section[]) : []);
      setMetadata({
        academic_year_id: assessment.academic_year_id ?? null,
        term_period_id: assessment.term_period_id ?? null,
        subject: assessment.subject ?? "",
        grade: assessment.grade ?? "",
        category: assessment.category ?? "",
        weighting: assessment.weighting != null ? String(assessment.weighting) : "",
        counts_towards_report: assessment.counts_towards_report ?? false,
      });
      setTopics(assessment.topics_covered ?? "");
    }
  }, [open, assessment]);

  const sectionTotal = sections.reduce((s, x) => s + (Number(x.total) || 0), 0);

  async function save() {
    const p = Number(pass);
    let effectiveTotal = Number(total);
    if (mode === "sections") {
      if (sections.length === 0) return toast.error("Add at least one section");
      if (sections.some((s) => !s.name.trim() || !s.total)) return toast.error("Each section needs a name and total");
      effectiveTotal = sectionTotal;
    }
    if (!name.trim() || !effectiveTotal || effectiveTotal <= 0) return toast.error("Name and total marks required");
    setBusy(true);
    const weightingNum = metadata.weighting.trim() === "" ? null : Number(metadata.weighting);
    if (weightingNum !== null && Number.isNaN(weightingNum)) return toast.error("Weighting must be a number");
    const { error } = await supabase
      .from("assessments")
      .update({
        name: name.trim(),
        assessment_type: metadata.category || "Test",
        assessment_date: date,
        total_marks: effectiveTotal,
        pass_mark: isNaN(p) ? 50 : p,
        sections: mode === "sections" ? sections : [],
        academic_year_id: metadata.academic_year_id,
        term_period_id: metadata.term_period_id,
        subject: metadata.subject.trim() || null,
        grade: metadata.grade || null,
        category: metadata.category || null,
        weighting: weightingNum,
        counts_towards_report: metadata.counts_towards_report,
        topics_covered: topics.trim() || null,
      })
      .eq("id", assessment.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Updated — percentages recalculated");
      onSaved();
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Edit assessment">
        <Settings className="h-5 w-5" />
      </Button>
      <DialogContent className="rounded-2xl max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display text-xl">Edit assessment</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-11 rounded-xl mt-1" />
          </div>
          <div>

            <label className="text-xs uppercase tracking-wide text-muted-foreground">Date</label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 rounded-xl mt-1" />
          </div>
          {mode === "final" ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs uppercase tracking-wide text-muted-foreground">Out of</label>
                <Input type="number" min={1} value={total} onChange={(e) => setTotal(e.target.value)} className="h-11 rounded-xl mt-1" />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-muted-foreground">Pass (%)</label>
                <Input type="number" min={0} max={100} value={pass} onChange={(e) => setPass(e.target.value)} className="h-11 rounded-xl mt-1" />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs uppercase tracking-wide text-muted-foreground">Sections</label>
                <span className="text-xs font-medium">Total: {sectionTotal}</span>
              </div>
              {sections.map((s, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input value={s.name} onChange={(e) => setSections((arr) => arr.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} className="h-10 rounded-lg flex-1" />
                  <Input type="number" min={1} value={s.total} onChange={(e) => setSections((arr) => arr.map((x, j) => j === i ? { ...x, total: Number(e.target.value) || 0 } : x))} className="h-10 rounded-lg w-16 text-center" />
                  <button onClick={() => setSections((arr) => arr.filter((_, j) => j !== i))} className="p-2 text-muted-foreground hover:text-destructive" aria-label="Remove">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <Button type="button" variant="outline" onClick={() => setSections((arr) => [...arr, { name: `Section ${String.fromCharCode(65 + arr.length)}`, total: 10 }])} className="w-full h-10 rounded-lg">
                <Plus className="h-4 w-4 mr-1" /> Add section
              </Button>
              <div>
                <label className="text-xs uppercase tracking-wide text-muted-foreground">Pass (%)</label>
                <Input type="number" min={0} max={100} value={pass} onChange={(e) => setPass(e.target.value)} className="h-11 rounded-xl mt-1" />
              </div>
            </div>
          )}
          <div className="pt-2 border-t border-border space-y-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Details</p>
            <AssessmentMetadataFields value={metadata} onChange={setMetadata} />
            <TopicsCovered value={topics} onChange={setTopics} />
          </div>
          <p className="text-[11px] text-muted-foreground">Percentages will recalculate against the new total. Captured marks aren't changed.</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteAssessmentButton({ onConfirm }: { onConfirm: () => void | Promise<void> }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Delete assessment"><Trash2 className="h-5 w-5 text-destructive" /></Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this assessment?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the assessment details, all captured marks, section marks, and history. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Delete assessment
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function PendingRow({
  item, learners, totalMarks, onAccept, onDismiss,
}: {
  item: PendingMatch;
  learners: Learner[];
  totalMarks: number;
  onAccept: (learnerId: string) => Promise<void>;
  onDismiss: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [override, setOverride] = useState<string>(item.matched.learner.id);
  const confidence = Math.round(item.matched.confidence * 100);
  const valueLabel =
    item.kind === "mark" ? `${item.mark}/${totalMarks}`
    : item.kind === "absent" ? "Absent"
    : `${item.marks.join(" ")} = ${sumSections(item.marks)}`;

  return (
    <li className="rounded-xl bg-card p-3 shadow-soft">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground">Heard "{item.heard}" → matched</p>
          <p className="font-medium truncate">{item.matched.learner.name}</p>
          <p className="text-xs text-muted-foreground">{valueLabel} · {confidence}% confidence</p>
        </div>
      </div>
      {picking && (
        <Select value={override} onValueChange={setOverride}>
          <SelectTrigger className="h-10 rounded-lg mt-2"><SelectValue /></SelectTrigger>
          <SelectContent>
            {learners.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      <div className="flex gap-2 mt-2">
        <Button size="sm" className="flex-1 h-9" onClick={() => onAccept(picking ? override : item.matched.learner.id)}>
          <Check className="h-4 w-4 mr-1" /> {picking ? "Save" : "Accept"}
        </Button>
        <Button size="sm" variant="outline" className="h-9" onClick={() => setPicking((v) => !v)}>
          {picking ? "Cancel" : "Change"}
        </Button>
        <Button size="sm" variant="ghost" className="h-9" onClick={onDismiss} aria-label="Dismiss">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );
}

// ============================================================================
// PARENT MESSAGES — AI section on the Summary tab (subscription-gated).
// ============================================================================
function ParentMessagesPromoCard({
  canUseAI, learners, marks, assessmentId, teacherId, assessmentName, assessmentDate, subject,
  totalMarks, topicsCovered,
}: {
  canUseAI: boolean;
  learners: Learner[];
  marks: Mark[];
  assessmentId: string;
  teacherId: string;
  assessmentName: string;
  assessmentDate: string;
  subject: string;
  totalMarks: number;
  topicsCovered: string | null;
}) {
  const [open, setOpen] = useState(false);
  const hasMarks = marks.some((m) => m.status === "captured" && typeof m.mark === "number");

  if (!hasMarks) return null;

  return (
    <div className="rounded-3xl bg-card border border-primary/20 p-5 shadow-soft mb-4">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-primary-soft flex items-center justify-center shrink-0">
          <MessageSquare className="h-6 w-6 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-lg font-semibold">Generate parent messages</h3>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            Draft a WhatsApp message for every parent based on today's results.
          </p>
        </div>
      </div>
      <div className="mt-4">
        {canUseAI ? (
          <Button onClick={() => setOpen(true)} className="w-full h-11 rounded-xl">
            <Sparkles className="h-4 w-4 mr-1" /> Generate parent messages
          </Button>
        ) : (
          <Button asChild className="w-full h-11 rounded-xl">
            <Link to="/pricing">Add a payment method to unlock</Link>
          </Button>
        )}
      </div>
      {canUseAI && (
        <ParentMessagesDialog
          open={open}
          onOpenChange={setOpen}
          assessmentId={assessmentId}
          teacherId={teacherId}
          assessmentName={assessmentName}
          assessmentDate={assessmentDate}
          subject={subject}
          totalMarks={totalMarks}
          topicsCovered={topicsCovered}
          learners={learners.map((l) => ({ id: l.id, name: l.name, pronouns: l.pronouns }))}
          marks={marks.map((m) => ({ mark: m.mark, status: m.status, learner_id: m.learner_id }))}
        />
      )}
    </div>
  );
}

function ParentMessagesSection({
  canUseAI, learners, marks, assessmentId, teacherId, assessmentName, assessmentDate, subject,
  totalMarks, topicsCovered,
}: {
  canUseAI: boolean;
  learners: Learner[];
  marks: Mark[];
  assessmentId: string;
  teacherId: string;
  assessmentName: string;
  assessmentDate: string;
  subject: string;
  totalMarks: number;
  topicsCovered: string | null;
}) {
  const [open, setOpen] = useState(false);
  const hasMarks = marks.some((m) => m.status === "captured" && typeof m.mark === "number");

  if (!canUseAI) {
    return (
      <AILockedCard
        heading="Parent Messages"
        body="Penny can draft personalised parent messages for every learner after each assessment. Available with an active Penny subscription."
      />
    );
  }

  if (!hasMarks) {
    return (
      <div className="rounded-2xl bg-card p-4 shadow-soft text-sm text-muted-foreground text-center">
        No marks captured yet. Capture marks first, then Penny can write your messages.
      </div>
    );
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        variant="outline"
        className="w-full h-12 rounded-2xl text-base border-primary/30 bg-primary-soft text-primary hover:bg-primary/15"
      >
        <Sparkles className="h-4 w-4 mr-1" /> Generate parent messages
      </Button>
      <ParentMessagesDialog
        open={open}
        onOpenChange={setOpen}
        assessmentId={assessmentId}
        teacherId={teacherId}
        assessmentName={assessmentName}
        assessmentDate={assessmentDate}
        subject={subject}
        totalMarks={totalMarks}
        topicsCovered={topicsCovered}
        learners={learners.map((l) => ({ id: l.id, name: l.name, pronouns: l.pronouns }))}
        marks={marks.map((m) => ({ mark: m.mark, status: m.status, learner_id: m.learner_id }))}
      />
    </>
  );
}
