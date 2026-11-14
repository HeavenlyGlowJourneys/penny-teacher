import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Play, Send, Copy, Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { OralAssessmentShell } from "@/features/oral-assessment/components/OralAssessmentShell";
import {
  deleteOralAssessment,
  getOralAssessment,
  inviteStudentToAssessment,
  inviteStudentsBatch,
  publishOralAssessment,
  regenerateOralAssessment,
  resendOralInvite,
  revokeOralInvite,
  saveOralAssessmentMemo,
  saveOralAssessmentQuestions,
  saveOralAssessmentRubric,
  saveOralAssessmentDetails,
  updateOralAssessmentSettings,
} from "@/features/oral-assessment/services/assessment.functions";
import { startDemoInterviewSession } from "@/features/oral-assessment/services/interview.functions";
import type { AssessmentAnalysis, RubricCriterionDraft } from "@/features/oral-assessment/types";
import { RUBRIC_TEMPLATES } from "@/features/oral-assessment/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type DetailData = Awaited<ReturnType<typeof getOralAssessment>>;
type EditableQuestion = DetailData["questions"][number];
type EditableCriterion = RubricCriterionDraft;

export function AssessmentDetailPage({ assessmentId }: { assessmentId: string }) {
  const navigate = useNavigate();
  const load = useServerFn(getOralAssessment);
  const publish = useServerFn(publishOralAssessment);
  const regenerate = useServerFn(regenerateOralAssessment);
  const invite = useServerFn(inviteStudentToAssessment);
  const inviteBatch = useServerFn(inviteStudentsBatch);
  const resendInvite = useServerFn(resendOralInvite);
  const revokeInvite = useServerFn(revokeOralInvite);
  const saveSettings = useServerFn(updateOralAssessmentSettings);
  const saveQuestions = useServerFn(saveOralAssessmentQuestions);
  const saveMemo = useServerFn(saveOralAssessmentMemo);
  const saveRubric = useServerFn(saveOralAssessmentRubric);
  const saveDetails = useServerFn(saveOralAssessmentDetails);
  const deleteAssessment = useServerFn(deleteOralAssessment);
  const startDemo = useServerFn(startDemoInterviewSession);

  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [batchLines, setBatchLines] = useState("");
  const [durationMins, setDurationMins] = useState(15);
  const [extraTime, setExtraTime] = useState(1);
  const [questionMode, setQuestionMode] = useState<"same" | "varied">("same");
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [questions, setQuestions] = useState<EditableQuestion[]>([]);
  const [questionsDirty, setQuestionsDirty] = useState(false);
  const [memorandum, setMemorandum] = useState("");
  const [memoDirty, setMemoDirty] = useState(false);
  const [criteriaDraft, setCriteriaDraft] = useState<EditableCriterion[]>([]);
  const [rubricTitle, setRubricTitle] = useState("Oral assessment rubric");
  const [rubricDirty, setRubricDirty] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [summaryDraft, setSummaryDraft] = useState("");
  const [outcomesDraft, setOutcomesDraft] = useState<string[]>([]);
  const [topicsDraft, setTopicsDraft] = useState<string[]>([]);
  const [detailsDirty, setDetailsDirty] = useState(false);

  async function refresh(opts?: {
    preserve?: Array<"questions" | "memo" | "rubric" | "details">;
  }) {
    const res = await load({ data: { assessmentId } });
    setData(res);
    setDurationMins(res.assessment.expected_duration_minutes);
    setExtraTime(Number(res.assessment.extra_time_multiplier) || 1);
    setQuestionMode(
      res.assessment.questionAssignmentMode === "varied" ? "varied" : "same",
    );
    setSettingsDirty(false);
    const preserve = new Set(opts?.preserve ?? []);

    if (!preserve.has("questions")) {
      setQuestions(res.questions ?? []);
      setQuestionsDirty(false);
    }
    if (!preserve.has("memo")) {
      setMemorandum(res.assessment.memorandum_text ?? "");
      setMemoDirty(false);
    }
    if (!preserve.has("rubric")) {
      setRubricTitle(res.rubric?.title ?? "Oral assessment rubric");
      setCriteriaDraft(
        (res.rubric?.criteria ?? []).map((c, i) => ({
          code: c.code,
          label: c.label,
          description: c.description,
          weight: Number(c.weight) || 1,
          max_score: Number(c.max_score) || 100,
          sort_order: c.sort_order ?? i,
        })),
      );
      setRubricDirty(false);
    }
    if (!preserve.has("details")) {
      const analysis = res.assessment.analysis as AssessmentAnalysis;
      setTitleDraft(res.assessment.title ?? "");
      setDescriptionDraft(res.assessment.description ?? "");
      setSummaryDraft(analysis?.summary ?? "");
      setOutcomesDraft([...(analysis?.learningOutcomes ?? [])]);
      setTopicsDraft([...(analysis?.concepts ?? [])]);
      setDetailsDirty(false);
    }
  }

  function preserveOtherDrafts(
    saved: "questions" | "memo" | "rubric" | "details",
  ): Array<"questions" | "memo" | "rubric" | "details"> {
    const out: Array<"questions" | "memo" | "rubric" | "details"> = [];
    if (saved !== "questions" && questionsDirty) out.push("questions");
    if (saved !== "memo" && memoDirty) out.push("memo");
    if (saved !== "rubric" && rubricDirty) out.push("rubric");
    if (saved !== "details" && detailsDirty) out.push("details");
    return out;
  }

  useEffect(() => {
    void (async () => {
      try {
        await refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not load assessment");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessmentId]);

  async function onPublish() {
    setBusy(true);
    try {
      await publish({ data: { assessmentId } });
      toast.success("Published");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setBusy(false);
    }
  }

  async function onRegenerate() {
    if (questionsDirty || memoDirty || rubricDirty || detailsDirty) {
      toast.error("Save or discard unsaved edits before regenerating questions");
      return;
    }
    setBusy(true);
    try {
      const res = await regenerate({ data: { assessmentId } });
      toast.success(
        res.topics?.length
          ? `Questions regenerated: ${res.topics.slice(0, 4).join(", ")}`
          : "Questions regenerated",
      );
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Regenerate failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSaveSettings() {
    setBusy(true);
    try {
      await saveSettings({
        data: {
          assessmentId,
          expectedDurationMinutes: durationMins,
          extraTimeMultiplier: extraTime,
          questionAssignmentMode: questionMode,
        },
      });
      toast.success("Settings saved");
      await refresh({
        preserve: [
          ...(questionsDirty ? (["questions"] as const) : []),
          ...(memoDirty ? (["memo"] as const) : []),
          ...(rubricDirty ? (["rubric"] as const) : []),
          ...(detailsDirty ? (["details"] as const) : []),
        ],
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save settings");
    } finally {
      setBusy(false);
    }
  }

  async function onBatchInvite() {
    if (!batchLines.trim()) {
      toast.error("Paste at least one email");
      return;
    }
    setBusy(true);
    try {
      const res = await inviteBatch({
        data: { assessmentId, lines: batchLines },
      });
      toast.success(`Invited ${res.invited} of ${res.total}`);
      if (res.failed) {
        const firstErr = res.results.find((r) => !r.ok)?.error;
        toast.message(firstErr ? `Some failed: ${firstErr}` : `${res.failed} failed`);
      }
      const firstUrl = res.results.find((r) => r.ok && r.inviteUrl)?.inviteUrl;
      if (firstUrl) setLastInviteUrl(firstUrl);
      setBatchLines("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Batch invite failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSaveQuestions() {
    if (questions.length === 0) {
      toast.error("Add at least one question");
      return;
    }
    for (const q of questions) {
      if (!q.label.trim() || !q.primaryQuestion.trim()) {
        toast.error("Each question needs a topic and a primary question");
        return;
      }
    }
    setBusy(true);
    try {
      await saveQuestions({
        data: {
          assessmentId,
          questions: questions.map((q) => ({
            code: q.code,
            label: q.label,
            primaryQuestion: q.primaryQuestion,
            followUpIfWeak: q.followUpIfWeak,
            followUpIfStrong: q.followUpIfStrong,
            evidenceRequired: q.evidenceRequired,
            rubricMapping: q.rubricMapping,
          })),
        },
      });
      toast.success("Questions saved");
      await refresh({ preserve: preserveOtherDrafts("questions") });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save questions");
    } finally {
      setBusy(false);
    }
  }

  async function onSaveMemo() {
    setBusy(true);
    try {
      await saveMemo({
        data: { assessmentId, memorandumText: memorandum },
      });
      toast.success("Memorandum saved");
      await refresh({ preserve: preserveOtherDrafts("memo") });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save memorandum");
    } finally {
      setBusy(false);
    }
  }

  async function onSaveDetails() {
    const outcomes = outcomesDraft.map((s) => s.trim()).filter(Boolean);
    const topics = topicsDraft.map((s) => s.trim()).filter(Boolean);
    if (!titleDraft.trim()) {
      toast.error("Title is required");
      return;
    }
    setBusy(true);
    try {
      await saveDetails({
        data: {
          assessmentId,
          title: titleDraft.trim(),
          description: descriptionDraft,
          summary: summaryDraft,
          learningOutcomes: outcomes,
          concepts: topics,
        },
      });
      toast.success("Assessment details saved");
      await refresh({ preserve: preserveOtherDrafts("details") });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save details");
    } finally {
      setBusy(false);
    }
  }

  function updateListItem(
    setter: Dispatch<SetStateAction<string[]>>,
    index: number,
    value: string,
  ) {
    setter((prev) => prev.map((item, i) => (i === index ? value : item)));
    setDetailsDirty(true);
  }

  function addListItem(setter: Dispatch<SetStateAction<string[]>>, placeholder = "") {
    setter((prev) => [...prev, placeholder]);
    setDetailsDirty(true);
  }

  function removeListItem(setter: Dispatch<SetStateAction<string[]>>, index: number) {
    setter((prev) => prev.filter((_, i) => i !== index));
    setDetailsDirty(true);
  }

  async function onSaveRubric(templateId?: string) {
    if (criteriaDraft.length === 0) {
      toast.error("Add at least one rubric criterion");
      return;
    }
    for (const c of criteriaDraft) {
      if (!c.label.trim()) {
        toast.error("Each criterion needs a label");
        return;
      }
    }
    setBusy(true);
    try {
      await saveRubric({
        data: {
          assessmentId,
          title: rubricTitle.trim() || "Oral assessment rubric",
          templateId,
          criteria: criteriaDraft.map((c, i) => ({
            code: c.code,
            label: c.label,
            description: c.description,
            weight: c.weight,
            max_score: c.max_score,
            sort_order: i,
          })),
        },
      });
      toast.success("Rubric saved");
      await refresh({ preserve: preserveOtherDrafts("rubric") });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save rubric");
    } finally {
      setBusy(false);
    }
  }

  function applyRubricTemplate(templateId: keyof typeof RUBRIC_TEMPLATES) {
    const t = RUBRIC_TEMPLATES[templateId];
    if (!t) return;
    setRubricTitle(t.name);
    setCriteriaDraft(t.criteria.map((c) => ({ ...c })));
    setRubricDirty(true);
    toast.message(`Applied “${t.name}” — save to keep it`);
  }

  function updateCriterion(index: number, patch: Partial<EditableCriterion>) {
    setCriteriaDraft((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
    setRubricDirty(true);
  }

  function addCriterion() {
    setCriteriaDraft((prev) => {
      const used = new Set(prev.map((c) => c.code));
      let n = prev.length + 1;
      while (used.has(`custom_${n}`)) n += 1;
      return [
        ...prev,
        {
          code: `custom_${n}`,
          label: `Criterion ${n}`,
          description: "",
          weight: 1,
          max_score: 100,
          sort_order: prev.length,
        },
      ];
    });
    setRubricDirty(true);
  }

  function removeCriterion(index: number) {
    if (criteriaDraft.length <= 1) {
      toast.error("Keep at least one criterion");
      return;
    }
    setCriteriaDraft((prev) => prev.filter((_, i) => i !== index));
    setRubricDirty(true);
  }

  function updateQuestion(index: number, patch: Partial<EditableQuestion>) {
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));
    setQuestionsDirty(true);
  }

  function addQuestion() {
    setQuestions((prev) => {
      const used = new Set(prev.map((q) => q.code));
      let n = prev.length + 1;
      while (used.has(`LO${n}`)) n += 1;
      return [
        ...prev,
        {
          code: `LO${n}`,
          label: `Topic ${n}`,
          primaryQuestion: "",
          followUpIfWeak: "",
          followUpIfStrong: "",
          evidenceRequired: ["clear explanation", "example"],
          rubricMapping: ["knowledge", "application", "reasoning"],
        },
      ];
    });
    setQuestionsDirty(true);
  }

  function removeQuestion(index: number) {
    if (questions.length <= 1) {
      toast.error("Keep at least one question");
      return;
    }
    setQuestions((prev) => prev.filter((_, i) => i !== index));
    setQuestionsDirty(true);
  }

  async function onInvite() {
    if (!inviteEmail.trim()) {
      toast.error("Enter a student email");
      return;
    }
    setBusy(true);
    try {
      const res = await invite({
        data: {
          assessmentId,
          email: inviteEmail.trim(),
          fullName: inviteName.trim() || undefined,
        },
      });
      setLastInviteUrl(res.inviteUrl);
      if (res.emailQueued) {
        toast.success("Invite email queued");
      } else {
        toast.success(
          res.emailReason
            ? `Invite created (email not sent: ${res.emailReason}). Copy the link below.`
            : "Invite created. Copy the link below.",
        );
      }
      setInviteEmail("");
      setInviteName("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setBusy(false);
    }
  }

  async function onResend(invitationId: string) {
    setRowBusy(invitationId);
    try {
      const res = await resendInvite({ data: { invitationId } });
      setLastInviteUrl(res.inviteUrl);
      toast.success(res.emailQueued ? "Invite email resent" : "New invite link ready to copy");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Resend failed");
    } finally {
      setRowBusy(null);
    }
  }

  async function onRevoke(invitationId: string) {
    setRowBusy(invitationId);
    try {
      await revokeInvite({ data: { invitationId } });
      toast.success("Invitation revoked");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Revoke failed");
    } finally {
      setRowBusy(null);
    }
  }

  async function onCopyUrl(url: string) {
    await navigator.clipboard.writeText(url);
    setLastInviteUrl(url);
    setCopied(true);
    toast.success("Invite link copied");
    window.setTimeout(() => setCopied(false), 2000);
  }

  async function onDemoInterview() {
    setBusy(true);
    try {
      const res = await startDemo({ data: { assessmentId } });
      void navigate({
        to: "/tools/oral-assessment/interview/$sessionId",
        params: { sessionId: res.sessionId },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start interview");
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteAssessment() {
    const title = titleDraft.trim() || data?.assessment.title || "this assessment";
    const ok = window.confirm(
      `Delete “${title}”? This permanently removes the assessment, invitations, sessions, and uploaded files. This cannot be undone.`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      await deleteAssessment({ data: { assessmentId } });
      toast.success("Assessment deleted");
      void navigate({ to: "/tools/oral-assessment" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete assessment");
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <OralAssessmentShell title="Assessment">
        <p className="text-sm text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </p>
      </OralAssessmentShell>
    );
  }

  if (!data) {
    return (
      <OralAssessmentShell title="Assessment">
        <p className="text-sm text-muted-foreground">Assessment not found.</p>
      </OralAssessmentShell>
    );
  }

  const a = data.assessment;
  const hasUnsaved = questionsDirty || memoDirty || rubricDirty || detailsDirty || settingsDirty;

  return (
    <OralAssessmentShell title="Review">
      <nav className="mb-4 text-xs uppercase tracking-wide text-muted-foreground">
        <Link to="/tools/oral-assessment" className="hover:text-foreground">
          Oral Assessment
        </Link>
        <span className="mx-2">/</span>
        <span>Review</span>
      </nav>

      <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-soft space-y-8">
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{a.status}</p>
              <h2 className="font-display text-lg font-semibold mt-1">Assessment details</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Edit the title, summary, outcomes, and topics. Remove anything that is not correct.
              </p>
            </div>
            <Button type="button" disabled={busy || !detailsDirty} onClick={() => void onSaveDetails()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save details"}
            </Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor="assessment-title">Title</Label>
            <Input
              id="assessment-title"
              value={titleDraft}
              disabled={busy}
              onChange={(e) => {
                setTitleDraft(e.target.value);
                setDetailsDirty(true);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="assessment-description">Description (optional)</Label>
            <textarea
              id="assessment-description"
              rows={2}
              value={descriptionDraft}
              disabled={busy}
              onChange={(e) => {
                setDescriptionDraft(e.target.value);
                setDetailsDirty(true);
              }}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="assessment-summary">Analysis summary</Label>
            <textarea
              id="assessment-summary"
              rows={4}
              value={summaryDraft}
              disabled={busy}
              onChange={(e) => {
                setSummaryDraft(e.target.value);
                setDetailsDirty(true);
              }}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Short overview of what this oral assessment covers…"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {(a.status === "ready" || a.status === "published") && (
            <Button disabled={busy || hasUnsaved} onClick={() => void onPublish()}>
              {a.status === "published" ? "Published" : "Publish"}
            </Button>
          )}
          <Button variant="outline" disabled={busy} onClick={() => void onRegenerate()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Regenerate questions"}
          </Button>
          <Button
            variant="outline"
            disabled={busy || hasUnsaved || !["ready", "published"].includes(a.status)}
            onClick={() => void onDemoInterview()}
            className="inline-flex items-center gap-2"
          >
            <Play className="h-4 w-4" />
            Start voice viva
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void onDeleteAssessment()}
            className="inline-flex items-center gap-2 text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
          {hasUnsaved ? (
            <p className="text-xs text-amber-800 self-center">
              Save your unsaved edits before publishing or starting a viva.
            </p>
          ) : null}
        </div>

        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold">Viva questions</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Review and edit what Penny will ask. Remove anything you do not want. Students hear
                the primary question first; weak/strong follow-ups guide adaptive probing.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled={busy} onClick={addQuestion}>
                Add question
              </Button>
              <Button
                type="button"
                disabled={busy || !questionsDirty}
                onClick={() => void onSaveQuestions()}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save questions"}
              </Button>
            </div>
          </div>

          {questions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No questions yet. Wait for generation to finish, or click Regenerate questions.
            </p>
          ) : (
            <ul className="space-y-4">
              {questions.map((q, index) => (
                <li
                  key={`${q.code}-${index}`}
                  className="rounded-2xl border border-border/60 bg-background/40 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Question {index + 1}
                      {q.code ? ` · ${q.code}` : ""}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy || questions.length <= 1}
                      onClick={() => removeQuestion(index)}
                    >
                      Remove
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`q-label-${index}`}>Topic</Label>
                    <Input
                      id={`q-label-${index}`}
                      value={q.label}
                      disabled={busy}
                      onChange={(e) => updateQuestion(index, { label: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`q-primary-${index}`}>Primary question (spoken first)</Label>
                    <textarea
                      id={`q-primary-${index}`}
                      rows={3}
                      value={q.primaryQuestion}
                      disabled={busy}
                      onChange={(e) => updateQuestion(index, { primaryQuestion: e.target.value })}
                      className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`q-weak-${index}`}>Follow-up if answer is weak</Label>
                      <textarea
                        id={`q-weak-${index}`}
                        rows={3}
                        value={q.followUpIfWeak}
                        disabled={busy}
                        onChange={(e) => updateQuestion(index, { followUpIfWeak: e.target.value })}
                        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`q-strong-${index}`}>Follow-up if answer is strong</Label>
                      <textarea
                        id={`q-strong-${index}`}
                        rows={3}
                        value={q.followUpIfStrong}
                        disabled={busy}
                        onChange={(e) =>
                          updateQuestion(index, { followUpIfStrong: e.target.value })
                        }
                        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {data.blueprint ? (
            <p className="text-xs text-muted-foreground">
              Blueprint v{data.blueprint.version} · engine {data.blueprint.engine_version}
              {questionsDirty ? " · unsaved edits" : ""}
            </p>
          ) : null}
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold">Uploaded files</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {data.files.map((f) => (
              <li key={f.id}>
                {f.file_name} · {f.role} · {f.kind}
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold">Learning outcomes</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Edit or remove outcomes that are wrong. Save via “Save details” above.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => addListItem(setOutcomesDraft, "")}
            >
              Add outcome
            </Button>
          </div>
          {outcomesDraft.length === 0 ? (
            <p className="text-sm text-muted-foreground">No learning outcomes yet.</p>
          ) : (
            <ul className="space-y-2">
              {outcomesDraft.map((lo, index) => (
                <li key={`lo-${index}`} className="flex flex-wrap gap-2 items-start">
                  <Input
                    value={lo}
                    disabled={busy}
                    onChange={(e) => updateListItem(setOutcomesDraft, index, e.target.value)}
                    className="flex-1 min-w-[12rem]"
                    placeholder="Learning outcome…"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => removeListItem(setOutcomesDraft, index)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold">Viva topics</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Topics drawn from the analysis. Remove incorrect ones; question topics are edited in
                Viva questions above.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => addListItem(setTopicsDraft, "")}
            >
              Add topic
            </Button>
          </div>
          {topicsDraft.length === 0 ? (
            <p className="text-sm text-muted-foreground">No topics yet.</p>
          ) : (
            <ul className="space-y-2">
              {topicsDraft.map((topic, index) => (
                <li key={`topic-${index}`} className="flex flex-wrap gap-2 items-start">
                  <Input
                    value={topic}
                    disabled={busy}
                    onChange={(e) => updateListItem(setTopicsDraft, index, e.target.value)}
                    className="flex-1 min-w-[12rem]"
                    placeholder="Topic…"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => removeListItem(setTopicsDraft, index)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {detailsDirty ? (
            <p className="text-xs text-muted-foreground">
              Unsaved detail changes — click “Save details” at the top.
            </p>
          ) : null}
        </section>

        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold">Memorandum / accepted answers</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Penny uses this as ground truth in the viva. If a student says they don’t know or is clearly
                wrong, the examiner notes it, moves on, and knowledge is marked down at scoring.
              </p>
            </div>
            <Button type="button" disabled={busy || !memoDirty} onClick={() => void onSaveMemo()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save memorandum"}
            </Button>
          </div>
          <textarea
            id="memorandum"
            rows={8}
            value={memorandum}
            disabled={busy}
            onChange={(e) => {
              setMemorandum(e.target.value);
              setMemoDirty(true);
            }}
            placeholder="Paste key answers, mark scheme points, or accepted responses…"
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </section>

        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold">Marking rubric</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose a template or edit criteria and weights. AI recommendations follow this rubric.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled={busy} onClick={addCriterion}>
                Add criterion
              </Button>
              <Button
                type="button"
                disabled={busy || !rubricDirty}
                onClick={() => void onSaveRubric()}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save rubric"}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {(Object.keys(RUBRIC_TEMPLATES) as Array<keyof typeof RUBRIC_TEMPLATES>).map((id) => {
              const t = RUBRIC_TEMPLATES[id];
              return (
                <Button
                  key={id}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => applyRubricTemplate(id)}
                  title={t.blurb}
                >
                  {t.name}
                </Button>
              );
            })}
          </div>

          <div className="space-y-2 max-w-lg">
            <Label htmlFor="rubric-title">Rubric title</Label>
            <Input
              id="rubric-title"
              value={rubricTitle}
              disabled={busy}
              onChange={(e) => {
                setRubricTitle(e.target.value);
                setRubricDirty(true);
              }}
            />
          </div>

          {criteriaDraft.length === 0 ? (
            <p className="text-sm text-muted-foreground">No criteria yet — apply a template or add one.</p>
          ) : (
            <ul className="space-y-3">
              {criteriaDraft.map((c, index) => (
                <li
                  key={`${c.code}-${index}`}
                  className="rounded-2xl border border-border/60 bg-background/40 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Criterion {index + 1}
                      {c.code ? ` · ${c.code}` : ""}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy || criteriaDraft.length <= 1}
                      onClick={() => removeCriterion(index)}
                    >
                      Remove
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
                    <div className="space-y-2">
                      <Label htmlFor={`crit-label-${index}`}>Label</Label>
                      <Input
                        id={`crit-label-${index}`}
                        value={c.label}
                        disabled={busy}
                        onChange={(e) => updateCriterion(index, { label: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`crit-weight-${index}`}>Weight</Label>
                      <Input
                        id={`crit-weight-${index}`}
                        type="number"
                        min={0}
                        max={20}
                        step={0.5}
                        value={c.weight}
                        disabled={busy}
                        onChange={(e) =>
                          updateCriterion(index, { weight: Number(e.target.value) || 0 })
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`crit-desc-${index}`}>Description</Label>
                    <textarea
                      id={`crit-desc-${index}`}
                      rows={2}
                      value={c.description}
                      disabled={busy}
                      onChange={(e) => updateCriterion(index, { description: e.target.value })}
                      className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {rubricDirty ? (
            <p className="text-xs text-muted-foreground">Unsaved rubric changes</p>
          ) : null}
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Timing</h2>
          <div className="grid gap-3 sm:grid-cols-2 max-w-lg">
            <div className="space-y-2">
              <Label htmlFor="duration-mins">Duration (minutes)</Label>
              <Input
                id="duration-mins"
                type="number"
                min={5}
                max={120}
                value={durationMins}
                onChange={(e) => {
                  setDurationMins(Number(e.target.value) || 15);
                  setSettingsDirty(true);
                }}
                disabled={busy}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="extra-time">Extra time multiplier</Label>
              <Input
                id="extra-time"
                type="number"
                min={1}
                max={3}
                step={0.25}
                value={extraTime}
                onChange={(e) => {
                  setExtraTime(Number(e.target.value) || 1);
                  setSettingsDirty(true);
                }}
                disabled={busy}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Effective student time ≈ {Math.round(durationMins * extraTime)} minutes (1.0–3.0×).
          </p>

          <div className="space-y-2 max-w-lg">
            <Label>Student question assignment</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={questionMode === "same" ? "default" : "outline"}
                disabled={busy}
                onClick={() => {
                  setQuestionMode("same");
                  setSettingsDirty(true);
                }}
              >
                Same for all students
              </Button>
              <Button
                type="button"
                size="sm"
                variant={questionMode === "varied" ? "default" : "outline"}
                disabled={busy}
                onClick={() => {
                  setQuestionMode("varied");
                  setSettingsDirty(true);
                }}
              >
                Varied per student
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Same: every student sits the full approved bank in the same order. Varied: each
              student gets a shuffled subset from that bank (roughly matched to duration). Scoring
              only marks the questions that student was asked.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" disabled={busy || !settingsDirty} onClick={() => void onSaveSettings()}>
              Save settings
            </Button>
            {settingsDirty ? (
              <p className="text-xs text-muted-foreground">Unsaved timing / assignment changes</p>
            ) : null}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Invite student</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-name">Name (optional)</Label>
              <Input
                id="invite-name"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void onInvite()}
            className="inline-flex items-center gap-2"
          >
            <Send className="h-4 w-4" />
            Send invite email
          </Button>

          <div className="space-y-2 pt-2">
            <Label htmlFor="batch-invites">Batch invite (one per line)</Label>
            <textarea
              id="batch-invites"
              rows={4}
              value={batchLines}
              onChange={(e) => setBatchLines(e.target.value)}
              disabled={busy}
              placeholder={"student@example.com\nAlex Morgan <alex@example.com>\nemail@example.com,Name"}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
            />
            <p className="text-xs text-muted-foreground">Up to 50 emails. Formats: email, Name &lt;email&gt;, or email,Name.</p>
            <Button variant="secondary" disabled={busy} onClick={() => void onBatchInvite()}>
              Invite all
            </Button>
          </div>
          {lastInviteUrl ? (
            <div className="rounded-2xl border border-border/60 bg-background/50 p-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                Invite link (share if email is delayed):
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="text-xs break-all flex-1 min-w-0">{lastInviteUrl}</code>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="inline-flex items-center gap-1.5 shrink-0"
                  onClick={() => void onCopyUrl(lastInviteUrl)}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  Copy
                </Button>
              </div>
            </div>
          ) : null}

          {data.invitations.length > 0 ? (
            <ul className="space-y-2 pt-2">
              {data.invitations.map((inv) => {
                const label =
                  inv.student?.full_name?.trim() ||
                  inv.student?.email ||
                  inv.student_id.slice(0, 8);
                const canManage = !["revoked", "expired", "completed"].includes(inv.status);
                return (
                  <li
                    key={inv.id}
                    className="rounded-2xl border border-border/60 bg-background/40 p-3 flex flex-wrap items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{label}</p>
                      <p className="text-xs text-muted-foreground">
                        {inv.student?.email && inv.student.full_name
                          ? inv.student.email
                          : null}
                        {inv.student?.email && inv.student.full_name ? " · " : null}
                        {inv.status}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {canManage ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={rowBusy === inv.id}
                            onClick={() => void onCopyUrl(inv.inviteUrl)}
                          >
                            Copy link
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={rowBusy === inv.id}
                            onClick={() => void onResend(inv.id)}
                          >
                            {rowBusy === inv.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              "Resend"
                            )}
                          </Button>
                          {inv.status !== "started" ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={rowBusy === inv.id}
                              onClick={() => void onRevoke(inv.id)}
                            >
                              Revoke
                            </Button>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground capitalize">{inv.status}</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>

        {data.sessions.length > 0 ? (
          <section>
            <h2 className="font-display text-lg font-semibold">Sessions</h2>
            <ul className="mt-3 space-y-2">
              {data.sessions.map((s) => {
                const who =
                  s.student?.full_name?.trim() ||
                  s.student?.email ||
                  `Student ${s.student_id.slice(0, 8)}`;
                return (
                  <li key={s.id}>
                    <Link
                      to="/tools/oral-assessment/report/$sessionId"
                      params={{ sessionId: s.id }}
                      className="text-sm text-primary hover:underline"
                    >
                      {who} · {s.status}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </OralAssessmentShell>
  );
}
