import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_RUBRIC_CRITERIA, AssessmentAnalysisSchema, InterviewBlueprintSchema } from "@/features/oral-assessment/types";
import type { AssessmentAnalysis } from "@/features/oral-assessment/types";
import { analyseAssessment, analyseQuestionBank } from "@/features/oral-assessment/engines/analysis-engine";
import {
  buildInterviewBlueprint,
  followUpsForPlan,
  parseQuestionAssignmentMode,
  INTERVIEW_ENGINE_VERSION,
} from "@/features/oral-assessment/engines/interview-engine";
import { ANALYSIS_ENGINE_VERSION, MAX_INTERVIEW_PLAN_ITEMS } from "@/features/oral-assessment/engines/analysis-engine";
import {
  getOrCreateWorkspace,
  requireOralAccess,
  writeAudit,
} from "./workspace.functions";

const FileInput = z.object({
  fileName: z.string().min(1).max(500),
  contentType: z.string().max(200).default("application/octet-stream"),
  byteSize: z.number().int().nonnegative().max(52_428_800),
  storagePath: z.string().min(1).max(1000),
  kind: z.string().max(50).default("other"),
  role: z
    .enum(["source", "rubric", "learning_outcomes", "memorandum", "other"])
    .default("source"),
  extractedText: z.string().max(80_000).default(""),
  extractWarning: z.string().max(2000).optional(),
  /** Optional multimodal payload for thin extracts (PDF/image). Cap ~4MB decoded. */
  visionBase64: z.string().max(5_500_000).optional(),
  visionMime: z.string().max(120).optional(),
});

const CreateInput = z
  .object({
    title: z.string().min(1).max(300),
    description: z.string().max(5000).optional(),
    creationMode: z.enum(["assessment_file", "question_bank"]).default("assessment_file"),
    /** How to treat questionsText in question_bank mode. */
    bankStyle: z.enum(["exact_questions", "generate_from_concept"]).optional(),
    learningOutcomesText: z.string().max(20_000).optional(),
    memorandumText: z.string().max(40_000).optional(),
    questionsText: z.string().max(40_000).optional(),
    expectedDurationMinutes: z.number().int().min(5).max(120).optional(),
    /** same = all students get the full bank; varied = per-student subset/order. */
    questionAssignmentMode: z.enum(["same", "varied"]).optional().default("same"),
    files: z.array(FileInput).max(20).default([]),
  })
  .superRefine((val, ctx) => {
    if (val.creationMode === "assessment_file") {
      if (!val.files.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Upload at least one assessment file.",
          path: ["files"],
        });
      }
      return;
    }
    const style = val.bankStyle ?? "exact_questions";
    const questionFiles = val.files.filter(
      (f) => f.role === "source" || f.role === "learning_outcomes" || f.role === "other",
    );
    const hasQuestionsPaste = Boolean(val.questionsText?.trim());
    const hasQuestionFiles = questionFiles.some((f) => f.extractedText.trim().length > 0);
    const hasOutcomes = Boolean(val.learningOutcomesText?.trim());
    const memoFiles = val.files.filter((f) => f.role === "memorandum");
    const hasMemo =
      Boolean(val.memorandumText?.trim()) ||
      memoFiles.some((f) => f.extractedText.trim().length > 0);

    // Outcomes alone are enough — AI can draft questions + accepted-answer memo.
    if (hasOutcomes) return;

    if (style === "exact_questions") {
      if (!hasQuestionsPaste && !hasQuestionFiles) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Paste your questions, upload a file, or provide learning outcomes.",
          path: ["questionsText"],
        });
      }
      return;
    }

    if (!hasQuestionsPaste && !hasQuestionFiles && !hasMemo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide learning outcomes, concept notes, or a memo so Penny can draft questions.",
        path: ["learningOutcomesText"],
      });
    }
  });

