-- Academic years
CREATE TABLE IF NOT EXISTS public.academic_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.academic_years TO authenticated;
GRANT ALL ON public.academic_years TO service_role;

ALTER TABLE public.academic_years ENABLE ROW LEVEL SECURITY;

CREATE POLICY "academic_years_select_own" ON public.academic_years
  FOR SELECT TO authenticated USING (auth.uid() = teacher_id);
CREATE POLICY "academic_years_insert_own" ON public.academic_years
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = teacher_id);
CREATE POLICY "academic_years_update_own" ON public.academic_years
  FOR UPDATE TO authenticated USING (auth.uid() = teacher_id) WITH CHECK (auth.uid() = teacher_id);
CREATE POLICY "academic_years_delete_own" ON public.academic_years
  FOR DELETE TO authenticated USING (auth.uid() = teacher_id);

CREATE UNIQUE INDEX IF NOT EXISTS one_current_year_per_teacher
  ON public.academic_years (teacher_id) WHERE is_current = true;

CREATE INDEX IF NOT EXISTS academic_years_teacher_idx ON public.academic_years (teacher_id);

-- Term periods
CREATE TABLE IF NOT EXISTS public.term_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  start_date date,
  end_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.term_periods TO authenticated;
GRANT ALL ON public.term_periods TO service_role;

ALTER TABLE public.term_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "term_periods_select_own" ON public.term_periods
  FOR SELECT TO authenticated USING (auth.uid() = teacher_id);
CREATE POLICY "term_periods_insert_own" ON public.term_periods
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = teacher_id);
CREATE POLICY "term_periods_update_own" ON public.term_periods
  FOR UPDATE TO authenticated USING (auth.uid() = teacher_id) WITH CHECK (auth.uid() = teacher_id);
CREATE POLICY "term_periods_delete_own" ON public.term_periods
  FOR DELETE TO authenticated USING (auth.uid() = teacher_id);

CREATE INDEX IF NOT EXISTS term_periods_year_idx
  ON public.term_periods (academic_year_id, sort_order);
CREATE INDEX IF NOT EXISTS term_periods_teacher_idx
  ON public.term_periods (teacher_id);

-- Assessment metadata (all nullable; existing rows untouched)
ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS academic_year_id uuid REFERENCES public.academic_years(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS term_period_id   uuid REFERENCES public.term_periods(id)   ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS grade text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS weighting numeric,
  ADD COLUMN IF NOT EXISTS counts_towards_report boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS topics_covered text;

CREATE INDEX IF NOT EXISTS assessments_term_period_idx
  ON public.assessments (term_period_id);
CREATE INDEX IF NOT EXISTS assessments_academic_year_idx
  ON public.assessments (academic_year_id);
