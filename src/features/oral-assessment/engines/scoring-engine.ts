/**
 * Scoring Engine — independently replaceable.
 * AI recommends marks with evidence; educators award the final mark.
 * Prefer per-question marks; unanswered / I don't know → 0.
 */
import { z } from "zod";
import type { QuestionScore, RubricCriterionDraft, ScoringResult } from "@/features/oral-assessment/types";
import { ScoringResultSchema } from "@/features/oral-assessment/types";
import { callOralGeminiJson, extractJson } from "@/features/oral-assessment/engines/gemini";
import { answerLooksLikeDontKnow } from "@/features/oral-assessment/engines/interview-engine";

export const SCORING_ENGINE_VERSION = "gemini-scoring-v3";

export type ScoreQuestionSpec = {
  code: string;
  label: string;
  primaryQuestion?: string;
};

export type ScoreSessionInput = {
  title: string;
  transcriptTurns: Array<{
    role: string;
    content: string;
    questionCode?: string | null;
    learningOutcomeCode?: string | null;
  }>;
  submittedWorkExcerpt?: string;
  topics?: string[];
  questions?: ScoreQuestionSpec[];
  memorandumText?: string;
  rubricCriteria?: RubricCriterionDraft[];
  knowledgeGapTopics?: string[];
  userId?: string;
};

export type IntegrityFlagResult = {
  flagType: "understanding_mismatch" | "needs_lecturer_review" | "inconsistent_responses";
  severity: "info" | "review" | "high";
  summary: string;
  evidence?: Record<string, string>;
};

const AiQuestionScoreSchema = z.object({
  code: z.string(),
  score: z.number().min(0).max(100),
  note: z.string().optional().default(""),
});

const AiScoreSchema = z.object({
  recommendedMark: z.number().min(0).max(100).optional(),
  confidenceScore: z.number().min(0).max(100),
  questionScores: z.array(AiQuestionScoreSchema).default([]),
  rubricBreakdown: z.record(z.string(), z.number().min(0).max(100)).default({}),
  dimensionScores: z
    .object({
      knowledge: z.number().min(0).max(100).optional(),
      application: z.number().min(0).max(100).optional(),
      reasoning: z.number().min(0).max(100).optional(),
      critical_thinking: z.number().min(0).max(100).optional(),
      communication: z.number().min(0).max(100).optional(),
      authenticity_of_understanding: z.number().min(0).max(100).optional(),
      consistency_with_submitted_work: z.number().min(0).max(100).optional(),
    })
    .passthrough()
    .default({}),
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
  suggestedLecturerFeedback: z.string().default(""),
  suggestedFinalComment: z.string().default(""),
  evidenceSummary: z.array(z.string()).default([]),
  integrityFlag: z
    .object({
      flagType: z.enum([
        "understanding_mismatch",
        "needs_lecturer_review",
        "inconsistent_responses",
      ]),
      severity: z.enum(["info", "review", "high"]),
      summary: z.string(),
    })
    .nullable()
    .optional(),
});

const SCORING_SYSTEM = `You are Penny's Oral Assessment Scoring Engine.

Score a completed oral viva PER QUESTION. AI recommends; the lecturer awards the final mark.

Principles:
- Score EACH listed question/topic separately (0–100).
- If the student did not answer that question, said they do not know, did not study, or gave a blank/refusal: score MUST be 0 for that question.
- When a memorandum / accepted answers is provided, treat it as ground truth.
- recommendedMark MUST equal the average of the per-question scores (equal weight unless told otherwise).
- Also fill rubricBreakdown for the lecturer's criteria (0–100).
- Cite concrete evidence. Never accuse misconduct.
- confidenceScore reflects how much viva evidence exists (short/thin → lower).

Return ONLY JSON matching the schema in the user message.`;

function defaultCriteria(): RubricCriterionDraft[] {
  return [
    { code: "knowledge", label: "Knowledge", description: "", weight: 1, max_score: 100, sort_order: 0 },
    { code: "application", label: "Application", description: "", weight: 1, max_score: 100, sort_order: 1 },
    { code: "reasoning", label: "Reasoning", description: "", weight: 1, max_score: 100, sort_order: 2 },
    { code: "critical_thinking", label: "Critical thinking", description: "", weight: 1, max_score: 100, sort_order: 3 },
    { code: "communication", label: "Communication", description: "", weight: 1, max_score: 100, sort_order: 4 },
  ];
}

