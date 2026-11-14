/**
 * Assessment Analysis Engine — independently replaceable.
 * Builds content-aware analysis + viva question seeds from the uploaded assessment.
 * Lecturers never see or write prompts.
 */
import { z } from "zod";
import type { AssessmentAnalysis } from "@/features/oral-assessment/types";
import { AssessmentAnalysisSchema } from "@/features/oral-assessment/types";
import { callOralGeminiJson, extractJson } from "@/features/oral-assessment/engines/gemini";

export const ANALYSIS_ENGINE_VERSION = "gemini-viva-v1";

export type AnalyseAssessmentInput = {
  title: string;
  sourceText: string;
  learningOutcomesText?: string;
  memorandumText?: string;
  /** When set, enforces shared AI rate limit before Gemini. */
  userId?: string;
  /** Optional PDF/image bytes for multimodal reading when text extract is thin. */
  media?: Array<{ mimeType: string; base64: string }>;
};

export const InterviewPlanItemSchema = z.object({
  topic: z.string(),
  primaryQuestion: z.string(),
  followUpIfWeak: z.string(),
  followUpIfStrong: z.string(),
});

/** Soft ceiling — lecturer trims on review; prefer coverage over brevity. */
export const MAX_INTERVIEW_PLAN_ITEMS = 24;

export const AnalysisWithPlanSchema = AssessmentAnalysisSchema.extend({
  interviewPlan: z.array(InterviewPlanItemSchema).min(1).max(MAX_INTERVIEW_PLAN_ITEMS),
  /** Accepted answers draft when lecturer did not supply a memo. */
  generatedMemorandum: z.string().optional().default(""),
});
export type AnalysisWithPlan = z.infer<typeof AnalysisWithPlanSchema>;

const ANALYSIS_SYSTEM = `You are Penny's Oral Assessment Analysis Engine for schools and universities.

Your job: read an existing written assessment and prepare an adaptive ORAL viva that verifies authentic student understanding.

Hard rules:
- Lecturers never redesign assessments and never write AI prompts.
- Do NOT invent unrelated topics. Stay faithful to the uploaded assessment content and title.
- Questions must sound like a calm academic examiner in a real viva — not a chatbot, not a quiz of definitions only.
- Prefer: explain, compare, defend, justify, analyse, evaluate, apply, teach, improve.
- Avoid meta prompts like "how does this learning outcome show up in your work".
- Each primaryQuestion must be a complete spoken question a lecturer would ask aloud.
- interviewPlan topics should be concrete concepts from the material (e.g. "Nouns", "Verbs", "Adjectives") — never vague phrases like "core concepts".
- If the assessment is about parts of speech / grammar, cover the specific classes present (noun, verb, adjective, adverb, etc.) with application to example sentences.
- Produce as many distinct interviewPlan items as the material supports (typically 8–20, up to ${MAX_INTERVIEW_PLAN_ITEMS}). Prefer full coverage; the lecturer will remove what they do not want.

Return ONLY JSON matching:
{
  "learningOutcomes": string[],
  "concepts": string[],
  "skills": string[],
  "bloomLevels": string[],
  "likelyMisconceptions": string[],
  "applicationOpportunities": string[],
  "reasoningOpportunities": string[],
  "summary": string,
  "interviewPlan": [
    {
      "topic": string,
      "primaryQuestion": string,
      "followUpIfWeak": string,
      "followUpIfStrong": string
    }
  ]
}`;

