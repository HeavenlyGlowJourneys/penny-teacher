-- Durable per-teacher AI rate limiting for Gemini-backed server functions.
CREATE TABLE IF NOT EXISTS public.ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_usage_events_teacher_created_idx
  ON public.ai_usage_events (teacher_id, created_at DESC);

ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;
-- No policies for authenticated/anon — service_role only (SECURITY DEFINER fn).

REVOKE ALL ON public.ai_usage_events FROM PUBLIC;
GRANT ALL ON public.ai_usage_events TO service_role;

CREATE OR REPLACE FUNCTION public.check_ai_rate_limit(
  p_teacher uuid,
  p_limit int DEFAULT 60,
  p_window_seconds int DEFAULT 3600
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cnt int;
BEGIN
  IF p_teacher IS NULL THEN
    RETURN false;
  END IF;

  DELETE FROM public.ai_usage_events
  WHERE created_at < now() - make_interval(secs => p_window_seconds);

  SELECT count(*)::int INTO cnt
  FROM public.ai_usage_events
  WHERE teacher_id = p_teacher
    AND created_at > now() - make_interval(secs => p_window_seconds);

  IF cnt >= p_limit THEN
    RETURN false;
  END IF;

  INSERT INTO public.ai_usage_events (teacher_id) VALUES (p_teacher);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.check_ai_rate_limit(uuid, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_ai_rate_limit(uuid, int, int) TO service_role;
