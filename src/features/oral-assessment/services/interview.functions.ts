import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  briefingMessage,
  nextExaminerTurn,
  adaptExaminerTurn,
  answerLooksLikeDontKnow,
  assignOutcomeCodesForSession,
  filterBlueprintForSession,
  resolveSessionOutcomes,
  outcomesAskedInSession,
  parseQuestionAssignmentMode,
  INTERVIEW_ENGINE_VERSION,
  type QuestionAssignmentMode,
} from "@/features/oral-assessment/engines/interview-engine";
import {
  InterviewBlueprintSchema,
  SessionReportSchema,
  type QuestionScore,
  type ScoringResult,
} from "@/features/oral-assessment/types";

/** Stored on oral_assessment_scores.dimension_scores, including per-question marks. */
export type OralDimensionScores = ScoringResult["dimensionScores"] & {
  _questionScores?: QuestionScore[];
};
import { scoreSession } from "@/features/oral-assessment/engines/scoring-engine";
import { SCORING_ENGINE_VERSION } from "@/features/oral-assessment/engines/scoring-engine";
import { buildSessionReport } from "@/features/oral-assessment/engines/reporting-engine";
import { REPORTING_ENGINE_VERSION } from "@/features/oral-assessment/engines/reporting-engine";
import {
  getOrCreateWorkspace,
  requireOralAccess,
  writeAudit,
} from "./workspace.functions";

async function loadBlueprintForInterview(assessmentId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: blueprintRow } = await supabaseAdmin
    .from("oral_assessment_blueprints" as never)
    .select("blueprint, adaptive_strategy")
    .eq("assessment_id", assessmentId)
    .maybeSingle();
  return blueprintRow as {
    blueprint: unknown;
    adaptive_strategy: {
      followUpBank?: Record<string, { weak: string; strong: string }>;
      questionAssignmentMode?: QuestionAssignmentMode;
      notes?: string;
      persona?: string;
    } | null;
  } | null;
}

type SystemTurnMeta = {
  assignedOutcomeCodes?: string[];
  questionAssignmentMode?: QuestionAssignmentMode;
};

async function loadAssignedOutcomeCodes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  sessionId: string,
): Promise<string[] | null> {
  const { data } = await supabase
    .from("oral_assessment_transcript_turns" as never)
    .select("metadata")
    .eq("session_id", sessionId)
    .eq("role", "system")
    .order("turn_index", { ascending: true })
    .limit(1)
    .maybeSingle();
  const codes = (data as { metadata: SystemTurnMeta | null } | null)?.metadata?.assignedOutcomeCodes;
  return Array.isArray(codes) && codes.length ? codes.map(String) : null;
}

async function persistAssignedOutcomeCodes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  sessionId: string,
  codes: string[],
  mode: QuestionAssignmentMode,
) {
  const { data: systemTurn, error: findErr } = await supabase
    .from("oral_assessment_transcript_turns" as never)
    .select("id, metadata")
    .eq("session_id", sessionId)
    .eq("role", "system")
    .order("turn_index", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (findErr) throw new Error(`Could not load session briefing: ${findErr.message}`);
  if (!systemTurn) throw new Error("Session briefing missing — cannot assign questions.");
  const row = systemTurn as { id: string; metadata: Record<string, unknown> | null };
  const { error } = await supabase
    .from("oral_assessment_transcript_turns" as never)
    .update({
      metadata: {
        ...(row.metadata ?? {}),
        assignedOutcomeCodes: codes,
        questionAssignmentMode: mode,
      },
    } as never)
    .eq("id", row.id);
  if (error) throw new Error(`Could not save question assignment: ${error.message}`);
}

/** Ensure this session has a stable assigned question set (same or varied). */
async function ensureSessionAssignment(opts: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  sessionId: string;
  outcomeCodes: string[];
  mode: QuestionAssignmentMode;
  expectedDurationMinutes: number;
}): Promise<string[]> {
  let assignedCodes = await loadAssignedOutcomeCodes(opts.supabase, opts.sessionId);
  if (!assignedCodes?.length) {
    assignedCodes = assignOutcomeCodesForSession({
      outcomeCodes: opts.outcomeCodes,
      mode: opts.mode,
      expectedDurationMinutes: opts.expectedDurationMinutes,
    });
    await persistAssignedOutcomeCodes(
      opts.supabase,
      opts.sessionId,
      assignedCodes,
      opts.mode,
    );
  }
  return assignedCodes;
}

async function loadAssessmentAdmin(assessmentId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("oral_assessment_assessments" as never)
    .select(
      "id, title, owner_id, expected_duration_minutes, status, workspace_id, extra_time_multiplier, memorandum_text",
    )
    .eq("id", assessmentId)
    .maybeSingle();
  return data as {
    id: string;
    title: string;
    owner_id: string;
    expected_duration_minutes: number;
    status: string;
    workspace_id: string;
    extra_time_multiplier: number;
    memorandum_text: string;
  } | null;
}

const StartDemoSessionInput = z.object({
  assessmentId: z.string().uuid(),
  studentEmail: z.string().email().max(320).optional(),
  studentName: z.string().max(200).optional(),
});

/**
 * Lecturer demo / Sprint 0 path: start a session without a real student invite flow.
 * Creates (or reuses) a demo student on the workspace and opens a briefing session.
 */
export const startDemoInterviewSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => StartDemoSessionInput.parse(raw))
  .handler(async ({ context, data }) => {
    requireOralAccess(context);
    const ws = await getOrCreateWorkspace(context);

    const { data: assessment } = await context.supabase
      .from("oral_assessment_assessments" as never)
      .select("id, title, status, expected_duration_minutes, workspace_id")
      .eq("id", data.assessmentId)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (!assessment) throw new Error("Assessment not found.");
    const a = assessment as {
      id: string;
      title: string;
      status: string;
      expected_duration_minutes: number;
      workspace_id: string;
    };
    if (!["ready", "published"].includes(a.status)) {
      throw new Error("Assessment must be ready or published to start an interview.");
    }

    const email = (data.studentEmail ?? `demo+${context.userId.slice(0, 8)}@oral.penny.local`).toLowerCase();
    const { data: existingStudent } = await context.supabase
      .from("oral_assessment_students" as never)
      .select("id")
      .eq("workspace_id", ws.id)
      .eq("email", email)
      .maybeSingle();

    let studentId: string;
    if (existingStudent) {
      studentId = (existingStudent as { id: string }).id;
    } else {
      const { data: created, error } = await context.supabase
        .from("oral_assessment_students" as never)
        .insert({
          workspace_id: ws.id,
          email,
          full_name: data.studentName ?? "Demo student",
          user_id: context.userId,
        } as never)
        .select("id")
        .single();
      if (error || !created) throw new Error("Could not create demo student.");
      studentId = (created as { id: string }).id;
    }

    const { data: session, error: sessErr } = await context.supabase
      .from("oral_assessment_sessions" as never)
      .insert({
        assessment_id: a.id,
        student_id: studentId,
        status: "briefing",
        question_pathway: [],
        interview_engine_version: INTERVIEW_ENGINE_VERSION,
        ai_model_version: "placeholder",
      } as never)
      .select("id, status")
      .single();
    if (sessErr || !session) throw new Error("Could not create interview session.");
    const sess = session as { id: string; status: string };

    const briefing = briefingMessage({
      title: a.title,
      expectedDurationMinutes: a.expected_duration_minutes,
    });

    await context.supabase.from("oral_assessment_transcript_turns" as never).insert({
      session_id: sess.id,
      turn_index: 0,
      role: "system",
      content: briefing,
      response_format: "text",
    } as never);

    await writeAudit(context, {
      workspace_id: a.workspace_id,
      assessment_id: a.id,
      session_id: sess.id,
      event_type: "session.created",
      payload: { demo: true },
    });

    return { sessionId: sess.id, status: sess.status };
  });

