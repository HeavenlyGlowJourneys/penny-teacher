import { z } from "zod";

export const CANONICAL_TERMINOLOGY_KEYS = [
  "term",
  "block",
  "cycle",
  "week",
  "unit",
  "module",
  "lesson",
  "teaching_period",
] as const;

export type CanonicalTerminologyKey = (typeof CANONICAL_TERMINOLOGY_KEYS)[number];

export const DEFAULT_TERMINOLOGY: { canonical_key: CanonicalTerminologyKey; display_label: string; sort_order: number }[] =
  [
    { canonical_key: "term", display_label: "Term", sort_order: 10 },
    { canonical_key: "block", display_label: "Teaching block", sort_order: 20 },
    { canonical_key: "cycle", display_label: "Cycle", sort_order: 30 },
    { canonical_key: "week", display_label: "Week", sort_order: 40 },
    { canonical_key: "unit", display_label: "Unit", sort_order: 50 },
    { canonical_key: "module", display_label: "Module", sort_order: 60 },
    { canonical_key: "lesson", display_label: "Lesson", sort_order: 70 },
    { canonical_key: "teaching_period", display_label: "Teaching period", sort_order: 80 },
  ];

export const DOCUMENT_TYPES = [
  "annual_plan",
  "term_plan",
  "weekly_plan",
  "cycle_plan",
  "lesson_plan",
  "assessment",
  "memorandum",
  "rubric",
  "worksheet",
  "presentation",
  "resource",
  "calendar",
  "policy",
  "curriculum",
  "assessment_schedule",
  "teacher_notes",
  "other",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const CANONICAL_NODE_TYPES = [
  "school",
  "curriculum",
  "annual_plan",
  "term",
  "block",
  "cycle",
  "week",
  "unit",
  "lesson",
  "resource",
  "assessment",
  "memorandum",
  "rubric",
  "policy",
  "calendar",
  "other",
] as const;

export type CanonicalNodeType = (typeof CANONICAL_NODE_TYPES)[number];

export const EDGE_RELATIONS = [
  "contains",
  "supports",
  "assesses",
  "memo_for",
  "aligns_with",
  "precedes",
  "revises",
] as const;

export type EdgeRelation = (typeof EDGE_RELATIONS)[number];

export const CONFIDENCE_CLARIFY_THRESHOLD = 70;

export const DocumentClassificationSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES).default("other"),
  subjectLabel: z.string().nullable().optional(),
  stageLabel: z.string().nullable().optional(),
  termLabel: z.string().nullable().optional(),
  periodLabel: z.string().nullable().optional(),
  planningLevel: z.string().nullable().optional(),
  confidence: z.number().min(0).max(100),
  summary: z.string(),
  clarificationQuestion: z.string().nullable().optional(),
  concepts: z
    .array(
      z.object({
        label: z.string(),
        kind: z
          .enum(["introduced", "practised", "revised", "assessed", "mastered", "omitted", "mentioned"])
          .default("mentioned"),
      }),
    )
    .default([]),
});

export type DocumentClassification = z.infer<typeof DocumentClassificationSchema>;

export const GraphLinkProposalSchema = z.object({
  nodes: z
    .array(
      z.object({
        tempId: z.string(),
        canonicalType: z.enum(CANONICAL_NODE_TYPES),
        displayLabel: z.string(),
        parentTempId: z.string().nullable().optional(),
        subjectLabel: z.string().nullable().optional(),
        stageLabel: z.string().nullable().optional(),
      }),
    )
    .default([]),
  edges: z
    .array(
      z.object({
        fromTempId: z.string(),
        toTempId: z.string(),
        relation: z.enum(EDGE_RELATIONS),
        confidence: z.number().min(0).max(100).default(70),
      }),
    )
    .default([]),
  notes: z.array(z.string()).default([]),
});

export type GraphLinkProposal = z.infer<typeof GraphLinkProposalSchema>;

export type ExtractedFilePayload = {
  fileName: string;
  mimeType?: string | null;
  text: string;
  kind: string;
  warning?: string;
  /** Optional base64 for vision (images/PDF first page later) */
  visionBase64?: string;
  visionMime?: string;
};
