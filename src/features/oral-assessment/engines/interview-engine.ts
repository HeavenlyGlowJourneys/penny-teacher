/**
 * Interview Engine — independently replaceable.
 * Builds viva blueprints from analysis interviewPlan and runs adaptive follow-ups.
 */
import { z } from "zod";
import type { InterviewBlueprint } from "@/features/oral-assessment/types";
import { InterviewBlueprintSchema } from "@/features/oral-assessment/types";
import type { AnalysisWithPlan } from "@/features/oral-assessment/engines/analysis-engine";
import { MAX_INTERVIEW_PLAN_ITEMS } from "@/features/oral-assessment/engines/analysis-engine";
import { callOralGeminiJson, extractJson } from "@/features/oral-assessment/engines/gemini";

export const INTERVIEW_ENGINE_VERSION = "adaptive-viva-v1";

/** How questions are assigned across students from the lecturer-approved bank. */
export type QuestionAssignmentMode = "same" | "varied";

export function parseQuestionAssignmentMode(raw: unknown): QuestionAssignmentMode {
  return raw === "varied" ? "varied" : "same";
}

function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}

/**
 * Pick which outcome codes this student will face.
 * - same: full bank in lecturer order
 * - varied: shuffled subset sized by duration (still fair coverage)
 */
export function assignOutcomeCodesForSession(opts: {
  outcomeCodes: string[];
  mode: QuestionAssignmentMode;
  expectedDurationMinutes?: number;
}): string[] {
  const codes = opts.outcomeCodes.filter(Boolean);
  if (codes.length === 0) return [];
  if (opts.mode === "same") return [...codes];

  const duration = opts.expectedDurationMinutes ?? 15;
  // Roughly one primary topic every ~2.5 minutes, capped to bank size.
  const target = Math.min(
    codes.length,
    Math.max(4, Math.round(duration / 2.5)),
  );
  const shuffled = shuffleInPlace([...codes]);
  return shuffled.slice(0, target);
}

/** Restrict blueprint outcomes to the session assignment (order preserved). */
export function filterBlueprintForSession(
  blueprint: InterviewBlueprint,
  assignedCodes: string[] | null | undefined,
): InterviewBlueprint {
  if (!assignedCodes?.length) return blueprint;
  const byCode = new Map(blueprint.outcomes.map((o) => [o.code, o]));
  const outcomes = assignedCodes
    .map((code) => byCode.get(code))
    .filter((o): o is (typeof blueprint.outcomes)[number] => !!o);
  // Stale codes (regenerate remapped LOn) — fall back to full bank rather than empty.
  if (!outcomes.length) return blueprint;
  // Partial match after edits: keep only codes that still exist.
  return { ...blueprint, outcomes };
}

/**
 * Resolve which blueprint outcomes this session should use for asking/scoring.
 * Prefer persisted assignment when it still matches the bank; otherwise full bank.
 */
export function resolveSessionOutcomes<T extends { code?: string }>(
  fullOutcomes: T[],
  assignedCodes: string[] | null | undefined,
): T[] {
  if (!assignedCodes?.length) return fullOutcomes;
  const byCode = new Map(
    fullOutcomes.filter((o): o is T & { code: string } => !!o.code).map((o) => [o.code, o]),
  );
  const resolved = assignedCodes
    .map((code) => byCode.get(code))
    .filter((o): o is T & { code: string } => !!o);
  return resolved.length ? resolved : fullOutcomes;
}

/**
 * Outcomes that were actually put to the student (examiner asked), in pathway order.
 * Used for scoring so unused bank items do not average in as zeros.
 */
export function outcomesAskedInSession<T extends { code?: string }>(
  sessionOutcomes: T[],
  pathway: string[],
  examinerCodes: string[],
): T[] {
  const askedOrder: string[] = [];
  const seen = new Set<string>();
  for (const code of [...pathway, ...examinerCodes]) {
    if (!code || seen.has(code)) continue;
    seen.add(code);
    askedOrder.push(code);
  }
  if (!askedOrder.length) return sessionOutcomes;
  const byCode = new Map(
    sessionOutcomes.filter((o): o is T & { code: string } => !!o.code).map((o) => [o.code, o]),
  );
  const asked = askedOrder
    .map((code) => byCode.get(code))
    .filter((o): o is T & { code: string } => !!o);
  return asked.length ? asked : sessionOutcomes;
}

