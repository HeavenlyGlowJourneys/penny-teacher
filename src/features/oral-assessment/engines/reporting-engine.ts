/**
 * Reporting Engine — independently replaceable.
 * Builds the official assessment record from session artefacts.
 */
import type { SessionReport } from "@/features/oral-assessment/types";
import { SessionReportSchema } from "@/features/oral-assessment/types";
import { ANALYSIS_ENGINE_VERSION } from "./analysis-engine";
import { INTERVIEW_ENGINE_VERSION } from "./interview-engine";
import { SCORING_ENGINE_VERSION } from "./scoring-engine";

export const REPORTING_ENGINE_VERSION = "placeholder-v0";

export type BuildReportInput = {
  transcript: Array<{
    turnIndex: number;
    role: "system" | "examiner" | "student";
    content: string;
    questionCode?: string | null;
  }>;
  questionPathway: string[];
  rubric?: {
    title: string;
    maxMark: number;
    criteria: Array<{ code: string; label: string; score?: number }>;
  };
  recommendedMark?: number | null;
  finalMark?: number | null;
  confidenceScore?: number | null;
  strengths?: string[];
  weaknesses?: string[];
  suggestedLecturerFeedback?: string;
  suggestedFinalComment?: string;
  evidenceSummary?: string[];
  questionScores?: Array<{
    code: string;
    label: string;
    score: number;
    maxScore?: number;
    answered?: boolean;
    note?: string;
  }>;
  integrityFlags?: Array<{ flagType: string; severity: string; summary: string }>;
  aiModelVersion?: string | null;
};

export function buildSessionReport(input: BuildReportInput): SessionReport {
  return SessionReportSchema.parse({
    transcript: input.transcript.map((t) => ({
      turnIndex: t.turnIndex,
      role: t.role,
      content: t.content,
      questionCode: t.questionCode ?? undefined,
    })),
    questionPathway: input.questionPathway,
    rubric: input.rubric,
    questionScores: input.questionScores ?? [],
    evidenceSummary: input.evidenceSummary ?? [],
    recommendedMark: input.recommendedMark ?? undefined,
    finalMark: input.finalMark ?? undefined,
    confidenceScore: input.confidenceScore ?? undefined,
    strengths: input.strengths ?? [],
    weaknesses: input.weaknesses ?? [],
    suggestedLecturerFeedback: input.suggestedLecturerFeedback,
    suggestedFinalComment: input.suggestedFinalComment,
    integrityFlags: input.integrityFlags ?? [],
    aiModelVersion: input.aiModelVersion ?? undefined,
    engineVersions: {
      analysis: ANALYSIS_ENGINE_VERSION,
      interview: INTERVIEW_ENGINE_VERSION,
      scoring: SCORING_ENGINE_VERSION,
      reporting: REPORTING_ENGINE_VERSION,
    },
    generatedAt: new Date().toISOString(),
  });
}
