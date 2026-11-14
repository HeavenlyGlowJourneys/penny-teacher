-- Repair: run this in Supabase SQL editor if 20260803170000 failed with
-- "column intended_subject_id does not exist" (table already existed without those columns).
-- Safe to re-run.

ALTER TABLE public.prep_check_documents
  ADD COLUMN IF NOT EXISTS intended_subject_id uuid
    REFERENCES public.prep_check_subjects (id) ON DELETE SET NULL;

ALTER TABLE public.prep_check_documents
  ADD COLUMN IF NOT EXISTS intended_stage_id uuid
    REFERENCES public.prep_check_stages (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS prep_check_documents_scope_idx
  ON public.prep_check_documents (intended_subject_id, intended_stage_id);

-- Also ensure concept mentions have scope columns if that table existed early
ALTER TABLE public.prep_check_concept_mentions
  ADD COLUMN IF NOT EXISTS subject_id uuid
    REFERENCES public.prep_check_subjects (id) ON DELETE SET NULL;
ALTER TABLE public.prep_check_concept_mentions
  ADD COLUMN IF NOT EXISTS stage_id uuid
    REFERENCES public.prep_check_stages (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS prep_check_concept_mentions_scope_idx
  ON public.prep_check_concept_mentions (subject_id, stage_id, concept_label);