const SessionIdInput = z.object({
  sessionId: z.string().uuid(),
});

export const getInterviewSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SessionIdInput.parse(raw))
  .handler(async ({ context, data }) => {
    const { data: session } = await context.supabase
      .from("oral_assessment_sessions" as never)
      .select(
        "id, assessment_id, student_id, invitation_id, status, question_pathway, interview_engine_version, ai_model_version, started_at, completed_at, created_at, updated_at",
      )
      .eq("id", data.sessionId)
      .maybeSingle();
    if (!session) throw new Error("Session not found.");
    const sess = session as {
      id: string;
      assessment_id: string;
      student_id: string;
      invitation_id: string | null;
      status: string;
      question_pathway: string[];
      interview_engine_version: string;
      ai_model_version: string | null;
      started_at: string | null;
      completed_at: string | null;
      created_at: string;
      updated_at: string;
    };

    const a = await loadAssessmentAdmin(sess.assessment_id);
    if (!a) throw new Error("Assessment not found.");

    const { data: student } = await context.supabase
      .from("oral_assessment_students" as never)
      .select("id, email, full_name, user_id, extra_time_multiplier, alternative_response_format")
      .eq("id", sess.student_id)
      .maybeSingle();
    const s = student as {
      id: string;
      email: string;
      full_name: string;
      user_id: string | null;
      extra_time_multiplier: number;
      alternative_response_format: string | null;
    } | null;
    if (a.owner_id !== context.userId && s?.user_id !== context.userId) {
      throw new Error("Forbidden");
    }

    const assessmentExtra = Number(a.extra_time_multiplier) || 1;
    const studentExtra = Number(s?.extra_time_multiplier) || 1;
    const extraTimeMultiplier = Math.min(3, Math.max(1, Math.max(assessmentExtra, studentExtra)));
    const effectiveDurationMinutes = Math.round(
      (Number(a.expected_duration_minutes) || 15) * extraTimeMultiplier,
    );

    const { data: turns } = await context.supabase
      .from("oral_assessment_transcript_turns" as never)
      .select("id, turn_index, role, content, question_code, learning_outcome_code, bloom_level, created_at")
      .eq("session_id", data.sessionId)
      .order("turn_index");

    const { data: score } = await context.supabase
      .from("oral_assessment_scores" as never)
      .select(
        "id, recommended_mark, confidence_score, strengths, weaknesses, suggested_lecturer_feedback, suggested_final_comment, final_mark, final_comment, lecturer_edited, marked_at",
      )
      .eq("session_id", data.sessionId)
      .maybeSingle();

    return {
      session: sess,
      assessment: a,
      student: s,
      effectiveDurationMinutes,
      extraTimeMultiplier,
      allowTextAnswers: true,
      turns: ((turns ?? []) as Array<{
        id: string;
        turn_index: number;
        role: string;
        content: string;
        question_code: string | null;
        learning_outcome_code: string | null;
        bloom_level: string | null;
        created_at: string;
      }>),
      score: (score ?? null) as {
        id: string;
        recommended_mark: number | null;
        confidence_score: number | null;
        strengths: string[];
        weaknesses: string[];
        suggested_lecturer_feedback: string;
        suggested_final_comment: string;
        final_mark: number | null;
        final_comment: string;
        lecturer_edited: boolean;
        marked_at: string | null;
      } | null,
    };
  });

const StudentReplyInput = z.object({
  sessionId: z.string().uuid(),
  content: z.string().min(1).max(20_000),
  responseFormat: z.enum(["text", "speech", "mixed"]).optional(),
});

const SessionIdOnly = z.object({
  sessionId: z.string().uuid(),
});

/**
 * After briefing TTS: open the viva with the first examiner question (no student text required).
 */
