DROP POLICY IF EXISTS "Teachers manage own settings" ON public.teacher_settings;

CREATE POLICY "Teachers manage own settings"
  ON public.teacher_settings
  FOR ALL
  TO authenticated
  USING (auth.uid() = teacher_id)
  WITH CHECK (auth.uid() = teacher_id);