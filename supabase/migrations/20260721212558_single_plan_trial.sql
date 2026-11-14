-- Pricing migration: collapse Starter/Pro/Smart (+ monthly/annual) into a
-- single R29/month plan, and reinstate a trial — 3 days this time, not the
-- original 7, still no credit card required at signup (same no-PayFast-
-- interaction design as the trial the Beta Readiness migration removed).

-- 1. Existing paid subscribers all collapse onto the one remaining plan.
--    This only relabels our own bookkeeping column — it does NOT touch
--    what PayFast is actually charging each subscriber. Updating their
--    real recurring amount at PayFast is a separate, deliberate action
--    (per-subscriber PayFast API call) to run once PayFast checkout
--    itself is confirmed working again.
UPDATE public.subscriptions SET plan = 'standard' WHERE plan IN ('starter', 'pro', 'smart');

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan = ANY (ARRAY['trial'::text, 'standard'::text]));

-- 2. scheduled_plan_change / scheduled_downgrade_plan only ever made sense
--    with multiple plans to move between. One plan means "move to a
--    different plan" isn't a real action anymore.
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_scheduled_plan_change_check;
ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS scheduled_plan_change;
ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS scheduled_downgrade_plan;

-- 3. Reinstate the auto-trial-on-signup trigger — 3 days, no card. Dropped
--    in the Beta Readiness migration when "must pay immediately" replaced
--    it; this brings it back with the new shorter window.
CREATE OR REPLACE FUNCTION public.create_trial_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.subscriptions (teacher_id, plan, status, trial_started_at, trial_ends_at)
  VALUES (NEW.id, 'trial', 'active', now(), now() + interval '3 days')
  ON CONFLICT (teacher_id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_trial_subscription() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created_create_trial ON auth.users;
CREATE TRIGGER on_auth_user_created_create_trial
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.create_trial_subscription();

-- 4. Write-access gate for the new "trial ended, no card yet" state. This
--    app's mutations go straight from the client through RLS (no server
--    route in front of them, unlike the sibling HGJ Business app), so the
--    read-only gate has to live here rather than in application code.
--    SELECT stays open on every table below via its existing policy —
--    only INSERT/UPDATE/DELETE additionally require this.
CREATE OR REPLACE FUNCTION public.has_write_access(p_teacher_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.teacher_id = p_teacher_id
      AND (
        (s.status = 'active' AND (s.plan <> 'trial' OR s.trial_ends_at > now()))
        OR (s.status = 'cancelled' AND s.current_period_end > now())
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.has_write_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_write_access(uuid) TO authenticated;

-- classes
DROP POLICY IF EXISTS "Teachers manage own classes" ON public.classes;
CREATE POLICY "Teachers view own classes" ON public.classes
  FOR SELECT TO authenticated USING (auth.uid() = teacher_id);
CREATE POLICY "Teachers insert own classes" ON public.classes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = teacher_id AND public.has_write_access(teacher_id));
CREATE POLICY "Teachers update own classes" ON public.classes
  FOR UPDATE TO authenticated USING (auth.uid() = teacher_id) WITH CHECK (auth.uid() = teacher_id AND public.has_write_access(teacher_id));
CREATE POLICY "Teachers delete own classes" ON public.classes
  FOR DELETE TO authenticated USING (auth.uid() = teacher_id AND public.has_write_access(teacher_id));

-- learners
DROP POLICY IF EXISTS "Teachers manage own learners" ON public.learners;
CREATE POLICY "Teachers view own learners" ON public.learners
  FOR SELECT TO authenticated USING (auth.uid() = teacher_id);
CREATE POLICY "Teachers insert own learners" ON public.learners
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = teacher_id AND public.has_write_access(teacher_id));
CREATE POLICY "Teachers update own learners" ON public.learners
  FOR UPDATE TO authenticated USING (auth.uid() = teacher_id) WITH CHECK (auth.uid() = teacher_id AND public.has_write_access(teacher_id));
CREATE POLICY "Teachers delete own learners" ON public.learners
  FOR DELETE TO authenticated USING (auth.uid() = teacher_id AND public.has_write_access(teacher_id));

-- assessments
DROP POLICY IF EXISTS "Teachers manage own assessments" ON public.assessments;
CREATE POLICY "Teachers view own assessments" ON public.assessments
  FOR SELECT TO authenticated USING (auth.uid() = teacher_id);
CREATE POLICY "Teachers insert own assessments" ON public.assessments
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = teacher_id AND public.has_write_access(teacher_id));
CREATE POLICY "Teachers update own assessments" ON public.assessments
  FOR UPDATE TO authenticated USING (auth.uid() = teacher_id) WITH CHECK (auth.uid() = teacher_id AND public.has_write_access(teacher_id));