export const beginInterviewQuestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SessionIdOnly.parse(raw))
  .handler(async ({ context, data }) => {
    const { data: session } = await context.supabase
      .from("oral_assessment_sessions" as never)
      .select("*")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (!session) throw new Error("Session not found.");
    const sess = session as {
      id: string;
      assessment_id: string;
      student_id: string;
      status: string;
      question_pathway: string[];
    };

    const a = await loadAssessmentAdmin(sess.assessment_id);
    if (!a) throw new Error("Assessment not found.");

    const { data: student } = await context.supabase
      .from("oral_assessment_students" as never)
      .select("user_id")
      .eq("id", sess.student_id)
      .maybeSingle();
    const studentUserId = (student as { user_id: string | null } | null)?.user_id ?? null;
    if (a.owner_id !== context.userId && studentUserId !== context.userId) {
      throw new Error("Forbidden");
    }

    if (sess.status !== "briefing" && sess.status !== "in_progress") {
      throw new Error("Session cannot begin questions in its current state.");
    }

    // Already has an examiner turn — return it (never ask a second "first" question).
    const { data: existingExaminer } = await context.supabase
      .from("oral_assessment_transcript_turns" as never)
      .select("turn_index, content, question_code")
      .eq("session_id", sess.id)
      .eq("role", "examiner")
      .order("turn_index", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingExaminer) {
      if (sess.status === "briefing") {
        await context.supabase
          .from("oral_assessment_sessions" as never)
          .update({
            status: "in_progress",
            started_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as never)
          .eq("id", sess.id);
      }
      const ex = existingExaminer as {
        turn_index: number;
        content: string;
        question_code: string | null;
      };
      return {
        sessionId: sess.id,
        examinerTurn: {
          turnIndex: ex.turn_index,
          content: ex.content,
          questionCode: ex.question_code ?? "",
        },
      };
    }

    const blueprintRow = await loadBlueprintForInterview(a.id);
    const fullBlueprint = InterviewBlueprintSchema.parse(blueprintRow?.blueprint ?? {});
    const followUpBank = blueprintRow?.adaptive_strategy?.followUpBank ?? {};
    const mode = parseQuestionAssignmentMode(
      blueprintRow?.adaptive_strategy?.questionAssignmentMode,
    );

    let assignedCodes = await ensureSessionAssignment({
      supabase: context.supabase,
      sessionId: sess.id,
      outcomeCodes: fullBlueprint.outcomes.map((o) => o.code),
      mode,
      expectedDurationMinutes: a.expected_duration_minutes,
    });
    // Drop stale codes that no longer exist on the bank.
    const validAssigned = assignedCodes.filter((c) =>
      fullBlueprint.outcomes.some((o) => o.code === c),
    );
    if (validAssigned.length !== assignedCodes.length) {
      assignedCodes =
        validAssigned.length > 0
          ? validAssigned
          : assignOutcomeCodesForSession({
              outcomeCodes: fullBlueprint.outcomes.map((o) => o.code),
              mode,
              expectedDurationMinutes: a.expected_duration_minutes,
            });
      await persistAssignedOutcomeCodes(context.supabase, sess.id, assignedCodes, mode);
    }
    const blueprint = filterBlueprintForSession(fullBlueprint, assignedCodes);

    const pathway = Array.isArray(sess.question_pathway) ? [...sess.question_pathway] : [];
    const examiner = nextExaminerTurn({ blueprint, pathway, followUpBank });
    if (!examiner) throw new Error("No interview questions available.");

    const { data: lastTurn } = await context.supabase
      .from("oral_assessment_transcript_turns" as never)
      .select("turn_index")
      .eq("session_id", sess.id)
      .order("turn_index", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextIndex = ((lastTurn as { turn_index: number } | null)?.turn_index ?? -1) + 1;

    pathway.push(examiner.learningOutcomeCode);
    await context.supabase.from("oral_assessment_transcript_turns" as never).insert({
      session_id: sess.id,
      turn_index: nextIndex,
      role: "examiner",
      content: examiner.content,
      question_code: examiner.questionCode,
      learning_outcome_code: examiner.learningOutcomeCode,
      bloom_level: examiner.bloomLevel,
      response_format: "speech",
      metadata: { isFollowUp: examiner.isFollowUp },
    } as never);

    await context.supabase
      .from("oral_assessment_sessions" as never)
      .update({
        status: "in_progress",
        started_at: new Date().toISOString(),
        question_pathway: pathway,
        interview_engine_version: INTERVIEW_ENGINE_VERSION,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", sess.id);

    await writeAudit(context, {
      workspace_id: a.workspace_id,
      assessment_id: a.id,
      session_id: sess.id,
      event_type: "session.questions_begun",
    });

    return {
      sessionId: sess.id,
      examinerTurn: {
        turnIndex: nextIndex,
        content: examiner.content,
        questionCode: examiner.questionCode,
      },
    };
  });

/**
 * Append student spoken/text turn, then next adaptive examiner question (or complete).
 */
export const submitInterviewReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => StudentReplyInput.parse(raw))
  .handler(async ({ context, data }) => {
    const { data: session } = await context.supabase
      .from("oral_assessment_sessions" as never)
      .select("*")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (!session) throw new Error("Session not found.");
    const sess = session as {
      id: string;
      assessment_id: string;
      student_id: string;
      status: string;
      question_pathway: string[];
    };

    const a = await loadAssessmentAdmin(sess.assessment_id);
    if (!a) throw new Error("Assessment not found.");

    const { data: student } = await context.supabase
      .from("oral_assessment_students" as never)
      .select("user_id")
      .eq("id", sess.student_id)
      .maybeSingle();
    const studentUserId = (student as { user_id: string | null } | null)?.user_id ?? null;
    if (a.owner_id !== context.userId && studentUserId !== context.userId) {
      throw new Error("Forbidden");
    }

    if (["completed", "abandoned", "failed"].includes(sess.status)) {
      throw new Error("Session is already closed.");
    }

    const { data: lastTurn } = await context.supabase
      .from("oral_assessment_transcript_turns" as never)
      .select("turn_index")
      .eq("session_id", sess.id)
      .order("turn_index", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextIndex = ((lastTurn as { turn_index: number } | null)?.turn_index ?? -1) + 1;

    const responseFormat = data.responseFormat ?? "speech";

    await context.supabase.from("oral_assessment_transcript_turns" as never).insert({
      session_id: sess.id,
      turn_index: nextIndex,
      role: "student",
      content: data.content,
      response_format: responseFormat,
    } as never);

    if (sess.status === "briefing") {
      await context.supabase
        .from("oral_assessment_sessions" as never)
        .update({
          status: "in_progress",
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", sess.id);
    }

    const { data: priorStudentTurns } = await context.supabase
      .from("oral_assessment_transcript_turns" as never)
      .select("content, question_code")
      .eq("session_id", sess.id)
      .eq("role", "student")
      .order("turn_index");

    const priorAnswers = (
      (priorStudentTurns ?? []) as Array<{ content: string; question_code: string | null }>
    ).map((t) => t.content);

    const { data: examinerMeta } = await context.supabase
      .from("oral_assessment_transcript_turns" as never)
      .select("learning_outcome_code, question_code, metadata, content")
      .eq("session_id", sess.id)
      .eq("role", "examiner")
      .order("turn_index");

    const examinerRows = (examinerMeta ?? []) as Array<{
      learning_outcome_code: string | null;
      question_code: string | null;
      metadata: { isFollowUp?: boolean } | null;
      content: string;
    }>;

    const followUpsAsked = examinerRows
      .filter(
        (t) =>
          t.metadata?.isFollowUp ||
          (t.question_code?.includes("-FU") ?? false),
      )
      .map((t) => t.learning_outcome_code)
      .filter((c): c is string => !!c);

    const { data: allTurns } = await context.supabase
      .from("oral_assessment_transcript_turns" as never)
      .select("role, content")
      .eq("session_id", sess.id)
      .order("turn_index");

    const transcript = ((allTurns ?? []) as Array<{ role: string; content: string }>).filter(
      (t) => t.role === "examiner" || t.role === "student",
    );

    const blueprintRow = await loadBlueprintForInterview(a.id);
    const fullBlueprint = InterviewBlueprintSchema.parse(blueprintRow?.blueprint ?? {});
    const followUpBank = blueprintRow?.adaptive_strategy?.followUpBank ?? {};
    const mode = parseQuestionAssignmentMode(
      blueprintRow?.adaptive_strategy?.questionAssignmentMode,
    );
    const assignedCodes = await ensureSessionAssignment({
      supabase: context.supabase,
      sessionId: sess.id,
      outcomeCodes: fullBlueprint.outcomes.map((o) => o.code),
      mode,
      expectedDurationMinutes: a.expected_duration_minutes,
    });
    const blueprint = filterBlueprintForSession(fullBlueprint, assignedCodes);

    const pathway = Array.isArray(sess.question_pathway) ? [...sess.question_pathway] : [];

    const adaptive = await adaptExaminerTurn({
      title: a.title,
      blueprint,
      pathway,
      lastStudentAnswer: data.content,
      priorAnswers,
      followUpsAsked,
      followUpBank,
      transcript,
      memorandumText: a.memorandum_text,
      userId: context.userId,
      examinerQuestionCount: examinerRows.length,
      maxExaminerQuestions: Math.max(6, blueprint.outcomes.length * 2),
    });

    if (adaptive.done) {
      const extraGaps: string[] = [];
      if (adaptive.knowledgeGap && adaptive.gapOutcomeCode) {
        extraGaps.push(adaptive.gapOutcomeCode);
      } else if (answerLooksLikeDontKnow(data.content) && pathway.length) {
        extraGaps.push(pathway[pathway.length - 1]!);
      }
      await completeSessionWithScoring(context, {
        sessionId: sess.id,
        assessmentId: a.id,
        workspaceId: a.workspace_id,
        title: a.title,
        extraKnowledgeGapTopics: extraGaps,
      });
      return { done: true as const, sessionId: sess.id };
    }

    const examiner = adaptive.turn;
    // Knowledge gaps never get follow-up probes — move on and mark the prior topic.
    const isFollowUp = examiner.knowledgeGap ? false : examiner.isFollowUp;
    const gapOutcomeCode = examiner.knowledgeGap
      ? pathway[pathway.length - 1] ?? examiner.learningOutcomeCode
      : undefined;

    if (!isFollowUp && !pathway.includes(examiner.learningOutcomeCode)) {
      pathway.push(examiner.learningOutcomeCode);
    }

    const examinerIndex = nextIndex + 1;
    await context.supabase.from("oral_assessment_transcript_turns" as never).insert({
      session_id: sess.id,
      turn_index: examinerIndex,
      role: "examiner",
      content: examiner.content,
      question_code: examiner.questionCode,
      learning_outcome_code: examiner.learningOutcomeCode,
      bloom_level: examiner.bloomLevel,
      response_format: "speech",
      metadata: {
        isFollowUp,
        model: adaptive.model,
        knowledgeGap: examiner.knowledgeGap ?? false,
        gapOutcomeCode,
      },
    } as never);

    await context.supabase
      .from("oral_assessment_sessions" as never)
      .update({
        question_pathway: pathway,
        interview_engine_version: INTERVIEW_ENGINE_VERSION,
        ai_model_version: adaptive.model,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", sess.id);

    return {
      done: false as const,
      sessionId: sess.id,
      examinerTurn: {
        turnIndex: examinerIndex,
        content: examiner.content,
        questionCode: examiner.questionCode,
      },
    };
  });

type AuthCtx = {
  claims: unknown;
  userId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
};

async function completeSessionWithScoring(
  context: AuthCtx,
  opts: {
    sessionId: string;
    assessmentId: string;
    workspaceId: string;
    title: string;
    /** When false, refresh AI score/report without flipping session status (rescore). */
    markComplete?: boolean;
    /** Gaps detected on the final answer when no next examiner turn was written. */
    extraKnowledgeGapTopics?: string[];
  },
) {
  const markComplete = opts.markComplete !== false;

  const { data: turns } = await context.supabase
    .from("oral_assessment_transcript_turns" as never)
    .select("turn_index, role, content, question_code, learning_outcome_code, metadata")
    .eq("session_id", opts.sessionId)
    .order("turn_index");

  const turnList = (turns ?? []) as Array<{
    turn_index: number;
    role: string;
    content: string;
    question_code: string | null;
    learning_outcome_code: string | null;
    metadata: { knowledgeGap?: boolean; gapOutcomeCode?: string } | null;
  }>;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: files } = await supabaseAdmin
    .from("oral_assessment_files" as never)
    .select("extracted_text")
    .eq("assessment_id", opts.assessmentId)
    .eq("role", "source")
    .limit(5);
  const excerpt = ((files ?? []) as Array<{ extracted_text: string }>)
    .map((f) => f.extracted_text)
    .join("\n")
    .slice(0, 5000);

  const { data: assessmentRow } = await supabaseAdmin
    .from("oral_assessment_assessments" as never)
    .select("memorandum_text")
    .eq("id", opts.assessmentId)
    .maybeSingle();
  const memorandumText =
    ((assessmentRow as { memorandum_text?: string } | null)?.memorandum_text ?? "").trim();

  const { data: rubricHeader } = await supabaseAdmin
    .from("oral_assessment_rubrics" as never)
    .select("id")
    .eq("assessment_id", opts.assessmentId)
    .maybeSingle();
  let rubricCriteria: Array<{
    code: string;
    label: string;
    description: string;
    weight: number;
    max_score: number;
    sort_order: number;
  }> = [];
  const rubricId = (rubricHeader as { id: string } | null)?.id;
  if (rubricId) {
    const { data: crit } = await supabaseAdmin
      .from("oral_assessment_rubric_criteria" as never)
      .select("code, label, description, weight, max_score, sort_order")
      .eq("rubric_id", rubricId)
      .order("sort_order");
    rubricCriteria = (crit ?? []) as typeof rubricCriteria;
  }

  const { data: gapTurns } = await supabaseAdmin
    .from("oral_assessment_transcript_turns" as never)
    .select("metadata, learning_outcome_code")
    .eq("session_id", opts.sessionId)
    .eq("role", "examiner");
  const knowledgeGapTopics: string[] = [
    ...new Set(
      ((gapTurns ?? []) as Array<{
        metadata: { knowledgeGap?: boolean; gapOutcomeCode?: string } | null;
        learning_outcome_code: string | null;
      }>)
        .filter((t) => t.metadata?.knowledgeGap)
        .map((t) => t.metadata?.gapOutcomeCode || t.learning_outcome_code || "unknown")
        .filter(Boolean),
    ),
  ];

  // Also catch "I don't know" answers when the viva ended on that topic (no next-question turn).
  let lastExaminerCode: string | null = null;
  for (const t of turnList) {
    if (t.role === "examiner" && t.learning_outcome_code) {
      lastExaminerCode = t.learning_outcome_code;
    } else if (t.role === "student" && answerLooksLikeDontKnow(t.content) && lastExaminerCode) {
      if (!knowledgeGapTopics.includes(lastExaminerCode)) {
        knowledgeGapTopics.push(lastExaminerCode);
      }
    }
  }

  for (const code of opts.extraKnowledgeGapTopics ?? []) {
    if (code && !knowledgeGapTopics.includes(code)) knowledgeGapTopics.push(code);
  }

  const blueprintRow = await loadBlueprintForInterview(opts.assessmentId);
  const fullOutcomes = (
    ((blueprintRow?.blueprint as
      | { outcomes?: Array<{ label?: string; code?: string; primaryQuestion?: string }> }
      | undefined)?.outcomes ?? []) as Array<{
      label?: string;
      code?: string;
      primaryQuestion?: string;
    }>
  );
  const assignedCodes = await loadAssignedOutcomeCodes(supabaseAdmin, opts.sessionId);
  const sessionOutcomes = resolveSessionOutcomes(fullOutcomes, assignedCodes);

  const { data: sessPathwayRow } = await supabaseAdmin
    .from("oral_assessment_sessions" as never)
    .select("question_pathway")
    .eq("id", opts.sessionId)
    .maybeSingle();
  const pathwayCodes = (
    ((sessPathwayRow as { question_pathway?: string[] } | null)?.question_pathway ??
      []) as string[]
  ).filter(Boolean);
  const examinerCodes = turnList
    .filter((t) => t.role === "examiner" && t.learning_outcome_code)
    .map((t) => t.learning_outcome_code as string);

  // Only mark questions that were actually asked — unused bank items must not average as 0.
  const outcomes = outcomesAskedInSession(sessionOutcomes, pathwayCodes, examinerCodes);
  const topics = outcomes.map((o) => o.label || o.code).filter((t): t is string => !!t);
  const questions = outcomes
    .filter((o): o is { code: string; label?: string; primaryQuestion?: string } => !!o.code)
    .map((o) => ({
      code: o.code,
      label: o.label || o.code,
      primaryQuestion: o.primaryQuestion,
    }));

  const gapLabels = knowledgeGapTopics.map((code) => {
    return fullOutcomes.find((o) => o.code === code)?.label ?? code;
  });

  const { result, model, integrityFlag } = await scoreSession({
    title: opts.title,
    transcriptTurns: turnList.map((t) => ({
      role: t.role,
      content: t.content,
      questionCode: t.question_code,
      learningOutcomeCode: t.learning_outcome_code,
    })),
    submittedWorkExcerpt: excerpt,
    topics,
    questions,
    memorandumText: memorandumText || undefined,
    rubricCriteria,
    knowledgeGapTopics: gapLabels,
    userId: context.userId,
  });

  // Persist per-question marks inside dimension_scores jsonb (no migration required).
  const dimensionScoresPayload = {
    ...result.dimensionScores,
    _questionScores: result.questionScores,
  };

  // Scores/reports/flags: student JWT cannot INSERT (RLS owner-only WITH CHECK). Use admin.
  const { error: scoreErr } = await supabaseAdmin.from("oral_assessment_scores" as never).upsert(
    {
      session_id: opts.sessionId,
      recommended_mark: result.recommendedMark,
      confidence_score: result.confidenceScore,
      rubric_breakdown: result.rubricBreakdown,
      dimension_scores: dimensionScoresPayload,
      strengths: result.strengths,
      weaknesses: result.weaknesses,
      suggested_lecturer_feedback: result.suggestedLecturerFeedback,
      suggested_final_comment: result.suggestedFinalComment,
      evidence_summary: result.evidenceSummary,
      scoring_engine_version: SCORING_ENGINE_VERSION,
      scoring_model_version: model,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "session_id" },
  );
  if (scoreErr) throw new Error(`Could not save score: ${scoreErr.message}`);

  if (integrityFlag) {
    const { data: existingFlag } = await supabaseAdmin
      .from("oral_assessment_integrity_flags" as never)
      .select("id")
      .eq("session_id", opts.sessionId)
      .eq("flag_type", integrityFlag.flagType)
      .eq("status", "open")
      .maybeSingle();
    if (!existingFlag) {
      await supabaseAdmin.from("oral_assessment_integrity_flags" as never).insert({
        session_id: opts.sessionId,
        flag_type: integrityFlag.flagType,
        severity: integrityFlag.severity,
        summary: integrityFlag.summary,
        evidence: integrityFlag.evidence ?? {},
        status: "open",
      } as never);
    }
  }

  const { data: sessRow } = await supabaseAdmin
    .from("oral_assessment_sessions" as never)
    .select("question_pathway")
    .eq("id", opts.sessionId)
    .single();
  const pathway = ((sessRow as { question_pathway: string[] } | null)?.question_pathway ??
    []) as string[];

  const { data: flags } = await supabaseAdmin
    .from("oral_assessment_integrity_flags" as never)
    .select("flag_type, severity, summary")
    .eq("session_id", opts.sessionId);

  const report = buildSessionReport({
    transcript: turnList.map((t) => ({
      turnIndex: t.turn_index,
      role: t.role as "system" | "examiner" | "student",
      content: t.content,
      questionCode: t.question_code,
    })),
    questionPathway: pathway,
    recommendedMark: result.recommendedMark,
    confidenceScore: result.confidenceScore,
    strengths: result.strengths,
    weaknesses: result.weaknesses,
    suggestedLecturerFeedback: result.suggestedLecturerFeedback,
    suggestedFinalComment: result.suggestedFinalComment,
    evidenceSummary: result.evidenceSummary,
    questionScores: result.questionScores,
    integrityFlags: ((flags ?? []) as Array<{ flag_type: string; severity: string; summary: string }>).map(
      (f) => ({
        flagType: f.flag_type,
        severity: f.severity,
        summary: f.summary,
      }),
    ),
    aiModelVersion: model,
  });

  const { error: reportErr } = await supabaseAdmin.from("oral_assessment_reports" as never).upsert(
    {
      session_id: opts.sessionId,
      assessment_id: opts.assessmentId,
      report,
      ai_model_version: model,
      engine_versions: {
        scoring: SCORING_ENGINE_VERSION,
        reporting: REPORTING_ENGINE_VERSION,
        interview: INTERVIEW_ENGINE_VERSION,
      },
      generated_at: new Date().toISOString(),
    } as never,
    { onConflict: "session_id" },
  );
  if (reportErr) throw new Error(`Could not save report: ${reportErr.message}`);

  if (markComplete) {
    await supabaseAdmin
      .from("oral_assessment_sessions" as never)
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", opts.sessionId);

    await writeAudit(context, {
      workspace_id: opts.workspaceId,
      assessment_id: opts.assessmentId,
      session_id: opts.sessionId,
      event_type: "session.completed",
      payload: { recommendedMark: result.recommendedMark },
    });
  } else {
    await writeAudit(context, {
      workspace_id: opts.workspaceId,
      assessment_id: opts.assessmentId,
      session_id: opts.sessionId,
      event_type: "session.rescored",
      payload: { recommendedMark: result.recommendedMark, model },
    });
  }

  return { recommendedMark: result.recommendedMark, model };
}

const FinalMarkInput = z.object({
  sessionId: z.string().uuid(),
  finalMark: z.number().min(0).max(100),
  finalComment: z.string().max(10_000).optional(),
});

export const awardFinalMark = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => FinalMarkInput.parse(raw))
  .handler(async ({ context, data }) => {
    requireOralAccess(context);

    const { data: session } = await context.supabase
      .from("oral_assessment_sessions" as never)
      .select("id, assessment_id")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (!session) throw new Error("Session not found.");
    const sess = session as { id: string; assessment_id: string };

    const { data: assessment } = await context.supabase
      .from("oral_assessment_assessments" as never)
      .select("id, owner_id, workspace_id")
      .eq("id", sess.assessment_id)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (!assessment) throw new Error("Forbidden");
    const a = assessment as { id: string; owner_id: string; workspace_id: string };

    const now = new Date().toISOString();
    const { error } = await context.supabase
      .from("oral_assessment_scores" as never)
      .update({
        final_mark: data.finalMark,
        final_comment: data.finalComment ?? "",
        lecturer_edited: true,
        marked_by: context.userId,
        marked_at: now,
        updated_at: now,
      } as never)
      .eq("session_id", data.sessionId);

    if (error) throw new Error("Could not save final mark.");

    await writeAudit(context, {
      workspace_id: a.workspace_id,
      assessment_id: a.id,
      session_id: sess.id,
      event_type: "score.final_awarded",
      payload: { finalMark: data.finalMark },
    });

    return { sessionId: sess.id, finalMark: data.finalMark };
  });

/** Re-run AI scoring + report for a completed (or failed) session. Preserves lecturer final mark. */
export const rescoreSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SessionIdInput.parse(raw))
  .handler(async ({ context, data }) => {
    requireOralAccess(context);

    const { data: session } = await context.supabase
      .from("oral_assessment_sessions" as never)
      .select("id, assessment_id, status")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (!session) throw new Error("Session not found.");
    const sess = session as { id: string; assessment_id: string; status: string };

    if (!["completed", "failed", "abandoned"].includes(sess.status)) {
      throw new Error("Only completed sessions can be rescored. Finish the viva first.");
    }

    const { data: assessment } = await context.supabase
      .from("oral_assessment_assessments" as never)
      .select("id, title, owner_id, workspace_id")
      .eq("id", sess.assessment_id)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (!assessment) throw new Error("Forbidden");
    const a = assessment as {
      id: string;
      title: string;
      owner_id: string;
      workspace_id: string;
    };

    const scored = await completeSessionWithScoring(context, {
      sessionId: sess.id,
      assessmentId: a.id,
      workspaceId: a.workspace_id,
      title: a.title,
      markComplete: false,
    });

    return {
      sessionId: sess.id,
      recommendedMark: scored.recommendedMark,
      model: scored.model,
    };
  });

const SessionLifecycleInput = z.object({
  sessionId: z.string().uuid(),
  status: z.enum(["paused", "in_progress", "abandoned"]),
});

/** Persist pause / resume / abandon so students can leave and continue later. */
export const updateInterviewSessionLifecycle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SessionLifecycleInput.parse(raw))
  .handler(async ({ context, data }) => {
    const { data: session } = await context.supabase
      .from("oral_assessment_sessions" as never)
      .select("id, assessment_id, student_id, status")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (!session) throw new Error("Session not found.");
    const sess = session as {
      id: string;
      assessment_id: string;
      student_id: string;
      status: string;
    };

    if (["completed", "failed"].includes(sess.status)) {
      throw new Error("This session is already closed.");
    }
    if (sess.status === "abandoned" && data.status !== "abandoned") {
      throw new Error("Abandoned sessions cannot be resumed. Ask your lecturer for a new invite.");
    }

    const a = await loadAssessmentAdmin(sess.assessment_id);
    if (!a) throw new Error("Assessment not found.");

    const { data: student } = await context.supabase
      .from("oral_assessment_students" as never)
      .select("user_id")
      .eq("id", sess.student_id)
      .maybeSingle();
    const studentUserId = (student as { user_id: string | null } | null)?.user_id ?? null;
    if (a.owner_id !== context.userId && studentUserId !== context.userId) {
      throw new Error("Forbidden");
    }

    if (data.status === "in_progress" && !["paused", "briefing", "in_progress"].includes(sess.status)) {
      throw new Error("Session cannot be resumed from its current state.");
    }
    if (data.status === "paused" && ["abandoned"].includes(sess.status)) {
      throw new Error("Session cannot be paused.");
    }

    const patch: Record<string, unknown> = {
      status: data.status,
      updated_at: new Date().toISOString(),
    };
    if (data.status === "in_progress" && sess.status === "briefing") {
      patch.started_at = new Date().toISOString();
    }

    const { error } = await context.supabase
      .from("oral_assessment_sessions" as never)
      .update(patch as never)
      .eq("id", sess.id);
    if (error) throw new Error("Could not update session.");

    if (data.status === "abandoned") {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: openFlags } = await supabaseAdmin
        .from("oral_assessment_integrity_flags" as never)
        .select("id, evidence")
        .eq("session_id", sess.id)
        .eq("flag_type", "other")
        .eq("status", "open");
      const already = ((openFlags ?? []) as Array<{ evidence: { kind?: string } | null }>).some(
        (f) => f.evidence?.kind === "session_abandoned_mid_viva",
      );
      if (!already) {
        await supabaseAdmin.from("oral_assessment_integrity_flags" as never).insert({
          session_id: sess.id,
          flag_type: "other",
          severity: "review",
          summary:
            "Student ended the viva before completion. Lecturer should judge whether a fresh attempt is appropriate.",
          evidence: { kind: "session_abandoned_mid_viva", source: "student_action" },
          status: "open",
        } as never);
      }
    }

    if (data.status === "paused") {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: openFlags } = await supabaseAdmin
        .from("oral_assessment_integrity_flags" as never)
        .select("id, evidence")
        .eq("session_id", sess.id)
        .eq("flag_type", "other")
        .eq("status", "open");
      const already = ((openFlags ?? []) as Array<{ evidence: { kind?: string } | null }>).some(
        (f) => f.evidence?.kind === "viva_interrupted",
      );
      if (!already) {
        await supabaseAdmin.from("oral_assessment_integrity_flags" as never).insert({
          session_id: sess.id,
          flag_type: "other",
          severity: "info",
          summary:
            "Viva left the continuous conversation flow (tab hidden or connection issue). Review whether answers may have been assisted.",
          evidence: { kind: "viva_interrupted", source: "client_interrupt" },
          status: "open",
        } as never);
      }
    }

    await writeAudit(context, {
      workspace_id: a.workspace_id,
      assessment_id: a.id,
      session_id: sess.id,
      event_type: `session.${data.status}`,
    });

    return { sessionId: sess.id, status: data.status };
  });

export const listStudentInvitations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = (context.claims as { email?: string } | null)?.email?.toLowerCase() ?? null;

    let studentQuery = supabaseAdmin
      .from("oral_assessment_students" as never)
      .select("id, email, full_name, workspace_id, user_id");
    if (email) {
      studentQuery = studentQuery.or(`user_id.eq.${context.userId},email.eq.${email}`);
    } else {
      studentQuery = studentQuery.eq("user_id", context.userId);
    }
    const { data: students } = await studentQuery;

    const studentRows = (students ?? []) as Array<{
      id: string;
      email: string;
      full_name: string;
      workspace_id: string;
      user_id: string | null;
    }>;

    for (const row of studentRows) {
      if (!row.user_id && email && row.email.toLowerCase() === email) {
        await supabaseAdmin
          .from("oral_assessment_students" as never)
          .update({ user_id: context.userId, updated_at: new Date().toISOString() } as never)
          .eq("id", row.id)
          .is("user_id", null);
        row.user_id = context.userId;
      }
    }

    if (studentRows.length === 0) {
      return {
        invitations: [] as Array<{
          id: string;
          assessment_id: string;
          student_id: string;
          status: string;
          invite_token: string;
          created_at: string;
          assessment: { id: string; title: string; status: string } | null;
          student: {
            id: string;
            email: string;
            full_name: string;
            workspace_id: string;
          } | null;
          openSession: { id: string; status: string } | null;
        }>,
        openSessions: [] as Array<{
          id: string;
          assessment_id: string;
          status: string;
          updated_at: string;
          assessment: { id: string; title: string; status: string } | null;
        }>,
      };
    }

    const ids = studentRows.map((s) => s.id);
    const { data: invites } = await supabaseAdmin
      .from("oral_assessment_invitations" as never)
      .select("id, assessment_id, student_id, status, invite_token, created_at")
      .in("student_id", ids)
      .order("created_at", { ascending: false });

    const inviteRows = (invites ?? []) as Array<{
      id: string;
      assessment_id: string;
      student_id: string;
      status: string;
      invite_token: string;
      created_at: string;
    }>;

    const assessmentIds = [...new Set(inviteRows.map((i) => i.assessment_id))];
    let assessments: Array<{ id: string; title: string; status: string }> = [];
    if (assessmentIds.length) {
      const { data: a } = await supabaseAdmin
        .from("oral_assessment_assessments" as never)
        .select("id, title, status")
        .in("id", assessmentIds);
      assessments = (a ?? []) as Array<{ id: string; title: string; status: string }>;
    }
    const byId = new Map(assessments.map((a) => [a.id, a]));

    const { data: openSess } = await supabaseAdmin
      .from("oral_assessment_sessions" as never)
      .select("id, assessment_id, student_id, status, updated_at")
      .in("student_id", ids)
      .in("status", ["briefing", "in_progress", "paused"])
      .order("updated_at", { ascending: false });

    const openRows = (openSess ?? []) as Array<{
      id: string;
      assessment_id: string;
      student_id: string;
      status: string;
      updated_at: string;
    }>;

    const missingAssessmentIds = [
      ...new Set(openRows.map((s) => s.assessment_id).filter((id) => !byId.has(id))),
    ];
    if (missingAssessmentIds.length) {
      const { data: more } = await supabaseAdmin
        .from("oral_assessment_assessments" as never)
        .select("id, title, status")
        .in("id", missingAssessmentIds);
      for (const a of (more ?? []) as Array<{ id: string; title: string; status: string }>) {
        byId.set(a.id, a);
      }
    }

    const openByAssessmentStudent = new Map<string, { id: string; status: string }>();
    for (const s of openRows) {
      const key = `${s.assessment_id}:${s.student_id}`;
      if (!openByAssessmentStudent.has(key)) {
        openByAssessmentStudent.set(key, { id: s.id, status: s.status });
      }
    }

    return {
      invitations: inviteRows.map((inv) => ({
        ...inv,
        assessment: byId.get(inv.assessment_id) ?? null,
        student: studentRows.find((s) => s.id === inv.student_id) ?? null,
        openSession:
          openByAssessmentStudent.get(`${inv.assessment_id}:${inv.student_id}`) ?? null,
      })),
      openSessions: openRows.map((s) => ({
        id: s.id,
        assessment_id: s.assessment_id,
        status: s.status,
        updated_at: s.updated_at,
        assessment: byId.get(s.assessment_id) ?? null,
      })),
    };
  });

