CREATE TABLE public.feedback_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at timestamptz NOT NULL DEFAULT now(),
  category text,
  message text,
  page text,
  browser text,
  plan text,
  app_version text,
  teacher_id uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

GRANT INSERT ON public.feedback_submissions TO authenticated;
GRANT ALL ON public.feedback_submissions TO service_role;

ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can insert their own feedback"
  ON public.feedback_submissions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = teacher_id);

CREATE POLICY "Service role can read all feedback"
  ON public.feedback_submissions
  FOR SELECT
  TO service_role
  USING (true);