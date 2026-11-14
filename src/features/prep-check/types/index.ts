import { z } from "zod";

export type PrepCheckWorkflow = "teacher_prep" | "subject_head_review";

export type PrepCheckToolId = "pack_review";

export type PrepCheckToolMeta = {
  id: PrepCheckToolId;
  title: string;
  description: string;
  available: boolean;
};

export type PrepCheckFileManifestEntry = {
  path: string;
  size: number;
  kind: string;
  extractedChars: number;
};

export const PrepCheckReportSchema = z.object({
  executiveSummary: z.string(),
  strengths: z.array(z.string()).default([]),
  areasForImprovement: z.array(z.string()).default([]),
  curriculumAlignment: z.string(),
  stageAlignment: z.string(),
  assessmentReview: z.string(),
  teachingQuality: z.string(),
  schoolPriorityAlignment: z.string(),
  resourceChecklist: z.array(z.object({ item: z.string(), present: z.boolean(), note: z.string().optional() })).default([]),
  cognitiveAnalysis: z.object({
    level1Pct: z.number(),
    level2Pct: z.number(),
    level3Pct: z.number(),
    targetLevel1Pct: z.number(),
    targetLevel2Pct: z.number(),
    targetLevel3Pct: z.number(),
    commentary: z.string(),
    recommendations: z.array(z.string()).default([]),
  }),
  overallRating: z.string(),
  confidence: z.number().min(0).max(100),
  nextSteps: z.array(z.string()).default([]),
  missingResources: z.array(z.string()).default([]),
  pacingNotes: z.string().optional(),
  aiContentBalance: z.string().optional(),
  relationshipFindings: z
    .array(
      z.object({
        comparison: z.string(),
        finding: z.string(),
        severity: z.enum(["aligned", "gap", "risk", "strength"]).default("gap"),
        evidence: z.string().optional(),
      }),
    )
    .default([]),
});

export type PrepCheckReport = z.infer<typeof PrepCheckReportSchema>;

export const DEFAULT_STAGE_SEEDS = [
  {
    code: "stage_4",
    name: "Stage 4",
    sort_order: 4,
    learner_development: "Building foundational understanding with concrete examples and repetition.",
    pacing: "Slower pacing with concept reinforcement and guided practice.",
    cognitive_ability: "Concrete reasoning; benefit from worked examples and scaffolds.",
    assessment_difficulty: "Mostly recall and routine application with some structured problems.",
    classroom_experience: "High teacher modelling; frequent checks for understanding.",
  },
  {
    code: "stage_5",
    name: "Stage 5",
    sort_order: 5,
    learner_development: "Consolidating skills; moving from concrete toward early abstraction.",
    pacing: "Balanced pacing with revision cycles.",
    cognitive_ability: "Can handle multi-step tasks with support.",
    assessment_difficulty: "Mix of routine and mildly unfamiliar contexts.",
    classroom_experience: "Guided practice with growing independence.",
  },
  {
    code: "stage_6",
    name: "Stage 6",
    sort_order: 6,
    learner_development: "Increasing independence and transfer across topics.",
    pacing: "Steady pacing with extension opportunities.",
    cognitive_ability: "Comfortable with abstract ideas when well introduced.",
    assessment_difficulty: "Include novel contexts and explanation items.",
    classroom_experience: "Collaborative investigation and discussion.",
  },
  {
    code: "stage_7",
    name: "Stage 7",
    sort_order: 7,
    learner_development: "Independent reasoning, deeper investigations, synthesis.",
    pacing: "Faster pacing with space for inquiry.",
    cognitive_ability: "Abstract thinking and evaluation expected.",
    assessment_difficulty: "Higher-order items, open responses, justification.",
    classroom_experience: "Student-led inquiry with teacher as facilitator.",
  },
] as const;

export const DEFAULT_SUBJECT_SEEDS = [
  "Mathematics",
  "Science",
  "English",
  "History",
  "Languages",
] as const;