export const getSessionReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SessionIdInput.parse(raw))
  .handler(async ({ context, data }) => {
    const { data: session } = await context.supabase
      .from("oral_assessment_sessions" as never)
      .select("id, assessment_id, student_id, status, question_pathway, ai_model_version, completed_at, created_at")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (!session) throw new Error("Session not found.");
    const sess = session as {
      id: string;
      assessment_id: string;
      student_id: string;
      status: string;
      question_pathway: string[];
      ai_model_version: string | null;
      completed_at: string | null;
      created_at: string;
    };

    const aFull = await loadAssessmentAdmin(sess.assessment_id);
    if (!aFull) throw new Error("Assessment not found.");
    const a = { id: aFull.id, title: aFull.title, owner_id: aFull.owner_id };

    const { data: student } = await context.supabase
      .from("oral_assessment_students" as never)
      .select("id, email, full_name, user_id")
      .eq("id", sess.student_id)
      .maybeSingle();
    const s = student as { id: string; email: string; full_name: string; user_id: string | null } | null;
    if (a.owner_id !== context.userId && s?.user_id !== context.userId) {
      throw new Error("Forbidden");
    }

    const { data: reportRow } = await context.supabase
      .from("oral_assessment_reports" as never)
      .select("report, ai_model_version, engine_versions, generated_at")
      .eq("session_id", data.sessionId)
      .maybeSingle();

    const reportMeta = reportRow
      ? {
          ai_model_version: (reportRow as { ai_model_version: string | null }).ai_model_version,
          engine_versions: ((reportRow as { engine_versions: Record<string, string> }).engine_versions ??
            {}) as Record<string, string>,
          generated_at: (reportRow as { generated_at: string }).generated_at,
        }
      : null;

    const report = reportRow
      ? SessionReportSchema.parse((reportRow as { report: unknown }).report)
      : null;

    const { data: score } = await context.supabase
      .from("oral_assessment_scores" as never)
      .select(
        "recommended_mark, confidence_score, strengths, weaknesses, suggested_lecturer_feedback, suggested_final_comment, final_mark, final_comment, lecturer_edited, evidence_summary, rubric_breakdown, dimension_scores, scoring_model_version",
      )
      .eq("session_id", data.sessionId)
      .maybeSingle();

    return {
      assessment: a,
      session: sess,
      student: s,
      isLecturer: a.owner_id === context.userId,
      report,
      reportMeta,
      score: (score ?? null) as {
        recommended_mark: number | null;
        confidence_score: number | null;
        strengths: string[];
        weaknesses: string[];
        suggested_lecturer_feedback: string;
        suggested_final_comment: string;
        final_mark: number | null;
        final_comment: string;
        lecturer_edited: boolean;
        evidence_summary: string[];
        rubric_breakdown: Record<string, number>;
        dimension_scores: OralDimensionScores;
        scoring_model_version: string | null;
      } | null,
    };
  });

