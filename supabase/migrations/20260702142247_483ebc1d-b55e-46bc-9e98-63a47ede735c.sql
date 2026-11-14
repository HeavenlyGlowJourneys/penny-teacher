CREATE TABLE public.teacher_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  comment_length_type TEXT NOT NULL DEFAULT 'sentences' CHECK (comment_length_type IN ('sentences','words')),
  comment_length_sentences TEXT NOT NULL DEFAULT 'medium' CHECK (comment_length_sentences IN ('short','medium','long','extended')),
  comment_length_words INTEGER CHECK (comment_length_words IS NULL OR (comment_length_words BETWEEN 50 AND 500)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.teacher_settings TO authenticated;
GRANT ALL ON public.teacher_settings TO service_role;

ALTER TABLE public.teacher_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers manage own settings"
  ON public.teacher_settings FOR ALL
  USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

CREATE TRIGGER teacher_settings_set_updated_at
  BEFORE UPDATE ON public.teacher_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();