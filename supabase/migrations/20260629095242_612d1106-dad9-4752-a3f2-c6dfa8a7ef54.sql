
CREATE TABLE public.ai_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  draft_type text NOT NULL CHECK (draft_type IN ('report_comment','parent_message')),
  learner_id uuid NOT NULL REFERENCES public.learners(id) ON DELETE CASCADE,
  assessment_id uuid REFERENCES public.assessments(id) ON DELETE SET NULL,
  term_period_id uuid REFERENCES public.term_periods(id) ON DELETE SET NULL,
  content text NOT NULL,
  message_type text CHECK (message_type IN ('celebration','encouragement','intervention')),
  comment_type text CHECK (comment_type IN ('term','year-end')),
  is_edited boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_drafts TO authenticated;
GRANT ALL ON public.ai_drafts TO service_role;
ALTER TABLE public.ai_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own ai_drafts" ON public.ai_drafts
  FOR ALL TO authenticated
  USING (auth.uid() = teacher_id) WITH CHECK (auth.uid() = teacher_id);
CREATE INDEX ai_drafts_report_lookup_idx ON public.ai_drafts (teacher_id, learner_id, term_period_id) WHERE draft_type = 'report_comment';
CREATE INDEX ai_drafts_parent_lookup_idx ON public.ai_drafts (teacher_id, learner_id, assessment_id) WHERE draft_type = 'parent_message';
CREATE TRIGGER ai_drafts_updated_at BEFORE UPDATE ON public.ai_drafts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.import_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  imported_at timestamptz NOT NULL DEFAULT now(),
  file_name text,
  rows_total integer NOT NULL DEFAULT 0,
  rows_imported integer NOT NULL DEFAULT 0,
  rows_skipped integer NOT NULL DEFAULT 0,
  learners_added integer NOT NULL DEFAULT 0,
  learners_archived integer NOT NULL DEFAULT 0,
  import_method text NOT NULL CHECK (import_method IN ('penny_template','custom_excel','manual_entry'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_logs TO authenticated;
GRANT ALL ON public.import_logs TO service_role;
ALTER TABLE public.import_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own import_logs" ON public.import_logs
  FOR ALL TO authenticated
  USING (auth.uid() = teacher_id) WITH CHECK (auth.uid() = teacher_id);
CREATE INDEX import_logs_class_idx ON public.import_logs (class_id, imported_at DESC);