const InviteTokenInput = z.object({
  token: z.string().min(16).max(128),
});

/**
 * Accept an invite link: verify email match, link student.user_id, mark accepted.
 * Uses service role because invite lookup by token is not readable pre-link via RLS.
 */
export const acceptOralInviteByToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => InviteTokenInput.parse(raw))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userEmail =
      (context.claims as { email?: string } | null)?.email?.toLowerCase()?.trim() ?? null;
    if (!userEmail) throw new Error("Your account has no email address.");

    const { data: invite } = await supabaseAdmin
      .from("oral_assessment_invitations" as never)
      .select("id, assessment_id, student_id, status, invite_token, expires_at")
      .eq("invite_token", data.token)
      .maybeSingle();
    if (!invite) throw new Error("Invitation not found.");
    const inv = invite as {
      id: string;
      assessment_id: string;
      student_id: string;
      status: string;
      invite_token: string;
      expires_at: string | null;
    };

    if (inv.status === "revoked" || inv.status === "expired") {
      throw new Error("This invitation is no longer valid.");
    }
    if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
      throw new Error("This invitation has expired.");
    }

    const { data: student } = await supabaseAdmin
      .from("oral_assessment_students" as never)
      .select("id, email, full_name, user_id, workspace_id")
      .eq("id", inv.student_id)
      .maybeSingle();
    if (!student) throw new Error("Student record not found.");
    const s = student as {
      id: string;
      email: string;
      full_name: string;
      user_id: string | null;
      workspace_id: string;
    };

    if (s.email.toLowerCase() !== userEmail) {
      throw new Error(
        `Sign in with ${s.email} to accept this invitation (currently signed in as ${userEmail}).`,
      );
    }

    if (s.user_id && s.user_id !== context.userId) {
      throw new Error("This invitation is linked to a different account.");
    }

    if (!s.user_id) {
      await supabaseAdmin
        .from("oral_assessment_students" as never)
        .update({ user_id: context.userId, updated_at: new Date().toISOString() } as never)
        .eq("id", s.id);
    }

    if (inv.status === "pending") {
      await supabaseAdmin
        .from("oral_assessment_invitations" as never)
        .update({ status: "accepted", updated_at: new Date().toISOString() } as never)
        .eq("id", inv.id);
    }

    const assessment = await loadAssessmentAdmin(inv.assessment_id);
    if (!assessment) throw new Error("Assessment not found.");

    await writeAudit(context, {
      workspace_id: s.workspace_id,
      assessment_id: inv.assessment_id,
      event_type: "student.invite_accepted",
      payload: { invitationId: inv.id },
    });

    return {
      invitationId: inv.id,
      assessmentId: inv.assessment_id,
      assessmentTitle: assessment.title,
      assessmentStatus: assessment.status,
      studentName: s.full_name,
      status: inv.status === "pending" ? "accepted" : inv.status,
      canStart: ["ready", "published"].includes(assessment.status),
    };
  });