export type BuildBlueprintInput = {
  title: string;
  analysis: AnalysisWithPlan;
};

export function buildInterviewBlueprint(input: BuildBlueprintInput): InterviewBlueprint {
  const plan = input.analysis.interviewPlan?.length
    ? input.analysis.interviewPlan
    : input.analysis.concepts.slice(0, MAX_INTERVIEW_PLAN_ITEMS).map((concept) => ({
        topic: concept,
        primaryQuestion: `Explain “${concept}” in your own words and give an example from ${input.title}.`,
        followUpIfWeak: `Give a simpler example that shows “${concept}” clearly.`,
        followUpIfStrong: `How would you teach “${concept}” to a classmate who is confused?`,
      }));

  const outcomes = plan.slice(0, MAX_INTERVIEW_PLAN_ITEMS).map((item, i) => {
    const code = `LO${i + 1}`;
    return {
      code,
      label: item.topic,
      primaryQuestion: item.primaryQuestion,
      followUpLogic: `If weak → ${item.followUpIfWeak} If strong → ${item.followUpIfStrong}`,
      evidenceRequired: [
        "Explanation in the student's own words",
        "At least one concrete example or application",
      ],
      rubricMapping: ["knowledge", "application", "reasoning"],
      // Stash follow-ups in label-adjacent fields via followUpLogic; also keep structured copies
      // on the blueprint through question_bank (written by caller).
    };
  });

  return InterviewBlueprintSchema.parse({
    outcomes,
    adaptiveNotes:
      "Branch uniquely per student. Remember prior answers. Prefer explain / compare / defend / justify / apply / teach. Never ask meta ‘how does the learning outcome show up’ questions.",
    examinerPersona: "calm, supportive academic examiner — never an interrogation",
  });
}

/** Follow-up prompts stored alongside the blueprint question bank. */
export function followUpsForPlan(analysis: AnalysisWithPlan): Record<
  string,
  { weak: string; strong: string }
> {
  const out: Record<string, { weak: string; strong: string }> = {};
  (analysis.interviewPlan ?? []).forEach((item, i) => {
    out[`LO${i + 1}`] = { weak: item.followUpIfWeak, strong: item.followUpIfStrong };
  });
  return out;
}

export type NextQuestionInput = {
  blueprint: InterviewBlueprint;
  pathway: string[];
  lastStudentAnswer?: string;
  priorAnswers?: string[];
  followUpsAsked?: string[];
  followUpBank?: Record<string, { weak: string; strong: string }>;
  /** Memo / accepted answers — used to recognise clear gaps and move on. */
  memorandumText?: string;
};

export type ExaminerTurn = {
  questionCode: string;
  learningOutcomeCode: string;
  content: string;
  bloomLevel: string;
  isFollowUp: boolean;
  /** Student showed they do not know this topic; scoring should mark knowledge down. */
  knowledgeGap?: boolean;
};

function answerLooksThin(answer: string): boolean {
  const words = answer.trim().split(/\s+/).filter(Boolean);
  return words.length < 28;
}

function answerLooksStrong(answer: string): boolean {
  const words = answer.trim().split(/\s+/).filter(Boolean);
  const hasEvidence =
    /\b(because|for example|such as|therefore|however|whereas|compared|in (the )?sentence|the word|this shows|i (would|chose|used|applied))\b/i.test(
      answer,
    );
  return words.length >= 40 && hasEvidence;
}

