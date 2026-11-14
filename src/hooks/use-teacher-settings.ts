// Teacher-level preferences. Currently stores report-comment length
// preference and the school's term for pupils. Row is created lazily on
// first save.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CommentLengthType = "sentences" | "words";
export type CommentLengthSentences = "short" | "medium" | "long" | "extended";
export type LearnerTerm = "learner" | "student";

export type TeacherSettings = {
  teacher_id: string;
  comment_length_type: CommentLengthType;
  comment_length_sentences: CommentLengthSentences;
  comment_length_words: number | null;
  learner_term: LearnerTerm;
};

export const DEFAULT_TEACHER_SETTINGS: Omit<TeacherSettings, "teacher_id"> = {
  comment_length_type: "sentences",
  comment_length_sentences: "medium",
  comment_length_words: null,
  learner_term: "learner",
};

export const SENTENCE_BUCKET_LABEL: Record<CommentLengthSentences, string> = {
  short: "Short — 3 to 4 sentences",
  medium: "Medium — 5 to 6 sentences",
  long: "Long — 7 to 8 sentences",
  extended: "Extended — 9 to 10 sentences",
};

export const SENTENCE_BUCKET_RANGE: Record<CommentLengthSentences, string> = {
  short: "3 to 4",
  medium: "5 to 6",
  long: "7 to 8",
  extended: "9 to 10",
};

function normaliseLearnerTerm(value: string | null | undefined): LearnerTerm {
  return value === "student" ? "student" : "learner";
}

export function useTeacherSettings(teacherId: string | null | undefined) {
  return useQuery({
    queryKey: ["teacher-settings", teacherId ?? ""],
    enabled: !!teacherId,
    queryFn: async (): Promise<TeacherSettings> => {
      const { data, error } = await supabase
        .from("teacher_settings")
        .select("teacher_id, comment_length_type, comment_length_sentences, comment_length_words, learner_term")
        .eq("teacher_id", teacherId!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return { teacher_id: teacherId!, ...DEFAULT_TEACHER_SETTINGS };
      return {
        teacher_id: data.teacher_id,
        comment_length_type: (data.comment_length_type ?? "sentences") as CommentLengthType,
        comment_length_sentences: (data.comment_length_sentences ?? "medium") as CommentLengthSentences,
        comment_length_words: data.comment_length_words ?? null,
        learner_term: normaliseLearnerTerm(data.learner_term),
      };
    },
    staleTime: 30_000,
  });
}

export type LearnerVocab = {
  term: LearnerTerm;
  singular: string;   // "learner" | "student"
  plural: string;     // "learners" | "students"
  Singular: string;   // "Learner" | "Student"
  Plural: string;     // "Learners" | "Students"
};

export function vocabFor(term: LearnerTerm): LearnerVocab {
  const singular = term;
  const plural = `${term}s`;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return { term, singular, plural, Singular: cap(singular), Plural: cap(plural) };
}

/**
 * Convenience hook that returns the learner-vs-student vocabulary for the
 * signed-in teacher. Falls back to "learner" while settings load or when
 * teacherId is unknown, so the UI never renders empty strings.
 */
export function useLearnerTerm(teacherId: string | null | undefined): LearnerVocab {
  const { data } = useTeacherSettings(teacherId);
  return vocabFor(data?.learner_term ?? "learner");
}

export function useSaveTeacherSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      teacherId: string;
      comment_length_type: CommentLengthType;
      comment_length_sentences: CommentLengthSentences;
      comment_length_words: number | null;
      learner_term: LearnerTerm;
    }) => {
      const payload = {
        teacher_id: input.teacherId,
        comment_length_type: input.comment_length_type,
        comment_length_sentences: input.comment_length_sentences,
        comment_length_words: input.comment_length_words,
        learner_term: input.learner_term,
      };
      const { error } = await supabase
        .from("teacher_settings")
        .upsert(payload, { onConflict: "teacher_id" });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ["teacher-settings", vars.teacherId] });
    },
  });
}