function weightedAverage(breakdown: Record<string, number>, criteria: RubricCriterionDraft[]): number {
  let sum = 0;
  let w = 0;
  for (const c of criteria) {
    const score = breakdown[c.code];
    if (typeof score !== "number") continue;
    const weight = Number(c.weight);
    const wgt = Number.isFinite(weight) ? weight : 1;
    sum += score * wgt;
    w += wgt;
  }
  if (w <= 0) {
    const vals = Object.values(breakdown);
    if (!vals.length) return 50;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  return Math.round(Math.min(100, Math.max(0, sum / w)));
}

function averageQuestionScores(scores: QuestionScore[]): number {
  if (!scores.length) return 0;
  const sum = scores.reduce((n, q) => n + q.score, 0);
  return Math.round(sum / scores.length);
}

/** Pair each question with the student's answer (if any). */
export function pairAnswersToQuestions(
  questions: ScoreQuestionSpec[],
  turns: ScoreSessionInput["transcriptTurns"],
): Array<ScoreQuestionSpec & { answer: string; answered: boolean }> {
  const ordered = [...questions];
  const byCodeAnswer = new Map<string, string>();
  let pendingCode: string | null = null;

  for (const t of turns) {
    if (t.role === "examiner") {
      pendingCode =
        t.learningOutcomeCode ||
        (t.questionCode ? t.questionCode.replace(/-.*$/, "") : null) ||
        pendingCode;
    } else if (t.role === "student" && pendingCode) {
      const prev = byCodeAnswer.get(pendingCode) ?? "";
      byCodeAnswer.set(pendingCode, [prev, t.content].filter(Boolean).join("\n").trim());
    }
  }

  return ordered.map((q) => {
    const answer = (byCodeAnswer.get(q.code) ?? "").trim();
    const answered = Boolean(answer) && !answerLooksLikeDontKnow(answer);
    return { ...q, answer, answered };
  });
}

function heuristicScore(input: ScoreSessionInput): {
  result: ScoringResult;
  model: string;
  integrityFlag?: IntegrityFlagResult;
} {
  const criteria = input.rubricCriteria?.length ? input.rubricCriteria : defaultCriteria();
  const questions =
    input.questions?.length
      ? input.questions
      : (input.topics ?? []).map((label, i) => ({ code: `LO${i + 1}`, label }));
  const paired = pairAnswersToQuestions(questions, input.transcriptTurns);
  const gapSet = new Set((input.knowledgeGapTopics ?? []).map((g) => g.toLowerCase()));

  const questionScores: QuestionScore[] = paired.map((q) => {
    const gap =
      gapSet.has(q.code.toLowerCase()) ||
      gapSet.has(q.label.toLowerCase()) ||
      answerLooksLikeDontKnow(q.answer);
    if (!q.answered || gap) {
      return {
        code: q.code,
        label: q.label,
        score: 0,
        maxScore: 100,
        answered: false,
        note: gap || answerLooksLikeDontKnow(q.answer)
          ? "No credit — student did not know / did not answer."
          : "No credit — unanswered.",
      };
    }
    const words = q.answer.trim().split(/\s+/).filter(Boolean).length;
    const score = Math.min(85, 45 + Math.min(40, words));
    return {
      code: q.code,
      label: q.label,
      score,
      maxScore: 100,
      answered: true,
      note: `Heuristic estimate from answer length (${words} words).`,
    };
  });

  const recommendedMark = averageQuestionScores(questionScores);
  const answeredCount = questionScores.filter((q) => q.answered && q.score > 0).length;
  const confidence = Math.min(70, 25 + answeredCount * 10);

  const rubricBreakdown: Record<string, number> = {};
  for (const c of criteria) {
    if (c.code === "knowledge" || /knowledge|accuracy|content/i.test(c.code + c.label)) {
      rubricBreakdown[c.code] = recommendedMark;
    } else if (/communicat|speak|language|clarity/i.test(c.code + c.label)) {
      rubricBreakdown[c.code] = Math.min(100, recommendedMark + 5);
    } else {
      rubricBreakdown[c.code] = recommendedMark;
    }
  }

  const result = ScoringResultSchema.parse({
    recommendedMark,
    confidenceScore: confidence,
    rubricBreakdown,
    dimensionScores: {
      knowledge: recommendedMark,
      application: recommendedMark,
      reasoning: recommendedMark,
      critical_thinking: Math.max(0, recommendedMark - 5),
      communication: Math.min(100, recommendedMark + 5),
      authenticity_of_understanding: confidence,
      consistency_with_submitted_work: input.submittedWorkExcerpt ? 60 : 50,
    },
    questionScores,
    strengths:
      answeredCount > 0
        ? ["Attempted oral responses on one or more topics"]
        : ["Session recorded for lecturer review"],
    weaknesses: [
      ...questionScores
        .filter((q) => q.score === 0)
        .map((q) => `${q.label}: 0 (unanswered / did not know)`),
      ...(answeredCount === 0 ? ["No creditworthy answers — overall mark 0"] : []),
    ],
    suggestedLecturerFeedback:
      "Review per-question marks. Unanswered or “I don’t know” scores 0. AI recommendation is advisory.",
    suggestedFinalComment: `Oral assessment for “${input.title}” — recommended mark is the average of per-question scores.`,
    evidenceSummary: questionScores.map(
      (q) => `${q.label}: ${q.score}/${q.maxScore}${q.note ? ` — ${q.note}` : ""}`,
    ),
  });

  let integrityFlag: IntegrityFlagResult | undefined;
  if (answeredCount === 0) {
    integrityFlag = {
      flagType: "needs_lecturer_review",
      severity: "review",
      summary: "No creditworthy oral answers — all question marks are 0. Lecturer review recommended.",
    };
  } else if (input.submittedWorkExcerpt && input.submittedWorkExcerpt.length > 2000 && answeredCount < 2) {
    integrityFlag = {
      flagType: "understanding_mismatch",
      severity: "review",
      summary:
        "Submitted work appears substantially richer than oral responses. Flagged for lecturer review — not an accusation of misconduct.",
    };
  }

  return { result, model: "heuristic", integrityFlag };
}

export async function scoreSession(input: ScoreSessionInput): Promise<{
  result: ScoringResult;
  model: string;
  integrityFlag?: IntegrityFlagResult;
}> {
  if (!process.env.GEMINI_API_KEY) {
    return heuristicScore(input);
  }

  try {
    if (input.userId) {
      const { assertAiRateLimit } = await import("@/lib/ai-rate-limit.server");
      await assertAiRateLimit(input.userId);
    }

    const criteria = input.rubricCriteria?.length ? input.rubricCriteria : defaultCriteria();
    const questions =
      input.questions?.length
        ? input.questions
        : (input.topics ?? []).map((label, i) => ({ code: `LO${i + 1}`, label }));
    const paired = pairAnswersToQuestions(questions, input.transcriptTurns);

    const transcript = input.transcriptTurns
      .filter((t) => t.role === "examiner" || t.role === "student")
      .map((t) => {
        const code = t.questionCode ? ` [${t.questionCode}]` : "";
        return `${t.role.toUpperCase()}${code}: ${t.content}`;
      })
      .join("\n\n")
      .slice(0, 28_000);

    const memo = (input.memorandumText ?? "").trim();
    const gaps = input.knowledgeGapTopics ?? [];
    const rubricKeys = criteria.map((c) => `"${c.code}": number`).join(", ");
    const questionList = paired
      .map(
        (q) =>
          `- ${q.code} “${q.label}” answered=${q.answered}\n  Student answer: ${q.answer || "(none / unanswered)"}`,
      )
      .join("\n");

    const user = [
      `Assessment title: ${input.title}`,
      `Questions to mark (equal weight; unanswered or “I don’t know” → 0):\n${questionList || "(none)"}`,
      memo
        ? `Memorandum / accepted answers:\n${memo.slice(0, 8000)}`
        : "No memorandum provided.",
      gaps.length ? `Known knowledge-gap topics: ${gaps.join(", ")}` : "",
      `Rubric criteria:\n${JSON.stringify(
        criteria.map((c) => ({
          code: c.code,
          label: c.label,
          description: c.description,
          weight: c.weight,
        })),
        null,
        2,
      )}`,
      input.submittedWorkExcerpt
        ? `Submitted work excerpt:\n${input.submittedWorkExcerpt.slice(0, 6000)}`
        : "",
      `Full transcript:\n${transcript || "(empty)"}`,
      `Return JSON:
{
  "confidenceScore": number,
  "questionScores": [{ "code": string, "score": number, "note": string }],
  "recommendedMark": number,
  "rubricBreakdown": { ${rubricKeys} },
  "dimensionScores": {
    "knowledge": number,
    "application": number,
    "reasoning": number,
    "critical_thinking": number,
    "communication": number,
    "authenticity_of_understanding": number,
    "consistency_with_submitted_work": number
  },
  "strengths": string[],
  "weaknesses": string[],
  "suggestedLecturerFeedback": string,
  "suggestedFinalComment": string,
  "evidenceSummary": string[],
  "integrityFlag": null | { "flagType": "understanding_mismatch"|"needs_lecturer_review"|"inconsistent_responses", "severity": "info"|"review"|"high", "summary": string }
}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const raw = await callOralGeminiJson(SCORING_SYSTEM, user);
    const parsed = AiScoreSchema.parse(extractJson(raw));
    const byCode = new Map(parsed.questionScores.map((q) => [q.code, q]));

    const questionScores: QuestionScore[] = paired.map((q) => {
      if (!q.answered || answerLooksLikeDontKnow(q.answer)) {
        return {
          code: q.code,
          label: q.label,
          score: 0,
          maxScore: 100,
          answered: false,
          note: "No credit — unanswered or student did not know.",
        };
      }
      const ai = byCode.get(q.code);
      const score = typeof ai?.score === "number" ? Math.round(ai.score) : 50;
      return {
        code: q.code,
        label: q.label,
        score: Math.min(100, Math.max(0, score)),
        maxScore: 100,
        answered: true,
        note: ai?.note ?? "",
      };
    });

    // Force 0 for any AI slip on unanswered items.
    for (const q of questionScores) {
      const pair = paired.find((p) => p.code === q.code);
      if (pair && (!pair.answered || answerLooksLikeDontKnow(pair.answer))) {
        q.score = 0;
        q.answered = false;
      }
    }

    const recommendedMark = averageQuestionScores(questionScores);
    const rubricBreakdown: Record<string, number> = { ...parsed.rubricBreakdown };
    for (const c of criteria) {
      if (typeof rubricBreakdown[c.code] !== "number") {
        rubricBreakdown[c.code] = recommendedMark;
      }
    }

    const result = ScoringResultSchema.parse({
      recommendedMark,
      confidenceScore: parsed.confidenceScore,
      rubricBreakdown,
      dimensionScores: parsed.dimensionScores,
      questionScores,
      strengths: parsed.strengths,
      weaknesses: [
        ...parsed.weaknesses,
        ...questionScores
          .filter((q) => q.score === 0)
          .filter((q) => !parsed.weaknesses.some((w) => w.includes(q.label)))
          .map((q) => `${q.label}: 0 (unanswered / did not know)`),
      ],
      suggestedLecturerFeedback: parsed.suggestedLecturerFeedback,
      suggestedFinalComment: parsed.suggestedFinalComment,
      evidenceSummary:
        parsed.evidenceSummary.length > 0
          ? parsed.evidenceSummary
          : questionScores.map((q) => `${q.label}: ${q.score}/100`),
    });

    const integrityFlag: IntegrityFlagResult | undefined = parsed.integrityFlag
      ? {
          flagType: parsed.integrityFlag.flagType,
          severity: parsed.integrityFlag.severity,
          summary: parsed.integrityFlag.summary,
        }
      : undefined;

    return {
      result,
      model: process.env.GEMINI_MODEL || "gemini-flash-latest",
      integrityFlag,
    };
  } catch (err) {
    console.error("[oral-assessment] scoring fell back to heuristic", err);
    return heuristicScore(input);
  }
}