/** Student declines / admits they do not know — do not keep probing; move on. */
export function answerLooksLikeDontKnow(answer: string): boolean {
  const t = answer.trim().toLowerCase();
  if (!t) return true;
  if (
    /\b(i don'?t know|i do not know|don'?t know|no idea|i didn'?t study|did not study|i have no idea|not sure at all|can'?t remember|cannot remember|i forgot|no clue|skip this)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  // Whole-answer "pass" / "I'll pass" only — avoid matching "pass this idea to…"
  if (/^(i('ll| will)?\s+)?pass(\s+on(\s+this)?)?\.?$/.test(t)) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 8 && /\b(idk|nothing|nope|nah|blank)\b/i.test(t)) return true;
  return false;
}

function pickFollowUp(
  outcomeCode: string,
  outcomeLabel: string,
  answer: string,
  strong: boolean,
  bank?: Record<string, { weak: string; strong: string }>,
): string {
  const fromBank = bank?.[outcomeCode];
  const bankLine =
    fromBank &&
    (strong && !answerLooksThin(answer) ? fromBank.strong.trim() : fromBank.weak.trim());
  if (bankLine) return bankLine;
  if (!strong || answerLooksThin(answer)) {
    return `Can you give a concrete example that shows “${outcomeLabel}” clearly, and explain why it fits?`;
  }
  return `Good. How would you teach “${outcomeLabel}” to a classmate who often gets it wrong?`;
}

function nextTopicTurn(
  pathway: string[],
  blueprint: InterviewBlueprint,
  acknowledgement: string,
  knowledgeGap?: boolean,
): ExaminerTurn | null {
  const used = new Set(pathway);
  const next = blueprint.outcomes.find((o) => !used.has(o.code));
  if (!next) return null;
  return {
    questionCode: `${next.code}-Q1`,
    learningOutcomeCode: next.code,
    content: `${acknowledgement}${next.primaryQuestion}`,
    bloomLevel: "Understand/Apply",
    isFollowUp: false,
    knowledgeGap,
  };
}

export function nextExaminerTurn(input: NextQuestionInput): ExaminerTurn | null {
  const prior = input.priorAnswers ?? [];
  const followUpsAsked = new Set(input.followUpsAsked ?? []);
  const pathway = [...input.pathway];
  const lastAnswer = (input.lastStudentAnswer ?? "").trim();

  if (pathway.length > 0 && lastAnswer && answerLooksLikeDontKnow(lastAnswer)) {
    // Accept the gap, do not probe further on this topic.
    const moveOn = nextTopicTurn(
      pathway,
      input.blueprint,
      "That's okay — we'll note that and move on. ",
      true,
    );
    if (moveOn) return moveOn;
    return null;
  }

  if (pathway.length > 0 && lastAnswer) {
    const lastCode = pathway[pathway.length - 1]!;
    const outcome = input.blueprint.outcomes.find((o) => o.code === lastCode);
    if (outcome && !followUpsAsked.has(lastCode) && !answerLooksLikeDontKnow(lastAnswer)) {
      const strong = answerLooksStrong(lastAnswer);
      const needsProbe = answerLooksThin(lastAnswer) || strong;
      if (needsProbe) {
        return {
          questionCode: `${outcome.code}-FU1`,
          learningOutcomeCode: outcome.code,
          content: pickFollowUp(
            outcome.code,
            outcome.label,
            lastAnswer,
            strong,
            input.followUpBank,
          ),
          bloomLevel: strong ? "Evaluate/Apply" : "Understand/Apply",
          isFollowUp: true,
        };
      }
    }
  }

  let acknowledgement = "";
  if (lastAnswer) {
    acknowledgement = answerLooksThin(lastAnswer)
      ? "Thank you. Let’s keep going. "
      : prior.length > 1
        ? "Thank you — I’m keeping what you’ve already explained in mind. "
        : "Thank you. ";
  }

  return nextTopicTurn(pathway, input.blueprint, acknowledgement);
}

const AdaptiveAiTurnSchema = z.object({
  done: z.boolean().default(false),
  content: z.string().optional().default(""),
  learningOutcomeCode: z.string().optional().default(""),
  questionCode: z.string().optional().default(""),
  bloomLevel: z.string().optional().default("Understand/Apply"),
  isFollowUp: z.boolean().default(false),
  briefAcknowledgement: z.string().optional().default(""),
  knowledgeGap: z.boolean().optional().default(false),
});

export type AdaptiveTurnResult =
  | {
      done: true;
      reason?: string;
      /** Last answer showed a knowledge gap; scoring should still mark it down. */
      knowledgeGap?: boolean;
      gapOutcomeCode?: string;
    }
  | { done: false; turn: ExaminerTurn; model: string };

const ADAPTIVE_SYSTEM = `You are Penny — a calm, supportive academic examiner running an oral viva.

You must continue a spoken interview that verifies authentic understanding of a specific assessment.

Rules:
- Sound like a real lecturer viva, not a chatbot quiz.
- Remember everything the student has already said. Do not repeat the same question.
- Prefer: explain, compare, defend, justify, analyse, apply, teach, improve.
- Use the memorandum / accepted answers (when provided) as the ground truth for correctness.
- If the student says they do not know, did not study, or gives an answer clearly wrong against the memo: set knowledgeGap=true, put a short honest acknowledgement in briefAcknowledgement (e.g. "Unfortunately that isn't correct — we'll note that and move on."), set isFollowUp=false, and ask the NEXT topic's primary question in content. Do NOT keep probing the same topic.
- If the answer is thin but they are trying, ask one gentle follow-up on the SAME topic (isFollowUp=true).
- If the answer is strong, stretch them (compare, defend, teach, new scenario).
- Stay inside the assessment topics from the blueprint. Do not invent unrelated subjects.
- Keep each question to 1–3 short spoken sentences.
- Put any short acknowledgement ONLY in briefAcknowledgement (or leave it empty).
- Put ONLY the next question in content — do not repeat the acknowledgement inside content.
- Set done=true only when you have enough evidence across the main blueprint topics (or the conversation is clearly exhausted). Prefer finishing after covering the topics rather than endless probing.
- Never accuse the student of misconduct or AI use. Be firm but kind when an answer is wrong.

Return ONLY JSON:
{
  "done": boolean,
  "briefAcknowledgement": string,
  "content": string,
  "learningOutcomeCode": string,
  "questionCode": string,
  "bloomLevel": string,
  "isFollowUp": boolean,
  "knowledgeGap": boolean
}

When done=true, content may be empty. When done=false, content must be the next question only (no duplicated thank-you).`;

export type AdaptiveExaminerInput = NextQuestionInput & {
  title: string;
  transcript: Array<{ role: string; content: string }>;
  userId?: string;
  maxExaminerQuestions?: number;
  examinerQuestionCount?: number;
};

/**
 * Gemini-powered adaptive next turn with heuristic fallback.
 */
export async function adaptExaminerTurn(
  input: AdaptiveExaminerInput,
): Promise<AdaptiveTurnResult> {
  const maxQ = input.maxExaminerQuestions ?? Math.max(6, input.blueprint.outcomes.length * 2);
  const asked = input.examinerQuestionCount ?? 0;
  if (asked >= maxQ) {
    return { done: true, reason: "question_cap" };
  }

  // Fast path: explicit "I don't know" — no AI round-trip needed.
  if (answerLooksLikeDontKnow(input.lastStudentAnswer ?? "")) {
    const fallback = nextExaminerTurn(input);
    if (!fallback) {
      return {
        done: true,
        reason: "blueprint_exhausted",
        knowledgeGap: true,
        gapOutcomeCode: input.pathway[input.pathway.length - 1],
      };
    }
    return { done: false, turn: { ...fallback, knowledgeGap: true }, model: "heuristic-idk" };
  }

  // Prefer AI when configured
  if (process.env.GEMINI_API_KEY) {
    try {
      if (input.userId) {
        const { assertAiRateLimit } = await import("@/lib/ai-rate-limit.server");
        await assertAiRateLimit(input.userId);
      }

      const topics = input.blueprint.outcomes.map((o) => ({
        code: o.code,
        topic: o.label,
        primaryQuestion: o.primaryQuestion,
        followUpLogic: o.followUpLogic,
      }));

      const memo = (input.memorandumText ?? "").trim();
      const user = [
        `Assessment title: ${input.title}`,
        `Topics / blueprint:\n${JSON.stringify(topics, null, 2)}`,
        memo
          ? `Memorandum / accepted answers (ground truth for correctness):\n${memo.slice(0, 8000)}`
          : "No memorandum provided — judge understanding from the blueprint topics.",
        `Topics already covered (pathway): ${input.pathway.join(", ") || "(none yet)"}`,
        `Follow-ups already asked for: ${(input.followUpsAsked ?? []).join(", ") || "(none)"}`,
        `Examiner questions so far: ${asked} (cap ${maxQ})`,
        `Transcript (oldest → newest):\n${input.transcript
          .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
          .join("\n\n")}`,
        `Latest student answer:\n${input.lastStudentAnswer ?? ""}`,
        `Decide the next spoken examiner move.`,
      ].join("\n\n");

      const raw = await callOralGeminiJson(ADAPTIVE_SYSTEM, user);
      const parsed = AdaptiveAiTurnSchema.parse(extractJson(raw));
      const model = process.env.GEMINI_MODEL || "gemini-flash-latest";

      if (parsed.done) {
        return { done: true, reason: "ai_complete" };
      }

      const ack = (parsed.briefAcknowledgement || "").trim();

      // Knowledge gaps: always move to the next topic (or finish) — never probe further.
      if (parsed.knowledgeGap) {
        const moveOn = nextTopicTurn(
          input.pathway,
          input.blueprint,
          ack
            ? `${ack}${/[.!?]$/.test(ack) ? " " : ". "}`
            : "Unfortunately that isn’t correct — we’ll note that and move on. ",
          true,
        );
        if (!moveOn) {
          return {
            done: true,
            reason: "knowledge_gap_complete",
            knowledgeGap: true,
            gapOutcomeCode: input.pathway[input.pathway.length - 1],
          };
        }
        return { done: false, model, turn: moveOn };
      }

      let question = (parsed.content || "").trim();
      // Guard against models repeating the acknowledgement inside content.
      if (ack && question.toLowerCase().startsWith(ack.toLowerCase())) {
        question = question.slice(ack.length).trim().replace(/^[,.\-–—]\s*/, "");
      }
      const content = [ack, question].filter(Boolean).join(" ").trim();
      if (!content) {
        throw new Error("Empty adaptive question");
      }

      const code =
        parsed.learningOutcomeCode &&
        input.blueprint.outcomes.some((o) => o.code === parsed.learningOutcomeCode)
          ? parsed.learningOutcomeCode
          : input.pathway[input.pathway.length - 1] ||
            input.blueprint.outcomes[0]?.code ||
            "LO1";

      return {
        done: false,
        model,
        turn: {
          content,
          learningOutcomeCode: code,
          questionCode: parsed.questionCode || `${code}-A${asked + 1}`,
          bloomLevel: parsed.bloomLevel || "Understand/Apply",
          isFollowUp: parsed.isFollowUp,
          knowledgeGap: false,
        },
      };
    } catch (err) {
      console.error("[oral-assessment] adaptive turn fell back", err);
    }
  }

  const fallback = nextExaminerTurn(input);
  if (!fallback) return { done: true, reason: "blueprint_exhausted" };
  return { done: false, turn: fallback, model: "heuristic" };
}

export function briefingMessage(opts: {
  title: string;
  expectedDurationMinutes: number;
}): string {
  return [
    `Welcome to your oral assessment for “${opts.title}”.`,
    "",
    "This is a spoken academic conversation. I will ask questions aloud, then listen to your answers.",
    "Purpose: to verify that you understand the work — not to catch you out.",
    `Expected duration: about ${opts.expectedDurationMinutes} minutes.`,
    "Marks: AI will recommend a mark with evidence. Your lecturer awards the final mark.",
    "Privacy: we store the transcript and assessment metadata. Continuous video is not recorded by default.",
    "",
    "Speak clearly, take your time, and use examples. When you are ready, press the Start button below.",
  ].join("\n");
}

export function spokenBriefing(opts: {
  title: string;
  expectedDurationMinutes: number;
}): string {
  return [
    `Welcome to your oral assessment for ${opts.title}.`,
    `This is a spoken viva to check that you understand the work.`,
    `It should take about ${opts.expectedDurationMinutes} minutes.`,
    `I will ask each question aloud, then listen for your spoken answer.`,
    `Take your time. Explain, justify, and use examples.`,
    `Let's begin.`,
  ].join(" ");
}
