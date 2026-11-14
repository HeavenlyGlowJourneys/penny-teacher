-- Allow the same assessment name across different term periods within a class,
-- but prevent duplicates within the same term. Only enforced when term_period_id
-- is set — if either side has no term, teachers can still create as many as they like.
CREATE UNIQUE INDEX IF NOT EXISTS assessments_unique_name_per_term
  ON public.assessments (class_id, lower(name), term_period_id)
  WHERE term_period_id IS NOT NULL;