/**
 * Start (or resume) an interview session from an invite token.
 */
export const startInterviewFromInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => InviteTokenInput.parse(raw))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userEmail =
      (context.claims as { email?: string } | null)?.email?.toLowerCase()?.trim() ?? null;
    if (!userEmail) throw new Error("Your account has no email address.");

    const { data: invite } = await supabaseAdmin
      .from("oral_assessment_invitations" as never)
      .select("id, assessment_id, student_id, status, invite_token, expires_at")
      .eq("invite_token", data.token)
      .maybeSingle();
    if (!invite) throw new Error("Invitation not found.");
    const inv = invite as {
      id: string;
      assessment_id: string;
      student_id: string;
      status: string;
      expires_at: string | null;
    };

    if (inv.status === "revoked" || inv.status === "expired") {
      throw new Error("This invitation is no longer valid.");
    }
    if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
      throw new Error("This invitation has expired.");
    }

    const { data: student } = await supabaseAdmin
      .from("oral_assessment_students" as never)
      .select("id, email, full_name, user_id, workspace_id")
      .eq("id", inv.student_id)
      .maybeSingle();
    if (!student) throw new Error("Student record not found.");
    const s = student as {
      id: string;
      email: string;
      full_name: string;
      user_id: string | null;
      workspace_id: string;
    };

    if (s.email.toLowerCase() !== userEmail) {
      throw new Error(
        `Sign in with ${s.email} to start this assessment (currently signed in as ${userEmail}).`,
      );
    }
    if (s.user_id && s.user_id !== context.userId) {
      throw new Error("This invitation is linked to a different account.");
    }
    if (!s.user_id) {
      await supabaseAdmin
        .from("oral_assessment_students" as never)
        .update({ user_id: context.userId, updated_at: new Date().toISOString() } as never)
        .eq("id", s.id);
    }
    if (inv.status === "pending") {
      await supabaseAdmin
        .from("oral_assessment_invitations" as never)
        .update({ status: "accepted", updated_at: new Date().toISOString() } as never)
        .eq("id", inv.id);
    }

    const assessment = await loadAssessmentAdmin(inv.assessment_id);
    if (!assessment) throw new Error("Assessment not found.");
    if (!["ready", "published"].includes(assessment.status)) {
      throw new Error("Assessment is not available yet.");
    }

    const { data: existing } = await supabaseAdmin
      .from("oral_assessment_sessions" as never)
      .select("id, status")
      .eq("assessment_id", inv.assessment_id)
      .eq("student_id", s.id)
      .in("status", ["briefing", "in_progress", "paused"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      return { sessionId: (existing as { id: string }).id, resumed: true as const };
    }

    const { data: session, error: sessErr } = await supabaseAdmin
      .from("oral_assessment_sessions" as never)
      .insert({
        assessment_id: assessment.id,
        student_id: s.id,
        invitation_id: inv.id,
        status: "briefing",
        question_pathway: [],
        interview_engine_version: INTERVIEW_ENGINE_VERSION,
        ai_model_version: "adaptive-gemini",
      } as never)
      .select("id, status")
      .single();
    if (sessErr || !session) throw new Error("Could not create interview session.");
    const sess = session as { id: string; status: string };

    const briefing = briefingMessage({
      title: assessment.title,
      expectedDurationMinutes: assessment.expected_duration_minutes,
    });

    await supabaseAdmin.from("oral_assessment_transcript_turns" as never).insert({
      session_id: sess.id,
      turn_index: 0,
      role: "system",
      content: briefing,
      response_format: "speech",
    } as never);

    await supabaseAdmin
      .from("oral_assessment_invitations" as never)
      .update({ status: "started", updated_at: new Date().toISOString() } as never)
      .eq("id", inv.id);

    await writeAudit(context, {
      workspace_id: s.workspace_id,
      assessment_id: assessment.id,
      session_id: sess.id,
      event_type: "session.started_from_invite",
      payload: { invitationId: inv.id },
    });

    return { sessionId: sess.id, resumed: false as const };
  });

