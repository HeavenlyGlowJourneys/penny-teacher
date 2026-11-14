
ALTER TABLE public.learners
  ADD COLUMN IF NOT EXISTS pronunciation TEXT,
  ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS capture_mode TEXT NOT NULL DEFAULT 'final',
  ADD COLUMN IF NOT EXISTS sections JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.assessments
  DROP CONSTRAINT IF EXISTS assessments_capture_mode_check;
ALTER TABLE public.assessments
  ADD CONSTRAINT assessments_capture_mode_check CHECK (capture_mode IN ('final','sections'));

ALTER TABLE public.marks
  ADD COLUMN IF NOT EXISTS section_marks JSONB;
