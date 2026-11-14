-- classes
DROP POLICY "Teachers manage own classes" ON public.classes;
CREATE POLICY "Teachers manage own classes" ON public.classes
  FOR ALL TO authenticated
  USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

-- learners
DROP POLICY "Teachers manage own learners" ON public.learners;
CREATE POLICY "Teachers manage own learners" ON public.learners
  FOR ALL TO authenticated
  USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

-- assessments
DROP POLICY "Teachers manage own assessments" ON public.assessments;
CREATE POLICY "Teachers manage own assessments" ON public.assessments
  FOR ALL TO authenticated
  USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

-- marks
DROP POLICY "Teachers manage own marks" ON public.marks;
CREATE POLICY "Teachers manage own marks" ON public.marks
  FOR ALL TO authenticated
  USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);

-- mark_history
DROP POLICY "Teachers view own mark history" ON public.mark_history;
DROP POLICY "Teachers insert own mark history" ON public.mark_history;
CREATE POLICY "Teachers view own mark history" ON public.mark_history
  FOR SELECT TO authenticated
  USING (auth.uid() = teacher_id);
CREATE POLICY "Teachers insert own mark history" ON public.mark_history
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = teacher_id);