/** Heuristic fallback when AI is unavailable or source text is thin. */
function heuristicAnalysis(input: AnalyseAssessmentInput): AnalysisWithPlan {
  const blob = `${input.title}\n${input.sourceText}\n${input.learningOutcomesText ?? ""}`.toLowerCase();
  const outcomesFromLecturer = (input.learningOutcomesText ?? "")
    .split(/\n+/)
    .map((s) => s.replace(/^[\d.\-\*]+\s*/, "").trim())
    .filter(Boolean)
    .slice(0, MAX_INTERVIEW_PLAN_ITEMS);

  const posMap: Array<{ topic: string; keys: string[] }> = [
    { topic: "Nouns", keys: ["noun", "nouns"] },
    { topic: "Verbs", keys: ["verb", "verbs"] },
    { topic: "Adjectives", keys: ["adjective", "adjectives"] },
    { topic: "Adverbs", keys: ["adverb", "adverbs"] },
    { topic: "Pronouns", keys: ["pronoun", "pronouns"] },
    { topic: "Prepositions", keys: ["preposition", "prepositions"] },
    { topic: "Conjunctions", keys: ["conjunction", "conjunctions"] },
    { topic: "Interjections", keys: ["interjection", "interjections"] },
  ];

  const isPartsOfSpeech =
    /parts?\s+of\s+speech|word class|grammar/.test(blob) ||
    posMap.filter((p) => p.keys.some((k) => blob.includes(k))).length >= 2;

  if (isPartsOfSpeech) {
    const present = posMap.filter((p) => p.keys.some((k) => blob.includes(k)));
    const topics = present.length >= 2 ? present : posMap;

    const interviewPlan = topics.map((t) => ({
      topic: t.topic,
      primaryQuestion: `Explain what a ${t.topic.slice(0, -1).toLowerCase()} is, and give two clear examples you would expect a learner to recognise.`,
      followUpIfWeak: `Take the sentence “The quick fox jumped over the lazy dog.” Which word or words are ${t.topic.toLowerCase()}, and how do you know?`,
      followUpIfStrong: `How would you help a classmate who confuses ${t.topic.toLowerCase()} with another part of speech? Give a teaching tip and an example.`,
    }));

    // Fix awkward "Nouns" -> "noun" for singular in question - already handled with slice
    const cleanedPlan = interviewPlan.map((item) => {
      const singular =
        item.topic === "Nouns"
          ? "noun"
          : item.topic === "Verbs"
            ? "verb"
            : item.topic === "Adjectives"
              ? "adjective"
              : item.topic === "Adverbs"
                ? "adverb"
                : item.topic === "Pronouns"
                  ? "pronoun"
                  : item.topic === "Prepositions"
                    ? "preposition"
                    : item.topic === "Conjunctions"
                      ? "conjunction"
                      : "interjection";
      return {
        topic: item.topic,
        primaryQuestion: `In your own words, what is a ${singular}? Give two examples and explain how you would spot one in a sentence.`,
        followUpIfWeak: `Look at this idea: “The bright students carefully wrote their answers.” Which word is a ${singular}, and what clues tell you that?`,
        followUpIfStrong: `Compare a ${singular} with one other part of speech learners often confuse it with. How would you teach the difference?`,
      };
    });

    return AnalysisWithPlanSchema.parse({
      learningOutcomes:
        outcomesFromLecturer.length > 0
          ? outcomesFromLecturer
          : topics.map((t) => `Identify, explain, and use ${t.topic.toLowerCase()} correctly`),
      concepts: topics.map((t) => t.topic),
      skills: ["Explain", "Identify", "Apply", "Compare", "Teach"],
      bloomLevels: ["Understand", "Apply", "Analyse", "Evaluate"],
      likelyMisconceptions: [
        "Confusing adjectives with adverbs",
        "Treating verbs only as ‘action words’ and missing linking verbs",
        "Calling any describing word an adjective without checking what it modifies",
      ],
      applicationOpportunities: [
        "Ask the student to classify words in an unseen sentence",
        "Ask the student to improve a weak sentence by changing word class",
      ],
      reasoningOpportunities: [
        "Ask the student to justify classification using grammatical clues",
      ],
      summary: `Oral viva on parts of speech (${topics.map((t) => t.topic).join(", ")}), focused on explanation, examples, and classroom application.`,
      interviewPlan: cleanedPlan,
    });
  }

  // Generic but concrete fallback from title + bullet-like lines
  const title = input.title.trim() || "this assessment";
  const lines = input.sourceText
    .split(/\n+/)
    .map((l) => l.replace(/^[\d.\-\*•]+\s*/, "").trim())
    .filter((l) => l.length > 8 && l.length < 120)
    .slice(0, MAX_INTERVIEW_PLAN_ITEMS);

  const concepts =
    lines.length > 0
      ? lines
      : [`Key ideas in ${title}`, `Methods used in ${title}`, `Application of ${title}`];

  const interviewPlan = concepts.map((concept, i) => ({
    topic: concept.slice(0, 80),
    primaryQuestion:
      i === 0
        ? `Explain the main idea of “${concept}” as it appears in ${title}, using your own words.`
        : `How does “${concept}” connect to what you studied in ${title}? Give a concrete example.`,
    followUpIfWeak: `Can you give a simpler example that shows “${concept}” clearly?`,
    followUpIfStrong: `If a classmate disagreed with your explanation of “${concept}”, how would you defend it?`,
  }));

  return AnalysisWithPlanSchema.parse({
    learningOutcomes:
      outcomesFromLecturer.length > 0
        ? outcomesFromLecturer
        : concepts.map((c) => `Demonstrate understanding of ${c}`),
    concepts,
    skills: ["Explain", "Apply", "Justify", "Evaluate"],
    bloomLevels: ["Understand", "Apply", "Analyse", "Evaluate"],
    likelyMisconceptions: ["Surface recall without being able to apply ideas"],
    applicationOpportunities: [`Apply ideas from ${title} to a new example`],
    reasoningOpportunities: [`Justify choices related to ${title}`],
    summary: `Oral viva prepared from “${title}”.`,
    interviewPlan,
  });
}

