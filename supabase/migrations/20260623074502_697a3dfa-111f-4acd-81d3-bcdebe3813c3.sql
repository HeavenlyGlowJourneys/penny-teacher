
-- CLASSES
CREATE TABLE public.classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  grade TEXT NOT NULL,
  subject TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.classes TO authenticated;
GRANT ALL ON public.classes TO service_role;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own classes" ON public.classes FOR ALL
  USING (auth.uid() = teacher_id) WITH CHECK (auth.uid() = teacher_id);

-- LEARNERS
CREATE TABLE public.learners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES public.classes ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_key TEXT GENERATED ALWAYS AS (lower(name)) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX learners_class_idx ON public.learners(class_id, sort_key);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learners TO authenticated;
GRANT ALL ON public.learners TO service_role;
ALTER TABLE public.learners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own learners" ON public.learners FOR ALL
  USING (auth.uid() = teacher_id) WITH CHECK (auth.uid() = teacher_id);

-- ASSESSMENTS
CREATE TABLE public.assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES public.classes ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  assessment_type TEXT NOT NULL DEFAULT 'Test',
  assessment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_marks NUMERIC NOT NULL CHECK (total_marks > 0),
  pass_mark NUMERIC NOT NULL DEFAULT 50,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX assessments_class_idx ON public.assessments(class_id, assessment_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assessments TO authenticated;
GRANT ALL ON public.assessments TO service_role;
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own assessments" ON public.assessments FOR ALL
  USING (auth.uid() = teacher_id) WITH CHECK (auth.uid() = teacher_id);

-- MARKS
CREATE TABLE public.marks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL REFERENCES public.assessments ON DELETE CASCADE,
  learner_id UUID NOT NULL REFERENCES public.learners ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  mark NUMERIC,
  status TEXT NOT NULL DEFAULT 'captured' CHECK (status IN ('captured', 'absent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (assessment_id, learner_id)
);
CREATE INDEX marks_assessment_idx ON public.marks(assessment_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marks TO authenticated;
GRANT ALL ON public.marks TO service_role;
ALTER TABLE public.marks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers manage own marks" ON public.marks FOR ALL
  USING (auth.uid() = teacher_id) WITH CHECK (auth.uid() = teacher_id);

-- MARK HISTORY
CREATE TABLE public.mark_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mark_id UUID NOT NULL REFERENCES public.marks ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  old_mark NUMERIC,
  new_mark NUMERIC,
  old_status TEXT,
  new_status TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mark_history_mark_idx ON public.mark_history(mark_id, changed_at DESC);
GRANT SELECT, INSERT ON public.mark_history TO authenticated;
GRANT ALL ON public.mark_history TO service_role;
ALTER TABLE public.mark_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers view own mark history" ON public.mark_history FOR SELECT
  USING (auth.uid() = teacher_id);
CREATE POLICY "Teachers insert own mark history" ON public.mark_history FOR INSERT
  WITH CHECK (auth.uid() = teacher_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER classes_updated_at BEFORE UPDATE ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER assessments_updated_at BEFORE UPDATE ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER marks_updated_at BEFORE UPDATE ON public.marks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- audit trigger for marks
CREATE OR REPLACE FUNCTION public.log_mark_change() RETURNS TRIGGER AS $$
BEGIN
  IF (OLD.mark IS DISTINCT FROM NEW.mark) OR (OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO public.mark_history (mark_id, teacher_id, old_mark, new_mark, old_status, new_status)
    VALUES (NEW.id, NEW.teacher_id, OLD.mark, NEW.mark, OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER marks_audit AFTER UPDATE ON public.marks
  FOR EACH ROW EXECUTE FUNCTION public.log_mark_change();