export const createOralAssessment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => CreateInput.parse(raw))
  .handler(async ({ context, data }) => {
    requireOralAccess(context);
    const ws = await getOrCreateWorkspace(context);

    const memoFromFiles = data.files
      .filter((f) => f.role === "memorandum")
      .map((f) => f.extractedText)
      .filter(Boolean)
      .join("\n\n");
    const memorandumText = [data.memorandumText?.trim() ?? "", memoFromFiles]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 40_000);

    const { data: assessment, error } = await context.supabase
      .from("oral_assessment_assessments" as never)
      .insert({
        workspace_id: ws.id,
        owner_id: context.userId,
        title: data.title,
        description: data.description ?? "",
        learning_outcomes_text: data.learningOutcomesText ?? "",
        memorandum_text: memorandumText,
        expected_duration_minutes: data.expectedDurationMinutes ?? 15,
        status: "analysing",
      } as never)
      .select("id, title, status, created_at")
      .single();

    if (error || !assessment) throw new Error("Could not create assessment.");
    const row = assessment as { id: string; title: string; status: string; created_at: string };

    if (data.files.length) {
      const fileRows = data.files.map((f) => ({
        assessment_id: row.id,
        owner_id: context.userId,
        role: f.role,
        file_name: f.fileName,
        content_type: f.contentType,
        byte_size: f.byteSize,
        storage_path: f.storagePath,
        kind: f.kind,
        extracted_text: f.extractedText,
        extract_warning: f.extractWarning ?? null,
      }));

      const { error: fileErr } = await context.supabase
        .from("oral_assessment_files" as never)
        .insert(fileRows as never);
      if (fileErr) throw new Error("Could not save uploaded files.");
    }

    const media = data.files
      .filter((f) => f.visionBase64 && f.visionMime)
      .slice(0, 3)
      .map((f) => ({
        mimeType: f.visionMime!,
        base64: f.visionBase64!,
      }));

    try {
      const isBank = data.creationMode === "question_bank";
      const questionFileText = data.files
        .filter((f) => f.role !== "memorandum")
        .map((f) => f.extractedText)
        .filter(Boolean)
        .join("\n\n");

      const hasLecturerQuestions = Boolean(
        data.questionsText?.trim() || questionFileText.trim(),
      );
      // Outcomes-only → always generate questions + memo draft.
      const bankStyle =
        isBank && !hasLecturerQuestions && data.learningOutcomesText?.trim()
          ? "generate_from_concept"
          : (data.bankStyle ?? "exact_questions");

      const { analysis, model } = isBank
        ? await analyseQuestionBank({
            title: data.title,
            questionsText: [data.questionsText?.trim() ?? "", questionFileText]
              .filter(Boolean)
              .join("\n\n"),
            memorandumText: memorandumText || undefined,
            learningOutcomesText: data.learningOutcomesText,
            bankStyle,
            userId: context.userId,
            media,
          })
        : await analyseAssessment({
            title: data.title,
            sourceText: data.files.map((f) => f.extractedText).filter(Boolean).join("\n\n"),
            learningOutcomesText: data.learningOutcomesText,
            memorandumText: memorandumText || undefined,
            userId: context.userId,
            media,
          });

      const generatedMemo =
        "generatedMemorandum" in analysis && typeof analysis.generatedMemorandum === "string"
          ? analysis.generatedMemorandum.trim()
          : "";
      const finalMemo = (memorandumText || generatedMemo).slice(0, 40_000);

      const blueprint = buildInterviewBlueprint({ title: data.title, analysis });
      const followUpBank = followUpsForPlan(analysis);

      const { data: rubric, error: rubricErr } = await context.supabase
        .from("oral_assessment_rubrics" as never)
        .insert({
          assessment_id: row.id,
          title: "Oral assessment rubric",
          max_mark: 100,
          source: "generated",
        } as never)
        .select("id")
        .single();
      if (rubricErr || !rubric) throw new Error("Could not create rubric.");
      const rubricId = (rubric as { id: string }).id;

      await context.supabase.from("oral_assessment_rubric_criteria" as never).insert(
        DEFAULT_RUBRIC_CRITERIA.map((c) => ({
          rubric_id: rubricId,
          ...c,
        })) as never,
      );

      await context.supabase.from("oral_assessment_blueprints" as never).insert({
        assessment_id: row.id,
        version: 1,
        blueprint,
        question_bank: blueprint.outcomes.map((o) => ({
          code: o.code,
          topic: o.label,
          primary: o.primaryQuestion,
          followUpLogic: o.followUpLogic,
        })),
        adaptive_strategy: {
          notes: blueprint.adaptiveNotes,
          persona: blueprint.examinerPersona,
          followUpBank,
          creationMode: data.creationMode,
          bankStyle,
          questionAssignmentMode: data.questionAssignmentMode ?? "same",
        },
        engine_version: INTERVIEW_ENGINE_VERSION,
      } as never);

      await context.supabase
        .from("oral_assessment_assessments" as never)
        .update({
          status: "ready",
          analysis,
          analysis_model: model,
          analysis_error: null,
          memorandum_text: finalMemo,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", row.id)
        .eq("owner_id", context.userId);

      await writeAudit(context, {
        workspace_id: ws.id,
        assessment_id: row.id,
        event_type: "assessment.generated",
        payload: {
          analysisEngine: ANALYSIS_ENGINE_VERSION,
          interviewEngine: INTERVIEW_ENGINE_VERSION,
          fileCount: data.files.length,
          creationMode: data.creationMode,
          bankStyle,
          memoGenerated: !memorandumText && Boolean(finalMemo),
        },
      });

      return { assessmentId: row.id, status: "ready" as const };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Analysis failed";
      await context.supabase
        .from("oral_assessment_assessments" as never)
        .update({
          status: "failed",
          analysis_error: message,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", row.id)
        .eq("owner_id", context.userId);

      await writeAudit(context, {
        workspace_id: ws.id,
        assessment_id: row.id,
        event_type: "assessment.failed",
        payload: { message, creationMode: data.creationMode },
      });

      throw new Error(message);
    }
  });

export const listOralAssessments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    requireOralAccess(context);
    await getOrCreateWorkspace(context);

    const { data, error } = await context.supabase
      .from("oral_assessment_assessments" as never)
      .select("id, title, status, created_at, updated_at, published_at")
      .eq("owner_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw new Error("Could not list assessments.");
    return { assessments: (data ?? []) as Array<{
      id: string;
      title: string;
      status: string;
      created_at: string;
      updated_at: string;
      published_at: string | null;
    }> };
  });

const AssessmentIdInput = z.object({
  assessmentId: z.string().uuid(),
});

export const getOralAssessment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => AssessmentIdInput.parse(raw))
  .handler(async ({ context, data }) => {
    requireOralAccess(context);

    const { data: assessment, error } = await context.supabase
      .from("oral_assessment_assessments" as never)
      .select(
        "id, workspace_id, title, description, status, learning_outcomes_text, memorandum_text, analysis, analysis_model, analysis_error, expected_duration_minutes, extra_time_multiplier, published_at, created_at, updated_at",
      )
      .eq("id", data.assessmentId)
      .eq("owner_id", context.userId)
      .maybeSingle();

    if (error || !assessment) throw new Error("Assessment not found.");
    const a = assessment as {
      id: string;
      workspace_id: string;
      title: string;
      description: string;
      status: string;
      learning_outcomes_text: string;
      memorandum_text: string;
      analysis: AssessmentAnalysis;
      analysis_model: string | null;
      analysis_error: string | null;
      expected_duration_minutes: number;
      extra_time_multiplier: number;
      published_at: string | null;
      created_at: string;
      updated_at: string;
    };

    const [files, rubric, blueprint, sessions, invitations] = await Promise.all([
      context.supabase
        .from("oral_assessment_files" as never)
        .select("id, role, file_name, content_type, byte_size, kind, extract_warning, created_at")
        .eq("assessment_id", data.assessmentId)
        .order("created_at"),
      context.supabase
        .from("oral_assessment_rubrics" as never)
        .select("id, title, max_mark, source")
        .eq("assessment_id", data.assessmentId)
        .maybeSingle(),
      context.supabase
        .from("oral_assessment_blueprints" as never)
        .select("id, version, engine_version, updated_at, blueprint, adaptive_strategy, question_bank")
        .eq("assessment_id", data.assessmentId)
        .maybeSingle(),
      context.supabase
        .from("oral_assessment_sessions" as never)
        .select("id, status, student_id, created_at, completed_at")
        .eq("assessment_id", data.assessmentId)
        .order("created_at", { ascending: false })
        .limit(50),
      context.supabase
        .from("oral_assessment_invitations" as never)
        .select("id, student_id, status, invite_token, created_at, updated_at")
        .eq("assessment_id", data.assessmentId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    type Criterion = {
      code: string;
      label: string;
      description: string;
      weight: number;
      max_score: number;
      sort_order: number;
    };
    let criteria: Criterion[] = [];
    const rubricRow = rubric.data as
      | { id: string; title: string; max_mark: number; source: string }
      | null;
    if (rubricRow) {
      const { data: crit } = await context.supabase
        .from("oral_assessment_rubric_criteria" as never)
        .select("code, label, description, weight, max_score, sort_order")
        .eq("rubric_id", rubricRow.id)
        .order("sort_order");
      criteria = (crit ?? []) as Criterion[];
    }

    const sessionRows = (sessions.data ?? []) as Array<{
      id: string;
      status: string;
      student_id: string;
      created_at: string;
      completed_at: string | null;
    }>;
    const inviteRows = (invitations.data ?? []) as Array<{
      id: string;
      student_id: string;
      status: string;
      invite_token: string;
      created_at: string;
      updated_at: string;
    }>;

    const studentIds = [
      ...new Set([...sessionRows.map((s) => s.student_id), ...inviteRows.map((i) => i.student_id)]),
    ];
    let studentsById = new Map<
      string,
      { id: string; email: string; full_name: string; student_number: string }
    >();
    if (studentIds.length) {
      const { data: studentData } = await context.supabase
        .from("oral_assessment_students" as never)
        .select("id, email, full_name, student_number")
        .in("id", studentIds);
      studentsById = new Map(
        ((studentData ?? []) as Array<{
          id: string;
          email: string;
          full_name: string;
          student_number: string;
        }>).map((s) => [s.id, s]),
      );
    }

    const { EMAIL_APP_URL } = await import("@/lib/email-config");

    const blueprintRow = blueprint.data as {
      id: string;
      version: number;
      engine_version: string;
      updated_at: string;
      blueprint: unknown;
      adaptive_strategy: {
        followUpBank?: Record<string, { weak: string; strong: string }>;
        notes?: string;
        persona?: string;
        questionAssignmentMode?: "same" | "varied";
      } | null;
      question_bank: unknown;
    } | null;

    const parsedBlueprint = InterviewBlueprintSchema.parse(blueprintRow?.blueprint ?? {});
    const followUpBank = blueprintRow?.adaptive_strategy?.followUpBank ?? {};
    const questionAssignmentMode = parseQuestionAssignmentMode(
      blueprintRow?.adaptive_strategy?.questionAssignmentMode,
    );
    const questions = parsedBlueprint.outcomes.map((o) => ({
      code: o.code,
      label: o.label,
      primaryQuestion: o.primaryQuestion,
      followUpIfWeak: followUpBank[o.code]?.weak ?? "",
      followUpIfStrong: followUpBank[o.code]?.strong ?? "",
      evidenceRequired: o.evidenceRequired,
      rubricMapping: o.rubricMapping,
    }));

    return {
      assessment: {
        ...a,
        analysis: AssessmentAnalysisSchema.parse(a.analysis ?? {}),
        questionAssignmentMode,
      },
      files: ((files.data ?? []) as Array<{
        id: string;
        role: string;
        file_name: string;
        content_type: string;
        byte_size: number;
        kind: string;
        extract_warning: string | null;
        created_at: string;
      }>),
      rubric: rubricRow
        ? {
            id: rubricRow.id,
            title: rubricRow.title,
            max_mark: rubricRow.max_mark,
            source: rubricRow.source,
            criteria,
          }
        : null,
      blueprint: blueprintRow
        ? {
            id: blueprintRow.id,
            version: blueprintRow.version,
            engine_version: blueprintRow.engine_version,
            updated_at: blueprintRow.updated_at,
            adaptiveNotes: parsedBlueprint.adaptiveNotes,
            examinerPersona: parsedBlueprint.examinerPersona,
          }
        : null,
      questions,
      sessions: sessionRows.map((s) => ({
        ...s,
        student: studentsById.get(s.student_id) ?? null,
      })),
      invitations: inviteRows.map((inv) => ({
        ...inv,
        inviteUrl: `${EMAIL_APP_URL}/tools/oral-assessment/invite/${inv.invite_token}`,
        student: studentsById.get(inv.student_id) ?? null,
      })),
    };
  });

export const publishOralAssessment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => AssessmentIdInput.parse(raw))
  .handler(async ({ context, data }) => {
    requireOralAccess(context);

    const { data: existing } = await context.supabase
      .from("oral_assessment_assessments" as never)
      .select("id, status, workspace_id")
      .eq("id", data.assessmentId)
      .eq("owner_id", context.userId)
      .maybeSingle();

    if (!existing) throw new Error("Assessment not found.");
    const row = existing as { id: string; status: string; workspace_id: string };
    if (row.status !== "ready" && row.status !== "published") {
      throw new Error("Assessment must be ready before publishing.");
    }

    const now = new Date().toISOString();
    const { error } = await context.supabase
      .from("oral_assessment_assessments" as never)
      .update({
        status: "published",
        published_at: now,
        updated_at: now,
      } as never)
      .eq("id", data.assessmentId)
      .eq("owner_id", context.userId);

    if (error) throw new Error("Could not publish assessment.");

    await writeAudit(context, {
      workspace_id: row.workspace_id,
      assessment_id: row.id,
      event_type: "assessment.published",
    });

    return { assessmentId: row.id, status: "published" as const, publishedAt: now };
  });

/** Permanently delete an assessment and its cascaded data + storage files. */
export const deleteOralAssessment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => AssessmentIdInput.parse(raw))
  .handler(async ({ context, data }) => {
    requireOralAccess(context);

    const { data: existing } = await context.supabase
      .from("oral_assessment_assessments" as never)
      .select("id, title, workspace_id")
      .eq("id", data.assessmentId)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (!existing) throw new Error("Assessment not found.");
    const row = existing as { id: string; title: string; workspace_id: string };

    const { data: files } = await context.supabase
      .from("oral_assessment_files" as never)
      .select("storage_path")
      .eq("assessment_id", data.assessmentId);
    const paths = ((files ?? []) as Array<{ storage_path: string }>)
      .map((f) => f.storage_path)
      .filter(Boolean);

    if (paths.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error: storageErr } = await supabaseAdmin.storage
        .from("oral-assessment")
        .remove(paths);
      if (storageErr) {
        console.error("[oral-assessment] storage cleanup failed", storageErr);
      }
    }

    await writeAudit(context, {
      workspace_id: row.workspace_id,
      assessment_id: row.id,
      event_type: "assessment.deleted",
      payload: { title: row.title },
    });

    const { error } = await context.supabase
      .from("oral_assessment_assessments" as never)
      .delete()
      .eq("id", data.assessmentId)
      .eq("owner_id", context.userId);
    if (error) throw new Error("Could not delete assessment.");

    return { assessmentId: row.id, deleted: true as const };
  });

const UpdateSettingsInput = z.object({
  assessmentId: z.string().uuid(),
  expectedDurationMinutes: z.number().int().min(5).max(120).optional(),
  extraTimeMultiplier: z.number().min(1).max(3).optional(),
  questionAssignmentMode: z.enum(["same", "varied"]).optional(),
});

export const updateOralAssessmentSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => UpdateSettingsInput.parse(raw))
  .handler(async ({ context, data }) => {
    requireOralAccess(context);

    const { data: existing } = await context.supabase
      .from("oral_assessment_assessments" as never)
      .select("id, workspace_id")
      .eq("id", data.assessmentId)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (!existing) throw new Error("Assessment not found.");
    const row = existing as { id: string; workspace_id: string };

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.expectedDurationMinutes != null) {
      patch.expected_duration_minutes = data.expectedDurationMinutes;
    }
    if (data.extraTimeMultiplier != null) {
      patch.extra_time_multiplier = data.extraTimeMultiplier;
    }

    const { error } = await context.supabase
      .from("oral_assessment_assessments" as never)
      .update(patch as never)
      .eq("id", data.assessmentId)
      .eq("owner_id", context.userId);
    if (error) throw new Error("Could not update settings.");

    if (data.questionAssignmentMode != null) {
      const { data: bp } = await context.supabase
        .from("oral_assessment_blueprints" as never)
        .select("id, adaptive_strategy")
        .eq("assessment_id", data.assessmentId)
        .maybeSingle();
      if (!bp) throw new Error("Assessment blueprint not found — cannot save question assignment.");
      const bpRow = bp as { id: string; adaptive_strategy: Record<string, unknown> | null };
      const { error: bpErr } = await context.supabase
        .from("oral_assessment_blueprints" as never)
        .update({
          adaptive_strategy: {
            ...(bpRow.adaptive_strategy ?? {}),
            questionAssignmentMode: data.questionAssignmentMode,
          },
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", bpRow.id);
      if (bpErr) throw new Error("Could not save question assignment mode.");
    }

    await writeAudit(context, {
      workspace_id: row.workspace_id,
      assessment_id: data.assessmentId,
      event_type: "assessment.settings_updated",
      payload: {
        expectedDurationMinutes: data.expectedDurationMinutes,
        extraTimeMultiplier: data.extraTimeMultiplier,
        questionAssignmentMode: data.questionAssignmentMode,
      },
    });

    return {
      assessmentId: data.assessmentId,
      expectedDurationMinutes: data.expectedDurationMinutes,
      extraTimeMultiplier: data.extraTimeMultiplier,
      questionAssignmentMode: data.questionAssignmentMode,
    };
  });

const SaveMemoInput = z.object({
  assessmentId: z.string().uuid(),
  memorandumText: z.string().max(40_000),
});

/** Lecturer edits memo / accepted answers used by the examiner and scoring. */
export const saveOralAssessmentMemo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SaveMemoInput.parse(raw))
  .handler(async ({ context, data }) => {
    requireOralAccess(context);

    const { data: existing } = await context.supabase
      .from("oral_assessment_assessments" as never)
      .select("id, workspace_id")
      .eq("id", data.assessmentId)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (!existing) throw new Error("Assessment not found.");
    const row = existing as { id: string; workspace_id: string };

    const { error } = await context.supabase
      .from("oral_assessment_assessments" as never)
      .update({
        memorandum_text: data.memorandumText,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", data.assessmentId)
      .eq("owner_id", context.userId);
    if (error) throw new Error("Could not save memorandum.");

    await writeAudit(context, {
      workspace_id: row.workspace_id,
      assessment_id: data.assessmentId,
      event_type: "assessment.memo_updated",
      payload: { chars: data.memorandumText.length },
    });

    return { assessmentId: data.assessmentId, memorandumText: data.memorandumText };
  });

const RubricCriterionInput = z.object({
  code: z.string().min(1).max(80).optional(),
  label: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  weight: z.number().min(0).max(20).default(1),
  max_score: z.number().min(1).max(1000).default(100),
  sort_order: z.number().int().min(0).max(100).optional(),
});

const SaveRubricInput = z.object({
  assessmentId: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  templateId: z.string().max(80).optional(),
  criteria: z.array(RubricCriterionInput).min(1).max(20),
});

function slugCriterionCode(label: string, index: number, used: Set<string>): string {
  let base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  if (!base) base = `criterion_${index + 1}`;
  let code = base;
  let n = 2;
  while (used.has(code)) {
    code = `${base}_${n}`;
    n += 1;
  }
  used.add(code);
  return code;
}

/** Replace rubric criteria (optionally from a template) for scoring. */
export const saveOralAssessmentRubric = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SaveRubricInput.parse(raw))
  .handler(async ({ context, data }) => {
    requireOralAccess(context);

    const { data: existing } = await context.supabase
      .from("oral_assessment_assessments" as never)
      .select("id, workspace_id")
      .eq("id", data.assessmentId)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (!existing) throw new Error("Assessment not found.");
    const row = existing as { id: string; workspace_id: string };

    const { data: rubric } = await context.supabase
      .from("oral_assessment_rubrics" as never)
      .select("id")
      .eq("assessment_id", data.assessmentId)
      .maybeSingle();
    if (!rubric) throw new Error("Rubric not found.");
    const rubricId = (rubric as { id: string }).id;

    const used = new Set<string>();
    const criteria = data.criteria.map((c, i) => {
      let code = (c.code?.trim() || "").slice(0, 80);
      if (!code || used.has(code)) {
        code = slugCriterionCode(c.label, i, used);
      } else {
        used.add(code);
      }
      return {
        rubric_id: rubricId,
        code,
        label: c.label.trim(),
        description: (c.description ?? "").trim(),
        weight: c.weight ?? 1,
        max_score: c.max_score ?? 100,
        sort_order: c.sort_order ?? i,
      };
    });

    const { error: delErr } = await context.supabase
      .from("oral_assessment_rubric_criteria" as never)
      .delete()
      .eq("rubric_id", rubricId);
    if (delErr) throw new Error("Could not update rubric criteria.");

    const { error: insErr } = await context.supabase
      .from("oral_assessment_rubric_criteria" as never)
      .insert(criteria as never);
    if (insErr) throw new Error("Could not save rubric criteria.");

    const title = data.title?.trim() || undefined;
    await context.supabase
      .from("oral_assessment_rubrics" as never)
      .update({
        ...(title ? { title } : {}),
        source: "manual",
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", rubricId);

    await writeAudit(context, {
      workspace_id: row.workspace_id,
      assessment_id: data.assessmentId,
      event_type: "assessment.rubric_updated",
      payload: {
        criteriaCount: criteria.length,
        templateId: data.templateId ?? null,
        title: title ?? null,
      },
    });

    return {
      assessmentId: data.assessmentId,
      criteria: criteria.map(({ rubric_id: _r, ...rest }) => rest),
    };
  });

const SaveDetailsInput = z.object({
  assessmentId: z.string().uuid(),
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional(),
  summary: z.string().max(8000).optional(),
  learningOutcomes: z.array(z.string().min(1).max(500)).max(40).optional(),
  concepts: z.array(z.string().min(1).max(300)).max(40).optional(),
  skills: z.array(z.string().min(1).max(300)).max(40).optional(),
  likelyMisconceptions: z.array(z.string().min(1).max(500)).max(30).optional(),
});

/** Lecturer edits assessment meta, outcomes, and topic list from analysis. */
export const saveOralAssessmentDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SaveDetailsInput.parse(raw))
  .handler(async ({ context, data }) => {
    requireOralAccess(context);

    const { data: existing } = await context.supabase
      .from("oral_assessment_assessments" as never)
      .select("id, workspace_id, analysis, title, description, learning_outcomes_text")
      .eq("id", data.assessmentId)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (!existing) throw new Error("Assessment not found.");
    const row = existing as {
      id: string;
      workspace_id: string;
      analysis: Record<string, unknown> | null;
      title: string;
      description: string;
      learning_outcomes_text: string;
    };

    const prior = AssessmentAnalysisSchema.parse(row.analysis ?? {});
    const priorRaw = (row.analysis ?? {}) as Record<string, unknown>;

    const learningOutcomes = data.learningOutcomes ?? prior.learningOutcomes;
    const concepts = data.concepts ?? prior.concepts;
    const skills = data.skills ?? prior.skills;
    const likelyMisconceptions = data.likelyMisconceptions ?? prior.likelyMisconceptions;
    const summary = data.summary ?? prior.summary;

    // Keep interviewPlan in sync with edited concepts when present.
    const priorPlan = Array.isArray(priorRaw.interviewPlan)
      ? (priorRaw.interviewPlan as Array<Record<string, unknown>>)
      : [];
    const conceptSet = new Set(concepts.map((c) => c.trim().toLowerCase()));
    let interviewPlan = priorPlan.filter((item) => {
      const topic = String(item.topic ?? "").trim().toLowerCase();
      return topic && conceptSet.has(topic);
    });
    // Add plan stubs for new concepts not already in the plan.
    for (const concept of concepts) {
      const key = concept.trim().toLowerCase();
      if (!interviewPlan.some((p) => String(p.topic ?? "").trim().toLowerCase() === key)) {
        interviewPlan.push({
          topic: concept.trim(),
          primaryQuestion: `Explain “${concept.trim()}” in your own words, and give one clear example.`,
          followUpIfWeak: `Can you give a simpler example of “${concept.trim()}” and say why it fits?`,
          followUpIfStrong: `How would you teach “${concept.trim()}” to a classmate who often gets it wrong?`,
          evidenceRequired: ["clear explanation", "example"],
          bloomLevel: "Understand/Apply",
        });
      }
    }
    interviewPlan = interviewPlan.slice(0, MAX_INTERVIEW_PLAN_ITEMS);

    const nextAnalysis = {
      ...priorRaw,
      ...AssessmentAnalysisSchema.parse({
        ...prior,
        learningOutcomes: learningOutcomes.map((s) => s.trim()).filter(Boolean),
        concepts: concepts.map((s) => s.trim()).filter(Boolean),
        skills: skills.map((s) => s.trim()).filter(Boolean),
        likelyMisconceptions: likelyMisconceptions.map((s) => s.trim()).filter(Boolean),
        summary: summary.trim(),
      }),
      interviewPlan,
    };

    const patch: Record<string, unknown> = {
      analysis: nextAnalysis,
      updated_at: new Date().toISOString(),
    };
    if (data.title != null) patch.title = data.title.trim();
    if (data.description != null) patch.description = data.description.trim();
    if (data.learningOutcomes != null) {
      patch.learning_outcomes_text = learningOutcomes.map((s) => s.trim()).filter(Boolean).join("\n");
    }

    const { error } = await context.supabase
      .from("oral_assessment_assessments" as never)
      .update(patch as never)
      .eq("id", data.assessmentId)
      .eq("owner_id", context.userId);
    if (error) throw new Error("Could not save assessment details.");

    await writeAudit(context, {
      workspace_id: row.workspace_id,
      assessment_id: data.assessmentId,
      event_type: "assessment.details_updated",
      payload: {
        outcomes: learningOutcomes.length,
        concepts: concepts.length,
        titleChanged: data.title != null,
      },
    });

    return {
      assessmentId: data.assessmentId,
      title: (patch.title as string | undefined) ?? row.title,
      analysis: AssessmentAnalysisSchema.parse(nextAnalysis),
    };
  });

const EditableQuestionSchema = z.object({
  code: z.string().min(1).max(40).optional(),
  label: z.string().min(1).max(300),
  primaryQuestion: z.string().min(8).max(2000),
  followUpIfWeak: z.string().min(0).max(2000).default(""),
  followUpIfStrong: z.string().min(0).max(2000).default(""),
  evidenceRequired: z.array(z.string().max(300)).max(12).optional(),
  rubricMapping: z.array(z.string().max(80)).max(12).optional(),
});

const SaveQuestionsInput = z.object({
  assessmentId: z.string().uuid(),
  questions: z.array(EditableQuestionSchema).min(1).max(MAX_INTERVIEW_PLAN_ITEMS),
  adaptiveNotes: z.string().max(4000).optional(),
  examinerPersona: z.string().max(500).optional(),
});

/** Lecturer reviews/edits generated viva questions before students sit. */
export const saveOralAssessmentQuestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SaveQuestionsInput.parse(raw))
  .handler(async ({ context, data }) => {
    requireOralAccess(context);

    const { data: assessment } = await context.supabase
      .from("oral_assessment_assessments" as never)
      .select("id, workspace_id, status")
      .eq("id", data.assessmentId)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (!assessment) throw new Error("Assessment not found.");
    const a = assessment as { id: string; workspace_id: string; status: string };
    if (["analysing", "uploading", "draft"].includes(a.status)) {
      throw new Error("Wait until questions have been generated before editing.");
    }

    const { data: existingBp } = await context.supabase
      .from("oral_assessment_blueprints" as never)
      .select("id, version, blueprint, adaptive_strategy")
      .eq("assessment_id", data.assessmentId)
      .maybeSingle();
    const existing = existingBp as {
      id: string;
      version: number;
      blueprint: unknown;
      adaptive_strategy: Record<string, unknown> | null;
    } | null;

    const prior = InterviewBlueprintSchema.parse(existing?.blueprint ?? {});
    const followUpBank: Record<string, { weak: string; strong: string }> = {};
    const usedCodes = new Set<string>();
    const outcomes = data.questions.map((q, i) => {
      let code = (q.code?.trim() || `LO${i + 1}`).slice(0, 40);
      if (!code || usedCodes.has(code)) {
        let n = i + 1;
        while (usedCodes.has(`LO${n}`)) n += 1;
        code = `LO${n}`;
      }
      usedCodes.add(code);
      followUpBank[code] = {
        weak: q.followUpIfWeak.trim(),
        strong: q.followUpIfStrong.trim(),
      };
      return {
        code,
        label: q.label.trim(),
        primaryQuestion: q.primaryQuestion.trim(),
        followUpLogic: [
          q.followUpIfWeak.trim() ? `If weak → ${q.followUpIfWeak.trim()}` : "",
          q.followUpIfStrong.trim() ? `If strong → ${q.followUpIfStrong.trim()}` : "",
        ]
          .filter(Boolean)
          .join(" "),
        evidenceRequired: q.evidenceRequired?.length
          ? q.evidenceRequired
          : prior.outcomes[i]?.evidenceRequired ?? ["clear explanation", "example"],
        rubricMapping: q.rubricMapping?.length
          ? q.rubricMapping
          : prior.outcomes[i]?.rubricMapping ?? ["knowledge", "application", "reasoning"],
      };
    });

    const blueprint = InterviewBlueprintSchema.parse({
      outcomes,
      adaptiveNotes:
        data.adaptiveNotes?.trim() ||
        prior.adaptiveNotes ||
        "Lecturer-reviewed oral viva questions.",
      examinerPersona:
        data.examinerPersona?.trim() ||
        prior.examinerPersona ||
        "calm, supportive academic examiner",
    });

    const nextVersion = (existing?.version ?? 0) + 1;
    const adaptive_strategy = {
      ...(existing?.adaptive_strategy ?? {}),
      followUpBank,
      notes: blueprint.adaptiveNotes,
      persona: blueprint.examinerPersona,
      lecturerEdited: true,
      editedAt: new Date().toISOString(),
    };

    if (existing) {
      const { error } = await context.supabase
        .from("oral_assessment_blueprints" as never)
        .update({
          version: nextVersion,
          blueprint,
          question_bank: outcomes.map((o) => ({
            code: o.code,
            topic: o.label,
            primary: o.primaryQuestion,
            followUpLogic: o.followUpLogic,
          })),
          adaptive_strategy,
          engine_version: INTERVIEW_ENGINE_VERSION,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", existing.id);
      if (error) throw new Error("Could not save questions.");
    } else {
      const { error } = await context.supabase.from("oral_assessment_blueprints" as never).insert({
        assessment_id: data.assessmentId,
        version: 1,
        blueprint,
        question_bank: outcomes.map((o) => ({
          code: o.code,
          topic: o.label,
          primary: o.primaryQuestion,
          followUpLogic: o.followUpLogic,
        })),
        adaptive_strategy,
        engine_version: INTERVIEW_ENGINE_VERSION,
      } as never);
      if (error) throw new Error("Could not save questions.");
    }

    if (a.status === "failed") {
      await context.supabase
        .from("oral_assessment_assessments" as never)
        .update({
          status: "ready",
          analysis_error: null,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", a.id);
    } else {
      await context.supabase
        .from("oral_assessment_assessments" as never)
        .update({ updated_at: new Date().toISOString() } as never)
        .eq("id", a.id);
    }

    await writeAudit(context, {
      workspace_id: a.workspace_id,
      assessment_id: a.id,
      event_type: "assessment.questions_edited",
      payload: { count: outcomes.length, version: nextVersion },
    });

    return {
      assessmentId: a.id,
      version: nextVersion,
      questions: outcomes.map((o) => ({
        code: o.code,
        label: o.label,
        primaryQuestion: o.primaryQuestion,
        followUpIfWeak: followUpBank[o.code]?.weak ?? "",
        followUpIfStrong: followUpBank[o.code]?.strong ?? "",
      })),
    };
  });

/**
 * Re-run analysis + interview blueprint from stored files (fixes placeholder/generic questions).
 */
export const regenerateOralAssessment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => AssessmentIdInput.parse(raw))
  .handler(async ({ context, data }) => {
    requireOralAccess(context);

    const { data: assessment } = await context.supabase
      .from("oral_assessment_assessments" as never)
      .select("id, title, workspace_id, learning_outcomes_text, memorandum_text, status")
      .eq("id", data.assessmentId)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (!assessment) throw new Error("Assessment not found.");
    const a = assessment as {
      id: string;
      title: string;
      workspace_id: string;
      learning_outcomes_text: string;
      memorandum_text: string;
      status: string;
    };

    await context.supabase
      .from("oral_assessment_assessments" as never)
      .update({ status: "analysing", analysis_error: null, updated_at: new Date().toISOString() } as never)
      .eq("id", a.id);

    const { data: files } = await context.supabase
      .from("oral_assessment_files" as never)
      .select("extracted_text, role, storage_path, content_type, kind, file_name")
      .eq("assessment_id", a.id);

    const fileRows = (files ?? []) as Array<{
      extracted_text: string;
      role: string;
      storage_path: string;
      content_type: string;
      kind: string;
      file_name: string;
    }>;

    const sourceText = fileRows.map((f) => f.extracted_text).filter(Boolean).join("\n\n");
    const textLooksThin =
      sourceText.replace(/\[.*?\]/g, "").trim().length < 80 ||
      /^\[(PDF|PRESENTATION|IMAGE|FILE) FILE:/i.test(sourceText.trim());

    const media: Array<{ mimeType: string; base64: string }> = [];
    if (textLooksThin) {
      for (const f of fileRows.slice(0, 3)) {
        const mime = f.content_type || "";
        const isPdf = mime === "application/pdf" || f.kind === "pdf" || f.file_name.toLowerCase().endsWith(".pdf");
        const isImage = mime.startsWith("image/") || f.kind === "image";
        if (!isPdf && !isImage) continue;
        try {
          const { data: blob, error: dlErr } = await context.supabase.storage
            .from("oral-assessment")
            .download(f.storage_path);
          if (dlErr || !blob) continue;
          const buf = await blob.arrayBuffer();
          if (buf.byteLength > 3_500_000) continue;
          const bytes = new Uint8Array(buf);
          let binary = "";
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
          }
          media.push({
            mimeType: isPdf ? "application/pdf" : mime || "image/jpeg",
            base64: btoa(binary),
          });
        } catch (err) {
          console.error("[oral-assessment] regenerate media download failed", err);
        }
      }
    }

    try {
      const { analysis, model } = await analyseAssessment({
        title: a.title,
        sourceText,
        learningOutcomesText: a.learning_outcomes_text,
        memorandumText: a.memorandum_text,
        userId: context.userId,
        media,
      });
      // If we got richer analysis, also refresh stored extract when media produced useful concepts
      if (media.length && analysis.summary) {
        // keep extracted_text as-is; blueprint is what matters for viva
      }
      const blueprint = buildInterviewBlueprint({ title: a.title, analysis });
      const followUpBank = followUpsForPlan(analysis);

      const { data: existingBp } = await context.supabase
        .from("oral_assessment_blueprints" as never)
        .select("id, version, adaptive_strategy")
        .eq("assessment_id", a.id)
        .maybeSingle();

      const priorStrategy = (existingBp as { adaptive_strategy?: Record<string, unknown> } | null)
        ?.adaptive_strategy;
      const preservedMode = parseQuestionAssignmentMode(priorStrategy?.questionAssignmentMode);

      const nextVersion = ((existingBp as { version: number } | null)?.version ?? 0) + 1;

      if (existingBp) {
        await context.supabase
          .from("oral_assessment_blueprints" as never)
          .update({
            version: nextVersion,
            blueprint,
            question_bank: blueprint.outcomes.map((o) => ({
              code: o.code,
              topic: o.label,
              primary: o.primaryQuestion,
              followUpLogic: o.followUpLogic,
            })),
            adaptive_strategy: {
              ...(priorStrategy ?? {}),
              notes: blueprint.adaptiveNotes,
              persona: blueprint.examinerPersona,
              followUpBank,
              questionAssignmentMode: preservedMode,
            },
            engine_version: INTERVIEW_ENGINE_VERSION,
            updated_at: new Date().toISOString(),
          } as never)
          .eq("assessment_id", a.id);
      } else {
        await context.supabase.from("oral_assessment_blueprints" as never).insert({
          assessment_id: a.id,
          version: 1,
          blueprint,
          question_bank: blueprint.outcomes.map((o) => ({
            code: o.code,
            topic: o.label,
            primary: o.primaryQuestion,
          })),
          adaptive_strategy: {
            followUpBank,
            notes: blueprint.adaptiveNotes,
            questionAssignmentMode: "same",
          },
          engine_version: INTERVIEW_ENGINE_VERSION,
        } as never);
      }

      await context.supabase
        .from("oral_assessment_assessments" as never)
        .update({
          status: a.status === "published" ? "published" : "ready",
          analysis,
          analysis_model: model,
          analysis_error: null,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", a.id);

      await writeAudit(context, {
        workspace_id: a.workspace_id,
        assessment_id: a.id,
        event_type: "assessment.regenerated",
        payload: { model, analysisEngine: ANALYSIS_ENGINE_VERSION },
      });

      return {
        assessmentId: a.id,
        status: a.status === "published" ? ("published" as const) : ("ready" as const),
        topics: blueprint.outcomes.map((o) => o.label),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Regeneration failed";
      await context.supabase
        .from("oral_assessment_assessments" as never)
        .update({
          status: "failed",
          analysis_error: message,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", a.id);
      throw new Error(message);
    }
  });

const AddStudentInput = z.object({
  assessmentId: z.string().uuid(),
  email: z.string().email().max(320),
  fullName: z.string().max(200).optional(),
  studentNumber: z.string().max(100).optional(),
});

export const inviteStudentToAssessment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => AddStudentInput.parse(raw))
  .handler(async ({ context, data }) => {
    requireOralAccess(context);
    const ws = await getOrCreateWorkspace(context);

    const { data: assessment } = await context.supabase
      .from("oral_assessment_assessments" as never)
      .select("id, workspace_id, status, title, expected_duration_minutes")
      .eq("id", data.assessmentId)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (!assessment) throw new Error("Assessment not found.");
    const a = assessment as {
      id: string;
      workspace_id: string;
      status: string;
      title: string;
      expected_duration_minutes: number;
    };

    const email = data.email.toLowerCase().trim();
    const { data: existingStudent } = await context.supabase
      .from("oral_assessment_students" as never)
      .select("id")
      .eq("workspace_id", ws.id)
      .eq("email", email)
      .maybeSingle();

    let studentId: string;
    if (existingStudent) {
      studentId = (existingStudent as { id: string }).id;
      await context.supabase
        .from("oral_assessment_students" as never)
        .update({
          full_name: data.fullName ?? "",
          student_number: data.studentNumber ?? "",
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", studentId);
    } else {
      const { data: created, error } = await context.supabase
        .from("oral_assessment_students" as never)
        .insert({
          workspace_id: ws.id,
          email,
          full_name: data.fullName ?? "",
          student_number: data.studentNumber ?? "",
        } as never)
        .select("id")
        .single();
      if (error || !created) throw new Error("Could not create student.");
      studentId = (created as { id: string }).id;
    }

    const inviteToken = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const { data: invite, error: invErr } = await context.supabase
      .from("oral_assessment_invitations" as never)
      .upsert(
        {
          assessment_id: data.assessmentId,
          student_id: studentId,
          status: "pending",
          invite_token: inviteToken,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "assessment_id,student_id" },
      )
      .select("id, invite_token, status")
      .single();

    if (invErr || !invite) throw new Error("Could not create invitation.");
    const inv = invite as { id: string; invite_token: string; status: string };

    const { EMAIL_APP_URL } = await import("@/lib/email-config");
    const inviteUrl = `${EMAIL_APP_URL}/tools/oral-assessment/invite/${inv.invite_token}`;

    const lecturerName =
      ((context.claims as { user_metadata?: { full_name?: string }; email?: string } | null)
        ?.user_metadata?.full_name as string | undefined)?.split(" ")[0] ||
      (context.claims as { email?: string } | null)?.email?.split("@")[0] ||
      "Your lecturer";

    let emailQueued = false;
    let emailReason: string | null = null;
    try {
      const { enqueueTransactionalTemplate } = await import("@/lib/email-send.server");
      const result = await enqueueTransactionalTemplate({
        templateName: "oral-assessment-invite",
        recipientEmail: email,
        idempotencyKey: `oral-invite-${inv.id}-${inv.invite_token.slice(0, 12)}`,
        templateData: {
          studentName: data.fullName?.trim() || undefined,
          lecturerName,
          assessmentTitle: a.title,
          inviteUrl,
          expectedDurationMinutes: a.expected_duration_minutes,
        },
      });
      emailQueued = result.ok;
      emailReason = result.ok ? null : result.reason;
    } catch (err) {
      emailReason = err instanceof Error ? err.message : "email_failed";
    }

    await writeAudit(context, {
      workspace_id: ws.id,
      assessment_id: data.assessmentId,
      event_type: "student.invited",
      payload: { studentId, email, emailQueued, emailReason },
    });

    return {
      studentId,
      invitation: inv,
      inviteUrl,
      emailQueued,
      emailReason,
    };
  });

const InvitationIdInput = z.object({
  invitationId: z.string().uuid(),
});

/** Resend invite email with a fresh token. Does not reset started/completed invites to pending. */
export const resendOralInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => InvitationIdInput.parse(raw))
  .handler(async ({ context, data }) => {
    requireOralAccess(context);

    const { data: invite } = await context.supabase
      .from("oral_assessment_invitations" as never)
      .select("id, assessment_id, student_id, status, invite_token")
      .eq("id", data.invitationId)
      .maybeSingle();
    if (!invite) throw new Error("Invitation not found.");
    const inv = invite as {
      id: string;
      assessment_id: string;
      student_id: string;
      status: string;
      invite_token: string;
    };

    const { data: assessment } = await context.supabase
      .from("oral_assessment_assessments" as never)
      .select("id, title, expected_duration_minutes, workspace_id, owner_id")
      .eq("id", inv.assessment_id)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (!assessment) throw new Error("Forbidden");
    const a = assessment as {
      id: string;
      title: string;
      expected_duration_minutes: number;
      workspace_id: string;
    };

    if (inv.status === "revoked" || inv.status === "expired") {
      throw new Error("This invitation was revoked or expired. Create a new invite.");
    }

    const { data: student } = await context.supabase
      .from("oral_assessment_students" as never)
      .select("id, email, full_name")
      .eq("id", inv.student_id)
      .maybeSingle();
    if (!student) throw new Error("Student not found.");
    const s = student as { id: string; email: string; full_name: string };

    const inviteToken = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const nextStatus = ["started", "completed", "accepted"].includes(inv.status)
      ? inv.status
      : "pending";

    await context.supabase
      .from("oral_assessment_invitations" as never)
      .update({
        invite_token: inviteToken,
        status: nextStatus,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", inv.id);

    const { EMAIL_APP_URL } = await import("@/lib/email-config");
    const inviteUrl = `${EMAIL_APP_URL}/tools/oral-assessment/invite/${inviteToken}`;

    const lecturerName =
      ((context.claims as { user_metadata?: { full_name?: string } } | null)?.user_metadata
        ?.full_name as string | undefined)?.split(" ")[0] ||
      (context.claims as { email?: string } | null)?.email?.split("@")[0] ||
      "Your lecturer";

    let emailQueued = false;
    let emailReason: string | null = null;
    try {
      const { enqueueTransactionalTemplate } = await import("@/lib/email-send.server");
      const result = await enqueueTransactionalTemplate({
        templateName: "oral-assessment-invite",
        recipientEmail: s.email,
        idempotencyKey: `oral-invite-${inv.id}-${inviteToken.slice(0, 12)}`,
        templateData: {
          studentName: s.full_name || undefined,
          lecturerName,
          assessmentTitle: a.title,
          inviteUrl,
          expectedDurationMinutes: a.expected_duration_minutes,
        },
      });
      emailQueued = result.ok;
      emailReason = result.ok ? null : result.reason;
    } catch (err) {
      emailReason = err instanceof Error ? err.message : "email_failed";
    }

    await writeAudit(context, {
      workspace_id: a.workspace_id,
      assessment_id: a.id,
      event_type: "student.invite_resent",
      payload: { invitationId: inv.id, email: s.email, emailQueued, emailReason },
    });

    return { invitationId: inv.id, inviteUrl, emailQueued, emailReason };
  });

/** Revoke an invitation so the token can no longer start a viva. */
export const revokeOralInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => InvitationIdInput.parse(raw))
  .handler(async ({ context, data }) => {
    requireOralAccess(context);

    const { data: invite } = await context.supabase
      .from("oral_assessment_invitations" as never)
      .select("id, assessment_id, status")
      .eq("id", data.invitationId)
      .maybeSingle();
    if (!invite) throw new Error("Invitation not found.");
    const inv = invite as { id: string; assessment_id: string; status: string };

    const { data: assessment } = await context.supabase
      .from("oral_assessment_assessments" as never)
      .select("id, workspace_id, owner_id")
      .eq("id", inv.assessment_id)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (!assessment) throw new Error("Forbidden");
    const a = assessment as { id: string; workspace_id: string };

    if (inv.status === "completed") {
      throw new Error("Cannot revoke an invitation after the assessment is completed.");
    }

    await context.supabase
      .from("oral_assessment_invitations" as never)
      .update({ status: "revoked", updated_at: new Date().toISOString() } as never)
      .eq("id", inv.id);

    await writeAudit(context, {
      workspace_id: a.workspace_id,
      assessment_id: a.id,
      event_type: "student.invite_revoked",
      payload: { invitationId: inv.id },
    });

    return { invitationId: inv.id, status: "revoked" as const };
  });

const BatchInviteInput = z.object({
  assessmentId: z.string().uuid(),
  /** One student per line: email, or "Name <email>", or "email,Name" */
  lines: z.string().min(3).max(20_000),
});

function parseInviteLines(raw: string): Array<{ email: string; fullName?: string }> {
  const out: Array<{ email: string; fullName?: string }> = [];
  const seen = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    let email = "";
    let fullName: string | undefined;
    const angle = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
    if (angle) {
      fullName = angle[1].trim() || undefined;
      email = angle[2].trim();
    } else if (trimmed.includes(",")) {
      const [a, b] = trimmed.split(",").map((p) => p.trim());
      if (a.includes("@")) {
        email = a;
        fullName = b || undefined;
      } else {
        fullName = a || undefined;
        email = b;
      }
    } else {
      email = trimmed;
    }
    email = email.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({ email, fullName });
  }
  return out.slice(0, 50);
}

export const inviteStudentsBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => BatchInviteInput.parse(raw))
  .handler(async ({ context, data }) => {
    requireOralAccess(context);
    const ws = await getOrCreateWorkspace(context);
    const parsed = parseInviteLines(data.lines);
    if (parsed.length === 0) throw new Error("No valid email addresses found.");

    const { data: assessment } = await context.supabase
      .from("oral_assessment_assessments" as never)
      .select("id, workspace_id, status, title, expected_duration_minutes")
      .eq("id", data.assessmentId)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (!assessment) throw new Error("Assessment not found.");
    const a = assessment as {
      id: string;
      workspace_id: string;
      title: string;
      expected_duration_minutes: number;
    };

    const { EMAIL_APP_URL } = await import("@/lib/email-config");
    const { enqueueTransactionalTemplate } = await import("@/lib/email-send.server");
    const lecturerName =
      ((context.claims as { user_metadata?: { full_name?: string } } | null)?.user_metadata
        ?.full_name as string | undefined)?.split(" ")[0] ||
      (context.claims as { email?: string } | null)?.email?.split("@")[0] ||
      "Your lecturer";

    const results: Array<{
      email: string;
      ok: boolean;
      inviteUrl?: string;
      emailQueued?: boolean;
      error?: string;
    }> = [];

    for (const row of parsed) {
      try {
        const email = row.email;
        const { data: existingStudent } = await context.supabase
          .from("oral_assessment_students" as never)
          .select("id")
          .eq("workspace_id", ws.id)
          .eq("email", email)
          .maybeSingle();

        let studentId: string;
        if (existingStudent) {
          studentId = (existingStudent as { id: string }).id;
          if (row.fullName) {
            await context.supabase
              .from("oral_assessment_students" as never)
              .update({
                full_name: row.fullName,
                updated_at: new Date().toISOString(),
              } as never)
              .eq("id", studentId);
          }
        } else {
          const { data: created, error } = await context.supabase
            .from("oral_assessment_students" as never)
            .insert({
              workspace_id: ws.id,
              email,
              full_name: row.fullName ?? "",
            } as never)
            .select("id")
            .single();
          if (error || !created) throw new Error("Could not create student.");
          studentId = (created as { id: string }).id;
        }

        const inviteToken = Array.from(crypto.getRandomValues(new Uint8Array(24)))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        const { data: invite, error: invErr } = await context.supabase
          .from("oral_assessment_invitations" as never)
          .upsert(
            {
              assessment_id: data.assessmentId,
              student_id: studentId,
              status: "pending",
              invite_token: inviteToken,
              updated_at: new Date().toISOString(),
            } as never,
            { onConflict: "assessment_id,student_id" },
          )
          .select("id, invite_token, status")
          .single();
        if (invErr || !invite) throw new Error("Could not create invitation.");
        const inv = invite as { id: string; invite_token: string; status: string };
        const inviteUrl = `${EMAIL_APP_URL}/tools/oral-assessment/invite/${inv.invite_token}`;

        let emailQueued = false;
        try {
          const result = await enqueueTransactionalTemplate({
            templateName: "oral-assessment-invite",
            recipientEmail: email,
            idempotencyKey: `oral-invite-${inv.id}-${inv.invite_token.slice(0, 12)}`,
            templateData: {
              studentName: row.fullName,
              lecturerName,
              assessmentTitle: a.title,
              inviteUrl,
              expectedDurationMinutes: a.expected_duration_minutes,
            },
          });
          emailQueued = result.ok;
        } catch {
          emailQueued = false;
        }

        await writeAudit(context, {
          workspace_id: a.workspace_id,
          assessment_id: data.assessmentId,
          event_type: "student.invited",
          payload: { studentId, email, emailQueued, batch: true },
        });

        results.push({ email, ok: true, inviteUrl, emailQueued });
      } catch (err) {
        results.push({
          email: row.email,
          ok: false,
          error: err instanceof Error ? err.message : "Invite failed",
        });
      }
    }

    return {
      total: parsed.length,
      invited: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  });