CREATE POLICY "Teachers delete own assessments" ON public.assessments
  FOR DELETE TO authenticated USING (auth.uid() = teacher_id AND public.has_write_access(teacher_id));

-- marks
DROP POLICY IF EXISTS "Teachers manage own marks" ON public.marks;
CREATE POLICY "Teachers view own marks" ON public.marks
  FOR SELECT TO authenticated USING (auth.uid() = teacher_id);
CREATE POLICY "Teachers insert own marks" ON public.marks
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = teacher_id AND public.has_write_access(teacher_id));
CREATE POLICY "Teachers update own marks" ON public.marks
  FOR UPDATE TO authenticated USING (auth.uid() = teacher_id) WITH CHECK (auth.uid() = teacher_id AND public.has_write_access(teacher_id));
CREATE POLICY "Teachers delete own marks" ON public.marks
  FOR DELETE TO authenticated USING (auth.uid() = teacher_id AND public.has_write_access(teacher_id));

-- mark_history (already split — SELECT untouched, gate the INSERT)
DROP POLICY IF EXISTS "Teachers insert own mark history" ON public.mark_history;
CREATE POLICY "Teachers insert own mark history" ON public.mark_history
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = teacher_id AND public.has_write_access(teacher_id));

-- academic_years (already split — gate insert/update/delete)
DROP POLICY IF EXISTS "academic_years_insert_own" ON public.academic_years;
DROP POLICY IF EXISTS "academic_years_update_own" ON public.academic_years;
DROP POLICY IF EXISTS "academic_years_delete_own" ON public.academic_years;
CREATE POLICY "academic_years_insert_own" ON public.academic_years
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = teacher_id AND public.has_write_access(teacher_id));
CREATE POLICY "academic_years_update_own" ON public.academic_years
  FOR UPDATE TO authenticated USING (auth.uid() = teacher_id) WITH CHECK (auth.uid() = teacher_id AND public.has_write_access(teacher_id));
CREATE POLICY "academic_years_delete_own" ON public.academic_years
  FOR DELETE TO authenticated USING (auth.uid() = teacher_id AND public.has_write_access(teacher_id));

-- term_periods (already split — gate insert/update/delete)
DROP POLICY IF EXISTS "term_periods_insert_own" ON public.term_periods;
DROP POLICY IF EXISTS "term_periods_update_own" ON public.term_periods;
DROP POLICY IF EXISTS "term_periods_delete_own" ON public.term_periods;
CREATE POLICY "term_periods_insert_own" ON public.term_periods
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = teacher_id AND public.has_write_access(teacher_id));
CREATE POLICY "term_periods_update_own" ON public.term_periods
  FOR UPDATE TO authenticated USING (auth.uid() = teacher_id) WITH CHECK (auth.uid() = teacher_id AND public.has_write_access(teacher_id));
CREATE POLICY "term_periods_delete_own" ON public.term_periods
  FOR DELETE TO authenticated USING (auth.uid() = teacher_id AND public.has_write_access(teacher_id));

-- ai_drafts
DROP POLICY IF EXISTS "Teachers manage own ai_drafts" ON public.ai_drafts;
CREATE POLICY "Teachers view own ai_drafts" ON public.ai_drafts
  FOR SELECT TO authenticated USING (auth.uid() = teacher_id);
CREATE POLICY "Teachers insert own ai_drafts" ON public.ai_drafts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = teacher_id AND public.has_write_access(teacher_id));
CREATE POLICY "Teachers update own ai_drafts" ON public.ai_drafts
  FOR UPDATE TO authenticated USING (auth.uid() = teacher_id) WITH CHECK (auth.uid() = teacher_id AND public.has_write_access(teacher_id));
CREATE POLICY "Teachers delete own ai_drafts" ON public.ai_drafts
  FOR DELETE TO authenticated USING (auth.uid() = teacher_id AND public.has_write_access(teacher_id));

-- import_logs
DROP POLICY IF EXISTS "Teachers manage own import_logs" ON public.import_logs;
CREATE POLICY "Teachers view own import_logs" ON public.import_logs
  FOR SELECT TO authenticated USING (auth.uid() = teacher_id);
CREATE POLICY "Teachers insert own import_logs" ON public.import_logs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = teacher_id AND public.has_write_access(teacher_id));
CREATE POLICY "Teachers update own import_logs" ON public.import_logs
  FOR UPDATE TO authenticated USING (auth.uid() = teacher_id) WITH CHECK (auth.uid() = teacher_id AND public.has_write_access(teacher_id));
CREATE POLICY "Teachers delete own import_logs" ON public.import_logs
  FOR DELETE TO authenticated USING (auth.uid() = teacher_id AND public.has_write_access(teacher_id));