/**
 * Analyse assessment content and produce a viva interview plan.
 * Uses Gemini when configured; otherwise a content-aware heuristic.
 */
export async function analyseAssessment(
  input: AnalyseAssessmentInput,
): Promise<{ analysis: AnalysisWithPlan; model: string }> {
  const source = input.sourceText.slice(0, 24_000).trim();
  const hasUsefulText =
    source.length > 40 &&
    !/^\[(PDF|PRESENTATION|IMAGE|FILE) FILE:/i.test(source) &&
    source.replace(/\[.*?\]/g, "").trim().length > 40;

  // Always try Gemini when we have a key — even thin PDF stubs still have a title.
  try {
    if (input.userId) {
      const { assertAiRateLimit } = await import("@/lib/ai-rate-limit.server");
      await assertAiRateLimit(input.userId);
    }
    if (!process.env.GEMINI_API_KEY) {
      return { analysis: heuristicAnalysis(input), model: "heuristic" };
    }

    const user = [
      `Assessment title: ${input.title}`,
      input.learningOutcomesText
        ? `Lecturer learning outcomes (optional):\n${input.learningOutcomesText.slice(0, 4000)}`
        : "",
      input.memorandumText
        ? `Memorandum / mark guidance (optional):\n${input.memorandumText.slice(0, 6000)}`
        : "",
      hasUsefulText
        ? `Assessment source text:\n${source}`
        : `Source file text was limited. Infer a rigorous oral viva from the title, outcomes/memo, and any attached document/image parts. If the material is about parts of speech or grammar, build questions on those word classes.`,
      input.media?.length
        ? `${input.media.length} source file(s) are attached as document/image parts — read them carefully.`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const mediaParts = (input.media ?? [])
      .filter((m) => m.base64 && m.mimeType)
      .slice(0, 3)
      .map((m) => ({
        inlineData: { mimeType: m.mimeType, data: m.base64 },
      }));

    const raw = await callOralGeminiJson(ANALYSIS_SYSTEM, user, mediaParts);
    const parsed = AnalysisWithPlanSchema.parse(extractJson(raw));
    return { analysis: parsed, model: process.env.GEMINI_MODEL || "gemini-flash-latest" };
  } catch (err) {
    console.error("[oral-assessment] analysis fell back to heuristic", err);
    return { analysis: heuristicAnalysis(input), model: "heuristic-fallback" };
  }
}

/** Narrow view used by older callers that only need AssessmentAnalysis fields. */
export function toAssessmentAnalysis(plan: AnalysisWithPlan): AssessmentAnalysis {
  return AssessmentAnalysisSchema.parse({
    learningOutcomes: plan.learningOutcomes,
    concepts: plan.concepts,
    skills: plan.skills,
    bloomLevels: plan.bloomLevels,
    likelyMisconceptions: plan.likelyMisconceptions,
    applicationOpportunities: plan.applicationOpportunities,
    reasoningOpportunities: plan.reasoningOpportunities,
    summary: plan.summary,
  });
}

export type AnalyseQuestionBankInput = {
  title: string;
  questionsText: string;
  memorandumText?: string;
  learningOutcomesText?: string;
  /**
   * exact_questions — keep lecturer wording as primary viva questions.
   * generate_from_concept — treat input as concepts/topics; invent oral questions (lecturer approves later).
   */
  bankStyle?: "exact_questions" | "generate_from_concept";
  userId?: string;
  media?: Array<{ mimeType: string; base64: string }>;
};

const QUESTION_BANK_JSON_SHAPE = `Return ONLY JSON matching:
{
  "learningOutcomes": string[],
  "concepts": string[],
  "skills": string[],
  "bloomLevels": string[],
  "likelyMisconceptions": string[],
  "applicationOpportunities": string[],
  "reasoningOpportunities": string[],
  "summary": string,
  "generatedMemorandum": string,
  "interviewPlan": [
    {
      "topic": string,
      "primaryQuestion": string,
      "followUpIfWeak": string,
      "followUpIfStrong": string
    }
  ]
}

generatedMemorandum: when the lecturer did not supply accepted answers, write concise accepted-answer points per topic (what a correct oral answer should include). If a memo was provided, you may leave generatedMemorandum empty or briefly reinforce it.`;

const QUESTION_BANK_EXACT_SYSTEM = `You are Penny's Oral Assessment Analysis Engine.

The lecturer supplied SPECIFIC QUESTIONS they want asked, plus a MEMORANDUM (accepted answers).

Hard rules:
- Understand the SUBJECT/TOPIC of each question. Topic labels must be conceptual (e.g. "Photosynthesis", "Nouns") — NEVER "Question 1", "Q2", "Total", mark totals, or numbering.
- Ignore question numbers, section totals, marks, and page headers as content. They are formatting only.
- PRESERVE the lecturer's question wording as primaryQuestion when it can be spoken aloud. Only lightly rewrite if not speakable.
- For each real question, add weak/strong oral follow-ups that probe understanding of that concept.
- Use the memorandum as ground truth. Do not invent unrelated subjects.
- Include EVERY real question from the lecturer as its own interviewPlan item (up to ${MAX_INTERVIEW_PLAN_ITEMS}).
- If fewer than 4 conceptual topics, add complementary oral probes on the SAME subject so coverage is solid.
- Prefer explain / justify / apply / teach over definition fishing.
- Produce as many interviewPlan items as needed for full coverage (typically all lecturer questions; up to ${MAX_INTERVIEW_PLAN_ITEMS}). The lecturer will remove extras on review.

${QUESTION_BANK_JSON_SHAPE}`;

const QUESTION_BANK_GENERATE_SYSTEM = `You are Penny's Oral Assessment Analysis Engine.

The lecturer may supply CONCEPTS / TOPICS, LEARNING OUTCOMES, and/or a MEMORANDUM. Invent clear oral viva questions. They will review and approve afterwards.

Hard rules:
- Prefer learning outcomes and concept notes as the source of what must be assessed.
- If no memo is provided, invent a practical generatedMemorandum (accepted-answer guidance per topic) so the viva and scoring have ground truth.
- Expand generously: for EACH learning outcome / concept, invent one or more distinct oral questions that probe understanding, application, and justification.
- Also invent additional related outcomes/topics that naturally belong in a thorough viva on this subject (still on-topic).
- Aim for rich coverage (typically 8–20 interviewPlan items, up to ${MAX_INTERVIEW_PLAN_ITEMS}). Prefer too many over too few — the lecturer removes what they do not want.
- Topic labels must be conceptual — NEVER "Question 1", numbering, or mark totals.
- Stay inside the subject. Do not invent unrelated fields.
- Each interviewPlan item: ONE speakable primary oral question plus weak/strong follow-ups.

${QUESTION_BANK_JSON_SHAPE}`;

/** Split pasted question banks into blocks (Q1 / numbered / blank-line). */
export function splitQuestionBank(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").trim();
  if (!raw) return [];

  // Prefer Q1 / Question 1 markers
  const byQ = raw.split(/(?=^\s*(?:Q(?:uestion)?\s*)\d+[.):]\s*)/im).map((s) => s.trim()).filter(Boolean);
  if (byQ.length >= 2) return byQ.slice(0, MAX_INTERVIEW_PLAN_ITEMS);

  // Numbered list 1. / 1) / 1:
  const byNum = raw.split(/(?=^\s*\d+[.)]\s+)/m).map((s) => s.trim()).filter(Boolean);
  if (byNum.length >= 2) return byNum.slice(0, MAX_INTERVIEW_PLAN_ITEMS);

  // Blank-line separated blocks
  const byBlank = raw.split(/\n\s*\n+/).map((s) => s.trim()).filter((s) => s.length > 8);
  if (byBlank.length >= 2) return byBlank.slice(0, MAX_INTERVIEW_PLAN_ITEMS);

  // Bullet lines
  const lines = raw
    .split(/\n+/)
    .map((l) => l.replace(/^[\d.\-\*•]+\s*/, "").trim())
    .filter((l) => l.length > 12);
  if (lines.length >= 2) return lines.slice(0, MAX_INTERVIEW_PLAN_ITEMS);

  return [raw];
}

