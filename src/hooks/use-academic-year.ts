import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AcademicYear = {
  id: string;
  name: string;
  is_current: boolean;
  created_at: string;
};

export type TermPeriod = {
  id: string;
  academic_year_id: string;
  name: string;
  sort_order: number;
  start_date: string | null;
  end_date: string | null;
};

export function useAcademicYears() {
  return useQuery({
    queryKey: ["academic-years"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("academic_years")
        .select("id, name, is_current, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AcademicYear[];
    },
    staleTime: 30_000,
  });
}

export function useCurrentAcademicYear() {
  const q = useAcademicYears();
  const current = q.data?.find((y) => y.is_current) ?? null;
  return { ...q, current };
}

export function useTermPeriods(academicYearId: string | null | undefined) {
  return useQuery({
    queryKey: ["term-periods", academicYearId],
    enabled: !!academicYearId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("term_periods")
        .select("id, academic_year_id, name, sort_order, start_date, end_date")
        .eq("academic_year_id", academicYearId!)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TermPeriod[];
    },
    staleTime: 30_000,
  });
}

export const ASSESSMENT_CATEGORIES = [
  "Class Test",
  "Quiz",
  "Assignment",
  "Project",
  "Practical",
  "Oral",
  "Investigation",
  "Controlled Test",
  "Formal Assessment",
  "Informal Assessment",
  "June Examination",
  "Trial Examination",
  "Final Examination",
] as const;

export const GRADE_OPTIONS = [
  "R", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6",
  "Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12", "Other",
] as const;

export const QUICK_START_STRUCTURES: Record<string, string[]> = {
  "3 Terms": ["Term 1", "Term 2", "Term 3"],
  "4 Terms": ["Term 1", "Term 2", "Term 3", "Term 4"],
  "3 Terms + June & Final Exam": ["Term 1", "Term 2", "June Exam", "Term 3", "Final Exam"],
  "4 Terms + Final Exam": ["Term 1", "Term 2", "Term 3", "Term 4", "Final Exam"],
  "Build my own": [""],
};
