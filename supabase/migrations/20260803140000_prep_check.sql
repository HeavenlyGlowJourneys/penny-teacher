-- Prep Check: isolated schema for AI curriculum planning review.
-- Removable: drop these tables + storage bucket without affecting core Penny.

CREATE TABLE IF NOT EXISTS public.prep_check_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'My school',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id)
);

CREATE TABLE IF NOT EXISTS public.prep_check_school_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.prep_check_workspaces (id) ON DELETE CASCADE UNIQUE,
  curriculum_frameworks text NOT NULL DEFAULT '',
  annual_teaching_plans text NOT NULL DEFAULT '',
  assessment_policy text NOT NULL DEFAULT '',
  homework_policy text NOT NULL DEFAULT '',
  department_policy text NOT NULL DEFAULT '',
  moderation_checklist text NOT NULL DEFAULT '',
  school_improvement_goals text NOT NULL DEFAULT '',
  planning_expectations text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.prep_check_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.prep_check_workspaces (id) ON DELETE CASCADE,
  name text NOT NULL,
  teaching_expectations text NOT NULL DEFAULT '',
  assessment_expectations text NOT NULL DEFAULT '',
  review_criteria text NOT NULL DEFAULT '',
  examples text NOT NULL DEFAULT '',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.prep_check_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.prep_check_workspaces (id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  learner_development text NOT NULL DEFAULT '',
  pacing text NOT NULL DEFAULT '',
  cognitive_ability text NOT NULL DEFAULT '',
  assessment_difficulty text NOT NULL DEFAULT '',
  classroom_experience text NOT NULL DEFAULT '',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, code)
);

CREATE TABLE IF NOT EXISTS public.prep_check_cognitive_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.prep_check_workspaces (id) ON DELETE CASCADE UNIQUE,
  level1_pct numeric NOT NULL DEFAULT 50 CHECK (level1_pct >= 0 AND level1_pct <= 100),
  level2_pct numeric NOT NULL DEFAULT 35 CHECK (level2_pct >= 0 AND level2_pct <= 100),
  level3_pct numeric NOT NULL DEFAULT 15 CHECK (level3_pct >= 0 AND level3_pct <= 100),
  level1_label text NOT NULL DEFAULT 'Level 1',
  level2_label text NOT NULL DEFAULT 'Level 2',
  level3_label text NOT NULL DEFAULT 'Level 3',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.prep_check_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.prep_check_workspaces (id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  workflow text NOT NULL CHECK (workflow IN ('teacher_prep', 'subject_head_review')),
  subject_id uuid REFERENCES public.prep_check_subjects (id) ON DELETE SET NULL,
  stage_id uuid REFERENCES public.prep_check_stages (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'processing', 'ready', 'failed')),
  title text NOT NULL DEFAULT 'Planning pack review',
  zip_storage_path text,
  file_manifest jsonb NOT NULL DEFAULT '[]'::jsonb,
  corpus_excerpt text,
  report jsonb,
  confidence numeric,
  overall_rating text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prep_check_reviews_owner_created_idx
  ON public.prep_check_reviews (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS prep_check_subjects_workspace_idx
  ON public.prep_check_subjects (workspace_id, sort_order);
CREATE INDEX IF NOT EXISTS prep_check_stages_workspace_idx
  ON public.prep_check_stages (workspace_id, sort_order);

ALTER TABLE public.prep_check_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prep_check_school_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prep_check_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prep_check_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prep_check_cognitive_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prep_check_reviews ENABLE ROW LEVEL SECURITY;

-- Owner-scoped policies
CREATE POLICY prep_check_workspaces_owner ON public.prep_check_workspaces
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY prep_check_school_config_owner ON public.prep_check_school_config
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.prep_check_workspaces w
      WHERE w.id = workspace_id AND w.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.prep_check_workspaces w
      WHERE w.id = workspace_id AND w.owner_id = auth.uid()
    )
  );

CREATE POLICY prep_check_subjects_owner ON public.prep_check_subjects
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.prep_check_workspaces w
      WHERE w.id = workspace_id AND w.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.prep_check_workspaces w
      WHERE w.id = workspace_id AND w.owner_id = auth.uid()
    )
  );

CREATE POLICY prep_check_stages_owner ON public.prep_check_stages
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.prep_check_workspaces w
      WHERE w.id = workspace_id AND w.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.prep_check_workspaces w
      WHERE w.id = workspace_id AND w.owner_id = auth.uid()
    )
  );

CREATE POLICY prep_check_cognitive_owner ON public.prep_check_cognitive_profiles
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.prep_check_workspaces w
      WHERE w.id = workspace_id AND w.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.prep_check_workspaces w
      WHERE w.id = workspace_id AND w.owner_id = auth.uid()
    )
  );

CREATE POLICY prep_check_reviews_owner ON public.prep_check_reviews
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

GRANT ALL ON public.prep_check_workspaces TO authenticated, service_role;
GRANT ALL ON public.prep_check_school_config TO authenticated, service_role;
GRANT ALL ON public.prep_check_subjects TO authenticated, service_role;
GRANT ALL ON public.prep_check_stages TO authenticated, service_role;
GRANT ALL ON public.prep_check_cognitive_profiles TO authenticated, service_role;
GRANT ALL ON public.prep_check_reviews TO authenticated, service_role;

-- Storage bucket for planning ZIPs (private)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('prep-check', 'prep-check', false, 52428800)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY prep_check_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'prep-check' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY prep_check_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'prep-check' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY prep_check_storage_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'prep-check' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY prep_check_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'prep-check' AND (storage.foldername(name))[1] = auth.uid()::text);