function looksLikeNumberingOnly(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  if (/^(q(uestion)?\s*)?\d+[.):]?$/.test(t)) return true;
  if (/^(total|subtotal|marks?|section\s+[a-z]|\d+\s*marks?)$/i.test(t)) return true;
  return false;
}

function topicFromQuestionBody(cleaned: string, fallback: string): string {
  const body = cleaned
    .replace(/^\s*(?:Q(?:uestion)?\s*)?\d+[.):]\s*/i, "")
    .replace(/^[\d.\-\*•]+\s*/, "")
    .trim();
  if (looksLikeNumberingOnly(body)) return fallback;
  // Prefer a short noun phrase from the start, stripping "Explain/Describe/…"
  const stripped = body
    .replace(/^(explain|describe|discuss|define|compare|analyse|analyze|evaluate|outline|identify|what is|what are|how does|how do|why)\b[:\s]*/i, "")
    .trim();
  const phrase = (stripped || body).split(/[.?\n]/)[0]?.trim() ?? fallback;
  if (looksLikeNumberingOnly(phrase) || phrase.length < 3) return fallback;
  return phrase.slice(0, 80);
}

function heuristicQuestionBank(input: AnalyseQuestionBankInput): AnalysisWithPlan {
  const style = input.bankStyle ?? "exact_questions";
  const title = input.title.trim() || "this assessment";
  const outcomesFromLecturer = (input.learningOutcomesText ?? "")
    .split(/\n+/)
    .map((s) => s.replace(/^[\d.\-\*]+\s*/, "").trim())
    .filter(Boolean)
    .slice(0, MAX_INTERVIEW_PLAN_ITEMS);

  if (style === "generate_from_concept") {
    const conceptLines = [
      ...(input.learningOutcomesText ?? "").split(/\n+/),
      ...input.questionsText.split(/\n+/),
    ]
      .map((l) => l.replace(/^[\d.\-\*•]+\s*/, "").trim())
      .filter((l) => l.length > 3 && !looksLikeNumberingOnly(l))
      .slice(0, MAX_INTERVIEW_PLAN_ITEMS);
    const memoHints = (input.memorandumText ?? "")
      .split(/\n+/)
      .map((l) => l.replace(/^[\d.\-\*•]+\s*/, "").trim())
      .filter((l) => l.length > 8 && !looksLikeNumberingOnly(l))
      .slice(0, 12);
    const seeds =
      conceptLines.length > 0
        ? conceptLines
        : memoHints.length > 0
          ? memoHints
          : [`Key ideas in ${title}`, `Application of ${title}`, `Common mistakes in ${title}`];

    const interviewPlan = seeds.slice(0, MAX_INTERVIEW_PLAN_ITEMS).map((concept) => {
      const topic = concept.slice(0, 80);
      return {
        topic,
        primaryQuestion: `In your own words, explain “${topic}” and give one clear example.`,
        followUpIfWeak: `Can you give a simpler example that shows “${topic}” clearly?`,
        followUpIfStrong: `How would you teach “${topic}” to a classmate who often gets it wrong?`,
      };
    });

    const generatedMemorandum =
      (input.memorandumText ?? "").trim() ||
      interviewPlan
        .map(
          (p) =>
            `${p.topic}: A correct answer explains what “${p.topic}” means, gives a clear example, and shows why it fits.`,
        )
        .join("\n");

    return AnalysisWithPlanSchema.parse({
      learningOutcomes:
        outcomesFromLecturer.length > 0
          ? outcomesFromLecturer
          : interviewPlan.map((p) => `Demonstrate understanding of ${p.topic}`),
      concepts: interviewPlan.map((p) => p.topic),
      skills: ["Explain", "Apply", "Justify", "Evaluate"],
      bloomLevels: ["Understand", "Apply", "Analyse", "Evaluate"],
      likelyMisconceptions: [
        "Answers that do not match the memorandum / accepted answers",
        "Surface recall without being able to justify",
      ],
      applicationOpportunities: [`Apply ideas from ${title} to a new example`],
      reasoningOpportunities: [`Justify answers against the memorandum for ${title}`],
      summary: `AI-drafted oral questions from outcomes/concepts for “${title}”. Review and approve before publishing.`,
      generatedMemorandum,
      interviewPlan,
    });
  }

  const blocks = splitQuestionBank(input.questionsText).filter(
    (b) => !looksLikeNumberingOnly(b.replace(/^\s*(?:Q(?:uestion)?\s*)?\d+[.):]\s*/i, "").trim()),
  );

  const interviewPlan = blocks.slice(0, MAX_INTERVIEW_PLAN_ITEMS).map((block, i) => {
    const cleaned = block
      .replace(/^\s*(?:Q(?:uestion)?\s*)?\d+[.):]\s*/i, "")
      .replace(/^[\d.\-\*•]+\s*/, "")
      .trim();
    const topic = topicFromQuestionBody(cleaned, `Topic ${i + 1}`);
    const primary =
      cleaned.length > 20
        ? cleaned.endsWith("?")
          ? cleaned
          : `${cleaned}${cleaned.includes("?") ? "" : "?"}`
        : `Explain your understanding of “${topic}”.`;
    return {
      topic,
      primaryQuestion: primary.slice(0, 800),
      followUpIfWeak: `Can you give a clearer example that supports your answer on “${topic.slice(0, 40)}”?`,
      followUpIfStrong: `How would you teach “${topic.slice(0, 40)}” to a classmate who often gets it wrong?`,
    };
  });

  if (interviewPlan.length > 0 && interviewPlan.length < 4) {
    interviewPlan.push({
      topic: `Applying ${title}`.slice(0, 80),
      primaryQuestion: `Give a new example that shows you can apply the ideas from ${title}, and explain why it fits.`,
      followUpIfWeak: `What is the simplest example you can think of, and what makes it correct?`,
      followUpIfStrong: `If someone challenged your example, how would you defend it using the memorandum ideas?`,
    });
  }

  const concepts = interviewPlan.map((p) => p.topic);

  return AnalysisWithPlanSchema.parse({
    learningOutcomes:
      outcomesFromLecturer.length > 0
        ? outcomesFromLecturer
        : concepts.map((c) => `Demonstrate understanding of ${c}`),
    concepts,
    skills: ["Explain", "Apply", "Justify", "Evaluate"],
    bloomLevels: ["Understand", "Apply", "Analyse", "Evaluate"],
    likelyMisconceptions: [
      "Answers that do not match the memorandum / accepted answers",
      "Surface recall without being able to justify",
    ],
    applicationOpportunities: [`Apply ideas from ${title} to a new example`],
    reasoningOpportunities: [`Justify answers against the memorandum for ${title}`],
    summary: `Oral viva built from the lecturer’s questions for “${title}”, checked against the memorandum.`,
    interviewPlan: interviewPlan.length
      ? interviewPlan
      : [
          {
            topic: title.slice(0, 80),
            primaryQuestion: `Explain the main ideas in ${title} in your own words.`,
            followUpIfWeak: `Can you give one concrete example?`,
            followUpIfStrong: `How would you teach this to a classmate?`,
          },
        ],
  });
}

