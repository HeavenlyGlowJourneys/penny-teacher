
-- Remove trial-creation trigger and function
DROP TRIGGER IF EXISTS on_auth_user_created_create_trial ON auth.users;
DROP FUNCTION IF EXISTS public.create_trial_subscription();

-- Update plan check constraint: remove 'trial'
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan = ANY (ARRAY['starter'::text, 'pro'::text, 'smart'::text]));

-- New fields
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS first_payment_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS data_deletion_scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_plan_change text;

-- Constrain scheduled_plan_change to valid plans
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_scheduled_plan_change_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_scheduled_plan_change_check
  CHECK (scheduled_plan_change IS NULL OR scheduled_plan_change = ANY (ARRAY['starter'::text, 'pro'::text, 'smart'::text]));
