-- Subscriptions table
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  plan text NOT NULL CHECK (plan IN ('trial','starter','pro','smart')),
  status text NOT NULL CHECK (status IN ('active','expired','cancelled')),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  payfast_subscription_token text,
  scheduled_downgrade_plan text CHECK (scheduled_downgrade_plan IS NULL OR scheduled_downgrade_plan IN ('starter','pro','smart')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can view own subscription"
  ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = teacher_id);

-- updated_at trigger (reuse existing set_updated_at function)
CREATE TRIGGER subscriptions_set_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create trial subscription on new user signup
CREATE OR REPLACE FUNCTION public.create_trial_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.subscriptions (teacher_id, plan, status, trial_started_at, trial_ends_at)
  VALUES (NEW.id, 'trial', 'active', now(), now() + interval '7 days')
  ON CONFLICT (teacher_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_create_trial
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.create_trial_subscription();

-- Backfill existing users with a trial subscription so they aren't locked out
INSERT INTO public.subscriptions (teacher_id, plan, status, trial_started_at, trial_ends_at)
SELECT id, 'trial', 'active', now(), now() + interval '7 days'
FROM auth.users
ON CONFLICT (teacher_id) DO NOTHING;

-- Webhook logs (service_role only)
CREATE TABLE public.webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb,
  verified boolean NOT NULL DEFAULT false,
  action_taken text
);

GRANT ALL ON public.webhook_logs TO service_role;

ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;
-- No policies = no access for authenticated/anon. Only service_role bypasses RLS.