/**
 * Build a viva from a lecturer-supplied question bank + memorandum.
 * exact_questions preserves wording; generate_from_concept invents oral questions from topics.
 */
export async function analyseQuestionBank(
  input: AnalyseQuestionBankInput,
): Promise<{ analysis: AnalysisWithPlan; model: string }> {
  const style = input.bankStyle ?? "exact_questions";
  const questions = input.questionsText.slice(0, 24_000).trim();
  const hasOutcomes = Boolean((input.learningOutcomesText ?? "").trim());
  const hasMemo = Boolean((input.memorandumText ?? "").trim());
  if (!questions && !hasMemo && !hasOutcomes) {
    return { analysis: heuristicQuestionBank(input), model: "heuristic" };
  }

  try {
    if (input.userId) {
      const { assertAiRateLimit } = await import("@/lib/ai-rate-limit.server");
      await assertAiRateLimit(input.userId);
    }
    if (!process.env.GEMINI_API_KEY) {
      return { analysis: heuristicQuestionBank(input), model: "heuristic" };
    }

    const system =
      style === "generate_from_concept"
        ? QUESTION_BANK_GENERATE_SYSTEM
        : QUESTION_BANK_EXACT_SYSTEM;

    const user =
      style === "generate_from_concept"
        ? [
            `Assessment title: ${input.title}`,
            input.learningOutcomesText
              ? `Learning outcomes (primary source if no question bank):\n${input.learningOutcomesText.slice(0, 4000)}`
              : "",
            questions
              ? `Concept / topic notes (optional):\n${questions}`
              : "No separate concept notes — derive topics from learning outcomes and/or memorandum.",
            input.memorandumText
              ? `Memorandum / accepted answers (ground truth):\n${input.memorandumText.slice(0, 8000)}`
              : "No memorandum provided — you MUST invent generatedMemorandum with accepted-answer guidance per topic.",
            input.media?.length
              ? `${input.media.length} file(s) attached — use for concepts/memo only.`
              : "",
            `Invent speakable oral viva questions. Lecturer will approve them on the review page.`,
          ]
            .filter(Boolean)
            .join("\n\n")
        : [
            `Assessment title: ${input.title}`,
            input.learningOutcomesText
              ? `Lecturer learning outcomes (optional):\n${input.learningOutcomesText.slice(0, 4000)}`
              : "",
            `Lecturer’s specific questions (preserve as primary; ignore Q numbers/totals as topics):\n${questions}`,
            input.memorandumText
              ? `Memorandum / accepted answers (ground truth):\n${input.memorandumText.slice(0, 8000)}`
              : "No memorandum provided — invent generatedMemorandum with accepted-answer guidance for each question/topic.",
            input.media?.length
              ? `${input.media.length} file(s) attached — use them if they contain questions or memo content.`
              : "",
            `Keep lecturer questions as primary. Topic labels must be conceptual, never numbering.`,
          ]
            .filter(Boolean)
            .join("\n\n");

    const mediaParts = (input.media ?? [])
      .filter((m) => m.base64 && m.mimeType)
      .slice(0, 3)
      .map((m) => ({
        inlineData: { mimeType: m.mimeType, data: m.base64 },
      }));

    const raw = await callOralGeminiJson(system, user, mediaParts);
    const parsed = AnalysisWithPlanSchema.parse(extractJson(raw));
    // Sanitize any numbering-as-topic slips from the model.
    const cleaned = {
      ...parsed,
      interviewPlan: parsed.interviewPlan.map((item, i) => ({
        ...item,
        topic: looksLikeNumberingOnly(item.topic)
          ? topicFromQuestionBody(item.primaryQuestion, `Topic ${i + 1}`)
          : item.topic,
      })),
      concepts: parsed.concepts
        .map((c, i) => (looksLikeNumberingOnly(c) ? parsed.interviewPlan[i]?.topic ?? c : c))
        .filter((c) => !looksLikeNumberingOnly(c)),
    };
    return {
      analysis: AnalysisWithPlanSchema.parse(cleaned),
      model: process.env.GEMINI_MODEL || "gemini-flash-latest",
    };
  } catch (err) {
    console.error("[oral-assessment] question-bank analysis fell back", err);
    return { analysis: heuristicQuestionBank(input), model: "heuristic-fallback" };
  }
}
