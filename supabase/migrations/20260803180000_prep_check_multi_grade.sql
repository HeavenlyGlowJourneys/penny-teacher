-- Multi-grade / multi-subject responsibility scopes for Prep Check.
-- Extends the existing model; does not replace subject/stage or PIE tables.
-- Document and concept scope columns already ship in 20260803170000.

-- Leadership areas of responsibility (subject × grade/stage combinations).
-- phase_label is nullable and unused in the UI for now; it exists so future
-- cross-grade reports can group grades into phases without a migration.
CREATE TABLE IF NOT EXISTS public.prep_check_responsibilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.prep_check_workspaces (id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.prep_check_subjects (id) ON DELETE CASCADE,
  stage_id uuid NOT NULL REFERENCES public.prep_check_stages (id) ON DELETE CASCADE,
  phase_label text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, subject_id, stage_id)
);

CREATE INDEX IF NOT EXISTS prep_check_responsibilities_ws_idx
  ON public.prep_check_responsibilities (workspace_id, subject_id, sort_order);
CREATE INDEX IF NOT EXISTS prep_check_responsibilities_subject_idx
  ON public.prep_check_responsibilities (subject_id, stage_id);

ALTER TABLE public.prep_check_responsibilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY prep_check_responsibilities_owner ON public.prep_check_responsibilities
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.prep_check_workspaces w
      WHERE w.id = workspace_id AND w.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.prep_check_workspaces w
      WHERE w.id = workspace_id AND w.owner_id = auth.uid()
    )
  );

GRANT ALL ON public.prep_check_responsibilities TO authenticated, service_role;
