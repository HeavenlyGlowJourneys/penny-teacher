-- Sprint 2: Academic year structure, term periods, assessment metadata

-- PART 1: academic_years
CREATE TABLE public.academic_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.academic_years TO authenticated;
GRANT ALL ON public.academic_years TO service_role;

ALTER TABLE public.academic_years ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own academic years"
  ON public.academic_years
  FOR ALL
  TO authenticated
  USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

CREATE UNIQUE INDEX one_current_year_per_teacher
  ON public.academic_years (teacher_id)
  WHERE is_current = true;

CREATE INDEX academic_years_teacher_idx ON public.academic_years (teacher_id);

-- PART 2: term_periods
CREATE TABLE public.term_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL,
  start_date date,
  end_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.term_periods TO authenticated;
GRANT ALL ON public.term_periods TO service_role;

ALTER TABLE public.term_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own term periods"
  ON public.term_periods
  FOR ALL
  TO authenticated
  USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

CREATE INDEX term_periods_teacher_year_idx
  ON public.term_periods (teacher_id, academic_year_id, sort_order);

-- PART 4: assessment metadata
ALTER TABLE public.assessments
  ADD COLUMN academic_year_id uuid REFERENCES public.academic_years(id) ON DELETE SET NULL,
  ADD COLUMN term_period_id uuid REFERENCES public.term_periods(id) ON DELETE SET NULL,
  ADD COLUMN subject text,
  ADD COLUMN grade text,
  ADD COLUMN category text,
  ADD COLUMN weighting numeric,
  ADD COLUMN counts_towards_report boolean NOT NULL DEFAULT false,
  ADD COLUMN topics_covered text;

-- Note: assessments.assessment_date already exists (date column) — not re-added.

CREATE INDEX assessments_term_period_idx ON public.assessments (term_period_id);
CREATE INDEX assessments_academic_year_idx ON public.assessments (academic_year_id);
