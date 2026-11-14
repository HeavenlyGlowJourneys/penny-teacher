import { z } from "zod";

/** Assessment lifecycle (mirrors DB CHECK). */
export type OralAssessmentStatus =
  | "draft"
  | "uploading"
  | "analysing"
  | "ready"
  | "published"
  | "archived"
  | "failed";

export type OralSessionStatus =
  | "briefing"
  | "in_progress"
  | "paused"
  | "completed"
  | "abandoned"
  | "failed";

export type OralFileRole = "source" | "rubric" | "learning_outcomes" | "memorandum" | "other";

export type ScoreDimension =
  | "knowledge"
  | "application"
  | "reasoning"
  | "critical_thinking"
  | "communication"
  | "authenticity_of_understanding"
  | "consistency_with_submitted_work";

export const DEFAULT_RUBRIC_CRITERIA = [
  { code: "knowledge", label: "Knowledge", description: "Accurate recall and understanding of core concepts.", weight: 1, max_score: 100, sort_order: 0 },
  { code: "application", label: "Application", description: "Ability to apply concepts to new or practical contexts.", weight: 1, max_score: 100, sort_order: 1 },
  { code: "reasoning", label: "Reasoning", description: "Logical justification and coherent argument.", weight: 1, max_score: 100, sort_order: 2 },
  { code: "critical_thinking", label: "Critical thinking", description: "Evaluation, comparison, and reflective judgement.", weight: 1, max_score: 100, sort_order: 3 },
  { code: "communication", label: "Communication", description: "Clarity and structure of oral explanation.", weight: 1, max_score: 100, sort_order: 4 },
] as const;

export type RubricCriterionDraft = {
  code: string;
  label: string;
  description: string;
  weight: number;
  max_score: number;
  sort_order: number;
};

/** Ready-made rubrics lecturers can apply, then edit. */
export const RUBRIC_TEMPLATES: Record<
  string,
  { id: string; name: string; blurb: string; criteria: RubricCriterionDraft[] }
> = {
  balanced: {
    id: "balanced",
    name: "Balanced oral viva",
    blurb: "Even weight on knowledge, application, reasoning, critical thinking, and communication.",
    criteria: DEFAULT_RUBRIC_CRITERIA.map((c) => ({ ...c })),
  },
  knowledge: {
    id: "knowledge",
    name: "Answers / knowledge focused",
    blurb: "Heavier on correct content and accuracy; lighter on speaking style.",
    criteria: [
      { code: "knowledge", label: "Knowledge & accuracy", description: "Correct understanding against the memo / accepted answers.", weight: 3, max_score: 100, sort_order: 0 },
      { code: "application", label: "Examples & application", description: "Can apply ideas to examples or new cases.", weight: 2, max_score: 100, sort_order: 1 },
      { code: "reasoning", label: "Reasoning", description: "Justifies answers with clear logic.", weight: 1, max_score: 100, sort_order: 2 },
      { code: "communication", label: "Clarity", description: "Answer is understandable enough to judge content.", weight: 1, max_score: 100, sort_order: 3 },
    ],
  },
  communication: {
    id: "communication",
    name: "Speaking & language focused",
    blurb: "Emphasises oral communication, vocabulary, and structure as well as understanding.",
    criteria: [
      { code: "communication", label: "Oral communication", description: "Clarity, fluency, organisation, and appropriate academic language.", weight: 3, max_score: 100, sort_order: 0 },
      { code: "knowledge", label: "Content knowledge", description: "Accuracy of ideas discussed.", weight: 2, max_score: 100, sort_order: 1 },
      { code: "reasoning", label: "Explanation quality", description: "How well ideas are explained and connected.", weight: 2, max_score: 100, sort_order: 2 },
      { code: "application", label: "Examples", description: "Use of relevant examples while speaking.", weight: 1, max_score: 100, sort_order: 3 },
    ],
  },
};

/** Analysis engine output (placeholder shape until real AI). */
export const AssessmentAnalysisSchema = z.object({
  learningOutcomes: z.array(z.string()).default([]),
  concepts: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  bloomLevels: z.array(z.string()).default([]),
  likelyMisconceptions: z.array(z.string()).default([]),
  applicationOpportunities: z.array(z.string()).default([]),
  reasoningOpportunities: z.array(z.string()).default([]),
  summary: z.string().default(""),
});
export type AssessmentAnalysis = z.infer<typeof AssessmentAnalysisSchema>;

