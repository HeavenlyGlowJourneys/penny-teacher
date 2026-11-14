-- Add explicit service_role policies for subscriptions write operations
CREATE POLICY "Service role can insert subscriptions"
  ON public.subscriptions FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update subscriptions"
  ON public.subscriptions FOR UPDATE
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role can delete subscriptions"
  ON public.subscriptions FOR DELETE
  TO service_role
  USING (true);

-- Add explicit service_role policies for webhook_logs
CREATE POLICY "Service role can select webhook logs"
  ON public.webhook_logs FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Service role can insert webhook logs"
  ON public.webhook_logs FOR INSERT
  TO service_role
  WITH CHECK (true);
