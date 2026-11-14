-- Stronger PayFast ITN idempotency: remember the last processed payment id.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS last_payfast_payment_id text;

CREATE INDEX IF NOT EXISTS subscriptions_last_payfast_payment_id_idx
  ON public.subscriptions (last_payfast_payment_id)
  WHERE last_payfast_payment_id IS NOT NULL;
