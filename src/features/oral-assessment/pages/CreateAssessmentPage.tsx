import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { OralAssessmentShell } from "@/features/oral-assessment/components/OralAssessmentShell";
import { createOralAssessment } from "@/features/oral-assessment/services/assessment.functions";
import { extractOralAssessmentDocument } from "@/features/oral-assessment/utils/extract-document";
import {
  ACCEPTED_UPLOAD_ACCEPT,
  type OralFileRole,
} from "@/features/oral-assessment/types";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type CreationMode = "assessment_file" | "question_bank";
type BankStyle = "exact_questions" | "generate_from_concept";

type StagedFile = {
  file: File;
  role: OralFileRole;
};

type UploadedFile = {
  fileName: string;
  contentType: string;
  byteSize: number;
  storagePath: string;
  kind: string;
  role: OralFileRole;
  extractedText: string;
  extractWarning?: string;
  visionBase64?: string;
  visionMime?: string;
};

export function CreateAssessmentPage() {
  const navigate = useNavigate();
  const create = useServerFn(createOralAssessment);
  const assessmentInputRef = useRef<HTMLInputElement>(null);
  const questionsInputRef = useRef<HTMLInputElement>(null);
  const memoInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<CreationMode>("assessment_file");
  const [bankStyle, setBankStyle] = useState<BankStyle>("exact_questions");
  const [title, setTitle] = useState("");
  const [learningOutcomes, setLearningOutcomes] = useState("");
  const [memorandum, setMemorandum] = useState("");
  const [questionsText, setQuestionsText] = useState("");
  const [durationMins, setDurationMins] = useState(15);
  const [questionMode, setQuestionMode] = useState<"same" | "varied">("same");
  const [assessmentFiles, setAssessmentFiles] = useState<StagedFile[]>([]);
  const [questionFiles, setQuestionFiles] = useState<StagedFile[]>([]);
  const [memoFiles, setMemoFiles] = useState<StagedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  function addFiles(
    list: FileList | null,
    role: OralFileRole,
    setter: Dispatch<SetStateAction<StagedFile[]>>,
  ) {
    if (!list?.length) return;
    const next: StagedFile[] = [];
    for (const file of Array.from(list)) {
      if (file.size > 50 * 1024 * 1024) {
        toast.error(`${file.name} is over 50 MB`);
        continue;
      }
      next.push({ file, role });
    }
    setter((prev) => [...prev, ...next]);
    if (list[0] && !title.trim()) {
      setTitle(list[0].name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
    }
  }

  async function uploadStaged(staged: StagedFile[], userId: string): Promise<UploadedFile[]> {
    const uploaded: UploadedFile[] = [];
    for (const item of staged) {
      setStatus(`Extracting ${item.file.name}…`);
      const extracted = await extractOralAssessmentDocument(item.file);
      setStatus(`Uploading ${item.file.name}…`);
      const safeName = item.file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${userId}/${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from("oral-assessment")
        .upload(path, item.file, {
          contentType: item.file.type || "application/octet-stream",
          upsert: false,
        });
      if (upErr) throw new Error(upErr.message || "Upload failed");

      uploaded.push({
        fileName: item.file.name,
        contentType: item.file.type || "application/octet-stream",
        byteSize: item.file.size,
        storagePath: path,
        kind: extracted.kind,
        role: item.role,
        extractedText: extracted.text,
        extractWarning: extracted.warning,
        visionBase64: extracted.visionBase64,
        visionMime: extracted.visionMime,
      });
    }
    return uploaded;
  }

  async function onGenerate() {
    if (!title.trim()) {
      toast.error("Give the assessment a title.");
      return;
    }

    if (mode === "assessment_file") {
      if (assessmentFiles.length === 0) {
        toast.error("Upload at least one assessment file.");
        return;
      }
    } else {
      const hasOutcomes = Boolean(learningOutcomes.trim());
      if (bankStyle === "exact_questions") {
        if (!questionsText.trim() && questionFiles.length === 0 && !hasOutcomes) {
          toast.error("Paste your questions, upload a file, or provide learning outcomes.");
          return;
        }
      } else if (
        !questionsText.trim() &&
        questionFiles.length === 0 &&
        !memorandum.trim() &&
        memoFiles.length === 0 &&
        !hasOutcomes
      ) {
        toast.error("Provide learning outcomes, concepts, or a memo.");
        return;
      }
    }

    setBusy(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required.");

      const staged =
        mode === "assessment_file"
          ? assessmentFiles
          : [...questionFiles, ...memoFiles];
      const uploaded = staged.length ? await uploadStaged(staged, user.id) : [];

      setStatus(
        mode === "question_bank"
          ? bankStyle === "generate_from_concept"
            ? "Drafting oral questions from your concepts…"
            : "Understanding your questions and building viva…"
          : "Generating oral assessment…",
      );
      const res = await create({
        data: {
          title: title.trim(),
          creationMode: mode,
          bankStyle: mode === "question_bank" ? bankStyle : undefined,
          learningOutcomesText: learningOutcomes.trim() || undefined,
          memorandumText: memorandum.trim() || undefined,
          questionsText: mode === "question_bank" ? questionsText.trim() || undefined : undefined,
          expectedDurationMinutes: durationMins,
          questionAssignmentMode: questionMode,
          files: uploaded,
        },
      });

      toast.success("Oral assessment generated");
      void navigate({
        to: "/tools/oral-assessment/$assessmentId",
        params: { assessmentId: res.assessmentId },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  return (
    <OralAssessmentShell title="Create">
      <nav className="mb-4 text-xs uppercase tracking-wide text-muted-foreground">
        <Link to="/tools/oral-assessment" className="hover:text-foreground">
          Oral Assessment
        </Link>
        <span className="mx-2">/</span>
        <span>Create</span>
      </nav>

      <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-soft space-y-6">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Create Oral Assessment
          </h1>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            Upload an existing assessment paper, or paste your questions and memorandum in bulk.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={mode === "assessment_file" ? "default" : "outline"}
            disabled={busy}
            onClick={() => setMode("assessment_file")}
          >
            From assessment file
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "question_bank" ? "default" : "outline"}
            disabled={busy}
            onClick={() => setMode("question_bank")}
          >
            From questions + memo
          </Button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Week 6 case study"
            disabled={busy}
          />
        </div>

        <div className="space-y-2 max-w-xs">
          <Label htmlFor="duration">Expected duration (minutes)</Label>
          <Input
            id="duration"
            type="number"
            min={5}
            max={120}
            value={durationMins}
            onChange={(e) => setDurationMins(Number(e.target.value) || 15)}
            disabled={busy}
          />
          <p className="text-xs text-muted-foreground">
            Students hear this in the briefing. Extra time can be set per assessment later.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Student question assignment</Label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={questionMode === "same" ? "default" : "outline"}
              disabled={busy}
              onClick={() => setQuestionMode("same")}
            >
              Same for all students
            </Button>
            <Button
              type="button"
              size="sm"
              variant={questionMode === "varied" ? "default" : "outline"}
              disabled={busy}
              onClick={() => setQuestionMode("varied")}
            >
              Varied per student
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Same: every student gets the full approved question bank. Varied: each student gets a
            different subset/order from that bank (sized to duration). You can change this later.
          </p>
        </div>

        {mode === "assessment_file" ? (
          <>
            <div className="space-y-2">
              <Label>Assessment files</Label>
              <input
                ref={assessmentInputRef}
                type="file"
                accept={ACCEPTED_UPLOAD_ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files, "source", setAssessmentFiles);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => assessmentInputRef.current?.click()}
                className="inline-flex items-center gap-2"
              >
                <Upload className="h-4 w-4" />
                Upload PDF, DOCX, PPT, or images
              </Button>
              {assessmentFiles.length > 0 ? (
                <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                  {assessmentFiles.map((f, i) => (
                    <li key={`${f.file.name}-${i}`}>
                      {f.file.name}{" "}
                      <span className="text-xs">({Math.round(f.file.size / 1024)} KB)</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="outcomes">Learning outcomes (optional)</Label>
              <textarea
                id="outcomes"
                value={learningOutcomes}
                onChange={(e) => setLearningOutcomes(e.target.value)}
                disabled={busy}
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="One outcome per line"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="memo">Memorandum (optional)</Label>
              <textarea
                id="memo"
                value={memorandum}
                onChange={(e) => setMemorandum(e.target.value)}
                disabled={busy}
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Paste key memorandum points if helpful"
              />
            </div>
          </>
        ) : (
          <>
            <div className="space-y-3 rounded-2xl border border-border/60 bg-background/40 p-4">
              <p className="text-sm font-medium">How should Penny use your material?</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button
                  type="button"
                  size="sm"
                  variant={bankStyle === "exact_questions" ? "default" : "outline"}
                  disabled={busy}
                  onClick={() => setBankStyle("exact_questions")}
                >
                  Ask my specific questions
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={bankStyle === "generate_from_concept" ? "default" : "outline"}
                  disabled={busy}
                  onClick={() => setBankStyle("generate_from_concept")}
                >
                  AI generates from my concepts
                </Button>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {bankStyle === "exact_questions"
                  ? "Penny keeps your wording, focuses on the topic of each question (not Q numbers or totals), and adds oral follow-ups. Review on the next page."
                  : "Describe the topics/concepts (and paste the memo). Penny drafts oral questions for you to approve or edit on the review page before publishing."}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="questions-bank">
                {bankStyle === "exact_questions" ? "Your questions" : "Concepts / topics"}
              </Label>
              <p className="text-xs text-muted-foreground">
                {bankStyle === "exact_questions"
                  ? "Paste all questions at once. Numbering is ignored as content — Penny reads the topic of each question."
                  : "List concepts (optional if outcomes or memo already cover the subject)."
              }
              </p>
              <textarea
                id="questions-bank"
                value={questionsText}
                onChange={(e) => setQuestionsText(e.target.value)}
                disabled={busy}
                rows={8}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                placeholder={
                  bankStyle === "exact_questions"
                    ? "Q1. Explain…\nQ2. Compare…\nQ3. Apply…\n(or leave blank if using outcomes only)"
                    : "Nouns\nVerbs\n…\n(or leave blank if using outcomes only)"
                }
              />
              <input
                ref={questionsInputRef}
                type="file"
                accept={ACCEPTED_UPLOAD_ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files, "source", setQuestionFiles);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => questionsInputRef.current?.click()}
                className="inline-flex items-center gap-2"
              >
                <Upload className="h-4 w-4" />
                {bankStyle === "exact_questions"
                  ? "Or upload questions file"
                  : "Or upload concept notes file"}
              </Button>
              {questionFiles.length > 0 ? (
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {questionFiles.map((f, i) => (
                    <li key={`q-${f.file.name}-${i}`}>
                      {f.file.name}{" "}
                      <span className="text-xs">({Math.round(f.file.size / 1024)} KB)</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="outcomes-bank">Learning outcomes</Label>
              <p className="text-xs text-muted-foreground">
                Enough on their own: Penny invents as many oral questions and related outcomes as
                the subject supports. Remove anything you do not want on the review page before
                publishing.
              </p>
              <textarea
                id="outcomes-bank"
                value={learningOutcomes}
                onChange={(e) => setLearningOutcomes(e.target.value)}
                disabled={busy}
                rows={4}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="One outcome per line"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="memo-bank">Memorandum / accepted answers (optional)</Label>
              <p className="text-xs text-muted-foreground">
                Optional if outcomes are provided — Penny can invent accepted-answer guidance. Paste
                your own memo when you have one.
              </p>
              <textarea
                id="memo-bank"
                value={memorandum}
                onChange={(e) => setMemorandum(e.target.value)}
                disabled={busy}
                rows={8}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                placeholder="Paste accepted answers / mark scheme (optional)…"
              />
              <input
                ref={memoInputRef}
                type="file"
                accept={ACCEPTED_UPLOAD_ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files, "memorandum", setMemoFiles);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => memoInputRef.current?.click()}
                className="inline-flex items-center gap-2"
              >
                <Upload className="h-4 w-4" />
                Or upload memo file
              </Button>
              {memoFiles.length > 0 ? (
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {memoFiles.map((f, i) => (
                    <li key={`m-${f.file.name}-${i}`}>
                      {f.file.name}{" "}
                      <span className="text-xs">({Math.round(f.file.size / 1024)} KB)</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </>
        )}

        <Button disabled={busy} onClick={() => void onGenerate()} className="w-full sm:w-auto">
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {status || "Working…"}
            </span>
          ) : mode === "question_bank" ? (
            bankStyle === "generate_from_concept" ? (
              "Draft questions for me to approve"
            ) : (
              "Build viva from my questions"
            )
          ) : (
            "Generate Oral Assessment"
          )}
        </Button>
      </div>
    </OralAssessmentShell>
  );
}
