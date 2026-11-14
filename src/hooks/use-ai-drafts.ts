// Persist generated report comments and parent messages so teachers can
// return to previous drafts. Used by the report-comments page and the
// parent-messages dialog. Call sites enforce subscription write access.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DraftType = "report_comment" | "parent_message";

export type AIDraft = {
  id: string;
  teacher_id: string;
  draft_type: DraftType;
  learner_id: string;
  assessment_id: string | null;
  term_period_id: string | null;
  content: string;
  message_type: "celebration" | "encouragement" | "intervention" | null;
  comment_type: "term" | "year-end" | null;
  is_edited: boolean;
  created_at: string;
  updated_at: string;
};

/** Load report-comment drafts for a given list of learners + term period. */
export function useReportCommentDrafts(learnerIds: string[], termPeriodId: string | null) {
  return useQuery({
    queryKey: ["ai-drafts", "report_comment", termPeriodId ?? "any", [...learnerIds].sort().join(",")],
    enabled: learnerIds.length > 0,
    queryFn: async (): Promise<AIDraft[]> => {
      let q = supabase
        .from("ai_drafts")
        .select("*")
        .eq("draft_type", "report_comment")
        .in("learner_id", learnerIds);
      q = termPeriodId ? q.eq("term_period_id", termPeriodId) : q.is("term_period_id", null);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AIDraft[];
    },
  });
}

/** Load parent-message drafts for a given assessment. */
export function useParentMessageDrafts(assessmentId: string | null) {
  return useQuery({
    queryKey: ["ai-drafts", "parent_message", assessmentId ?? ""],
    enabled: !!assessmentId,
    queryFn: async (): Promise<AIDraft[]> => {
      const { data, error } = await supabase
        .from("ai_drafts").select("*")
        .eq("draft_type", "parent_message")
        .eq("assessment_id", assessmentId!);
      if (error) throw error;
      return (data ?? []) as AIDraft[];
    },
  });
}

type SaveInput = {
  teacherId: string;
  draftType: DraftType;
  learnerId: string;
  assessmentId?: string | null;
  termPeriodId?: string | null;
  content: string;
  messageType?: "celebration" | "encouragement" | "intervention" | null;
  commentType?: "term" | "year-end" | null;
  isEdited?: boolean;
};

/** Upsert a draft by (teacher, type, learner, assessment, term_period). */
export async function upsertDraft(input: SaveInput): Promise<void> {
  // Manual upsert because of the conditional null term_period_id.
  const filters = supabase
    .from("ai_drafts")
    .select("id")
    .eq("teacher_id", input.teacherId)
    .eq("draft_type", input.draftType)
    .eq("learner_id", input.learnerId);
  const existing = await (
    input.assessmentId
      ? filters.eq("assessment_id", input.assessmentId)
      : input.termPeriodId
        ? filters.is("assessment_id", null).eq("term_period_id", input.termPeriodId)
        : filters.is("assessment_id", null).is("term_period_id", null)
  ).maybeSingle();
  if (existing.error && existing.error.code !== "PGRST116") throw existing.error;

  const payload = {
    teacher_id: input.teacherId,
    draft_type: input.draftType,
    learner_id: input.learnerId,
    assessment_id: input.assessmentId ?? null,
    term_period_id: input.termPeriodId ?? null,
    content: input.content,
    message_type: input.messageType ?? null,
    comment_type: input.commentType ?? null,
    is_edited: input.isEdited ?? false,
  };

  if (existing.data?.id) {
    const { error } = await supabase.from("ai_drafts")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", existing.data.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("ai_drafts").insert(payload);
    if (error) throw error;
  }
}

export function useInvalidateDrafts() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["ai-drafts"] });
}