/** Interview blueprint learning-outcome block. */
export const BlueprintOutcomeSchema = z.object({
  code: z.string(),
  label: z.string(),
  primaryQuestion: z.string(),
  followUpLogic: z.string(),
  evidenceRequired: z.array(z.string()).default([]),
  rubricMapping: z.array(z.string()).default([]),
});

export const InterviewBlueprintSchema = z.object({
  outcomes: z.array(BlueprintOutcomeSchema).default([]),
  adaptiveNotes: z.string().default(""),
  examinerPersona: z.string().default("calm, supportive academic examiner"),
});
export type InterviewBlueprint = z.infer<typeof InterviewBlueprintSchema>;

export const DimensionScoresSchema = z.object({
  knowledge: z.number().min(0).max(100).optional(),
  application: z.number().min(0).max(100).optional(),
  reasoning: z.number().min(0).max(100).optional(),
  critical_thinking: z.number().min(0).max(100).optional(),
  communication: z.number().min(0).max(100).optional(),
  authenticity_of_understanding: z.number().min(0).max(100).optional(),
  consistency_with_submitted_work: z.number().min(0).max(100).optional(),
});

export const QuestionScoreSchema = z.object({
  code: z.string(),
  label: z.string(),
  score: z.number().min(0).max(100),
  maxScore: z.number().min(1).max(100).default(100),
  answered: z.boolean().default(true),
  note: z.string().default(""),
});
export type QuestionScore = z.infer<typeof QuestionScoreSchema>;

export const ScoringResultSchema = z.object({
  recommendedMark: z.number().min(0).max(100),
  confidenceScore: z.number().min(0).max(100),
  rubricBreakdown: z.record(z.string(), z.number()).default({}),
  dimensionScores: DimensionScoresSchema.default({}),
  /** Per-question marks; unanswered / I don't know → 0. Overall mark averages these when present. */
  questionScores: z.array(QuestionScoreSchema).default([]),
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
  suggestedLecturerFeedback: z.string().default(""),
  suggestedFinalComment: z.string().default(""),
  evidenceSummary: z.array(z.string()).default([]),
});
export type ScoringResult = z.infer<typeof ScoringResultSchema>;

export const SessionReportSchema = z.object({
  transcript: z.array(
    z.object({
      turnIndex: z.number(),
      role: z.enum(["system", "examiner", "student"]),
      content: z.string(),
      questionCode: z.string().optional(),
    }),
  ).default([]),
  questionPathway: z.array(z.string()).default([]),
  rubric: z.object({
    title: z.string(),
    maxMark: z.number(),
    criteria: z.array(z.object({ code: z.string(), label: z.string(), score: z.number().optional() })),
  }).optional(),
  questionScores: z.array(QuestionScoreSchema).default([]),
  evidenceSummary: z.array(z.string()).default([]),
  recommendedMark: z.number().optional(),
  finalMark: z.number().optional(),
  confidenceScore: z.number().optional(),
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
  suggestedLecturerFeedback: z.string().optional(),
  suggestedFinalComment: z.string().optional(),
  integrityFlags: z.array(z.object({
    flagType: z.string(),
    severity: z.string(),
    summary: z.string(),
  })).default([]),
  aiModelVersion: z.string().optional(),
  engineVersions: z.record(z.string(), z.string()).default({}),
  generatedAt: z.string(),
});
export type SessionReport = z.infer<typeof SessionReportSchema>;

export type OralAssessmentListItem = {
  id: string;
  title: string;
  status: OralAssessmentStatus;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

export type OralFileManifestEntry = {
  fileName: string;
  role: OralFileRole;
  kind: string;
  byteSize: number;
  storagePath: string;
  extractedChars: number;
  warning?: string;
};

export const ACCEPTED_UPLOAD_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".doc",
  ".pptx",
  ".ppt",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".txt",
  ".md",
] as const;

export const ACCEPTED_UPLOAD_ACCEPT =
  ".pdf,.docx,.doc,.pptx,.ppt,.png,.jpg,.jpeg,.webp,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,image/*";
