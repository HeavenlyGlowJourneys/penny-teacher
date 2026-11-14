-- Penny Oral Assessment Tool: isolated schema for authentic oral assessments.
-- Removable: drop these tables + storage bucket without affecting core Penny or Prep Check.
--
-- Design principles (Sprint 0):
--   - Prefixed oral_assessment_* — no coupling to Penny Teacher (classes/learners/marks).
--   - Status fields use text + CHECK (no Postgres ENUM types).
--   - Transcript/metadata by default; video/identity columns reserved for future optional use.
--   - Engines (analysis / interview / scoring / reporting) are independently replaceable.

-- ---------------------------------------------------------------------------
-- Workspace (one per lecturer owner)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oral_assessment_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'My institution',
  institution_name text NOT NULL DEFAULT '',
  retention_days int NOT NULL DEFAULT 365
    CHECK (retention_days >= 1 AND retention_days <= 3650),
  -- Future: identity / media policy toggles (optional features)
  identity_verification_enabled boolean NOT NULL DEFAULT false,
  temporary_video_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id)
);

-- ---------------------------------------------------------------------------
-- Assessments (lecturer uploads existing written assessment → oral assessment)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oral_assessment_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.oral_assessment_workspaces (id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Untitled oral assessment',
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft',
      'uploading',
      'analysing',
      'ready',
      'published',
      'archived',
      'failed'
    )),
  -- Optional lecturer-provided context (never AI prompts)
  learning_outcomes_text text NOT NULL DEFAULT '',
  memorandum_text text NOT NULL DEFAULT '',
  -- Analysis engine output (placeholder until AI wired)
  analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
  analysis_model text,
  analysis_error text,
  -- Accessibility defaults (future multi-language / accommodations)
  default_locale text NOT NULL DEFAULT 'en',
  extra_time_multiplier numeric NOT NULL DEFAULT 1.0
    CHECK (extra_time_multiplier >= 1.0 AND extra_time_multiplier <= 3.0),
  expected_duration_minutes int NOT NULL DEFAULT 15
    CHECK (expected_duration_minutes >= 5 AND expected_duration_minutes <= 120),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oral_assessment_assessments_owner_created_idx
  ON public.oral_assessment_assessments (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS oral_assessment_assessments_workspace_status_idx
  ON public.oral_assessment_assessments (workspace_id, status);

-- ---------------------------------------------------------------------------
-- Uploaded source files (PDF, DOCX, PPT, images, etc.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oral_assessment_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.oral_assessment_assessments (id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'source'
    CHECK (role IN ('source', 'rubric', 'learning_outcomes', 'memorandum', 'other')),
  file_name text NOT NULL,
  content_type text NOT NULL DEFAULT 'application/octet-stream',
  byte_size bigint NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
  storage_path text NOT NULL,
  kind text NOT NULL DEFAULT 'other',
  extracted_text text NOT NULL DEFAULT '',
  extract_warning text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oral_assessment_files_assessment_idx
  ON public.oral_assessment_files (assessment_id);

-- ---------------------------------------------------------------------------
-- Rubric model
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oral_assessment_rubrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.oral_assessment_assessments (id) ON DELETE CASCADE UNIQUE,
  title text NOT NULL DEFAULT 'Oral assessment rubric',
  max_mark numeric NOT NULL DEFAULT 100 CHECK (max_mark > 0),
  source text NOT NULL DEFAULT 'generated'
    CHECK (source IN ('uploaded', 'generated', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.oral_assessment_rubric_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rubric_id uuid NOT NULL REFERENCES public.oral_assessment_rubrics (id) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  weight numeric NOT NULL DEFAULT 1 CHECK (weight >= 0),
  max_score numeric NOT NULL DEFAULT 100 CHECK (max_score > 0),
  sort_order int NOT NULL DEFAULT 0,
  UNIQUE (rubric_id, code)
);

CREATE INDEX IF NOT EXISTS oral_assessment_rubric_criteria_rubric_idx
  ON public.oral_assessment_rubric_criteria (rubric_id, sort_order);

-- ---------------------------------------------------------------------------
-- Interview blueprint (internal; attached for audit — lecturers never see prompts)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oral_assessment_blueprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.oral_assessment_assessments (id) ON DELETE CASCADE UNIQUE,
  version int NOT NULL DEFAULT 1 CHECK (version >= 1),
  -- Structured blueprint JSON: learning outcomes, primary Qs, follow-up logic,
  -- evidence required, rubric mapping, adaptive strategy
  blueprint jsonb NOT NULL DEFAULT '{}'::jsonb,
  question_bank jsonb NOT NULL DEFAULT '[]'::jsonb,
  adaptive_strategy jsonb NOT NULL DEFAULT '{}'::jsonb,
  engine_version text NOT NULL DEFAULT 'placeholder-v0',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Students (module-local; not Penny Teacher learners)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oral_assessment_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.oral_assessment_workspaces (id) ON DELETE CASCADE,
  -- Optional link to auth.users when student signs in with their own account
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  email text NOT NULL,
  full_name text NOT NULL DEFAULT '',
  student_number text NOT NULL DEFAULT '',
  -- Accessibility accommodations (Sprint 0: schema only)
  locale text NOT NULL DEFAULT 'en',
  extra_time_multiplier numeric NOT NULL DEFAULT 1.0
    CHECK (extra_time_multiplier >= 1.0 AND extra_time_multiplier <= 3.0),
  alternative_response_format text
    CHECK (
      alternative_response_format IS NULL
      OR alternative_response_format IN ('speech', 'text', 'both')
    ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, email)
);

CREATE INDEX IF NOT EXISTS oral_assessment_students_workspace_idx
  ON public.oral_assessment_students (workspace_id);
CREATE INDEX IF NOT EXISTS oral_assessment_students_user_idx
  ON public.oral_assessment_students (user_id)
  WHERE user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Invitations / enrolments (student ↔ assessment)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oral_assessment_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.oral_assessment_assessments (id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.oral_assessment_students (id) ON DELETE CASCADE,
  invite_token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'started', 'completed', 'expired', 'revoked')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assessment_id, student_id)
);

CREATE INDEX IF NOT EXISTS oral_assessment_invitations_assessment_idx
  ON public.oral_assessment_invitations (assessment_id, status);

-- ---------------------------------------------------------------------------
-- Interview sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oral_assessment_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.oral_assessment_assessments (id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.oral_assessment_students (id) ON DELETE CASCADE,
  invitation_id uuid REFERENCES public.oral_assessment_invitations (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'briefing'
    CHECK (status IN (
      'briefing',
      'in_progress',
      'paused',
      'completed',
      'abandoned',
      'failed'
    )),
  -- Unique pathway for this student (no two identical interviews)
  question_pathway jsonb NOT NULL DEFAULT '[]'::jsonb,
  interview_engine_version text NOT NULL DEFAULT 'placeholder-v0',
  ai_model_version text,
  started_at timestamptz,
  completed_at timestamptz,
  -- Future optional media (NOT continuous video by default)
  temporary_video_path text,
  identity_snapshots jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oral_assessment_sessions_assessment_idx
  ON public.oral_assessment_sessions (assessment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS oral_assessment_sessions_student_idx
  ON public.oral_assessment_sessions (student_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Transcript turns (primary evidence store — not continuous video)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oral_assessment_transcript_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.oral_assessment_sessions (id) ON DELETE CASCADE,
  turn_index int NOT NULL CHECK (turn_index >= 0),
  role text NOT NULL CHECK (role IN ('system', 'examiner', 'student')),
  content text NOT NULL DEFAULT '',
  -- Adaptive metadata
  question_code text,
  learning_outcome_code text,
  bloom_level text,
  response_format text NOT NULL DEFAULT 'text'
    CHECK (response_format IN ('text', 'speech', 'mixed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, turn_index)
);

CREATE INDEX IF NOT EXISTS oral_assessment_transcript_turns_session_idx
  ON public.oral_assessment_transcript_turns (session_id, turn_index);

-- ---------------------------------------------------------------------------
-- Scores (AI recommends; educator awards final)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oral_assessment_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.oral_assessment_sessions (id) ON DELETE CASCADE UNIQUE,
  -- AI recommendation
  recommended_mark numeric,
  confidence_score numeric CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)),
  rubric_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  dimension_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- knowledge, application, reasoning, critical_thinking, communication,
  -- authenticity_of_understanding, consistency_with_submitted_work
  strengths jsonb NOT NULL DEFAULT '[]'::jsonb,
  weaknesses jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggested_lecturer_feedback text NOT NULL DEFAULT '',
  suggested_final_comment text NOT NULL DEFAULT '',
  evidence_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  scoring_engine_version text NOT NULL DEFAULT 'placeholder-v0',
  scoring_model_version text,
  -- Educator final award (editable)
  final_mark numeric,
  final_comment text NOT NULL DEFAULT '',
  lecturer_edited boolean NOT NULL DEFAULT false,
  marked_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  marked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Integrity flags (understanding mismatch — never auto-accuse)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oral_assessment_integrity_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.oral_assessment_sessions (id) ON DELETE CASCADE,
  flag_type text NOT NULL
    CHECK (flag_type IN (
      'understanding_mismatch',
      'inconsistent_responses',
      'needs_lecturer_review',
      'other'
    )),
  severity text NOT NULL DEFAULT 'review'
    CHECK (severity IN ('info', 'review', 'high')),
  summary text NOT NULL DEFAULT '',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Never auto-accuse; lecturer resolves
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'reviewed', 'dismissed', 'escalated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oral_assessment_integrity_flags_session_idx
  ON public.oral_assessment_integrity_flags (session_id);

-- ---------------------------------------------------------------------------
-- Official assessment report / audit record
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oral_assessment_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.oral_assessment_sessions (id) ON DELETE CASCADE UNIQUE,
  assessment_id uuid NOT NULL REFERENCES public.oral_assessment_assessments (id) ON DELETE CASCADE,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_model_version text,
  engine_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oral_assessment_reports_assessment_idx
  ON public.oral_assessment_reports (assessment_id, generated_at DESC);

-- ---------------------------------------------------------------------------
-- Audit trail (every meaningful event)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oral_assessment_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.oral_assessment_workspaces (id) ON DELETE SET NULL,
  assessment_id uuid REFERENCES public.oral_assessment_assessments (id) ON DELETE SET NULL,
  session_id uuid REFERENCES public.oral_assessment_sessions (id) ON DELETE SET NULL,
  actor_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oral_assessment_audit_events_assessment_idx
  ON public.oral_assessment_audit_events (assessment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS oral_assessment_audit_events_session_idx
  ON public.oral_assessment_audit_events (session_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Future LMS integration stubs (architecture only — do not build sync yet)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oral_assessment_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.oral_assessment_workspaces (id) ON DELETE CASCADE,
  provider text NOT NULL
    CHECK (provider IN (
      'moodle',
      'canvas',
      'blackboard',
      'google_classroom',
      'microsoft_teams',
      'sis',
      'other'
    )),
  external_course_id text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'disabled'
    CHECK (status IN ('disabled', 'configured', 'active', 'error')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider)
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.oral_assessment_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oral_assessment_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oral_assessment_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oral_assessment_rubrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oral_assessment_rubric_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oral_assessment_blueprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oral_assessment_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oral_assessment_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oral_assessment_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oral_assessment_transcript_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oral_assessment_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oral_assessment_integrity_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oral_assessment_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oral_assessment_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oral_assessment_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY oral_assessment_workspaces_owner ON public.oral_assessment_workspaces
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY oral_assessment_assessments_owner ON public.oral_assessment_assessments
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY oral_assessment_files_owner ON public.oral_assessment_files
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY oral_assessment_rubrics_owner ON public.oral_assessment_rubrics
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.oral_assessment_assessments a
      WHERE a.id = assessment_id AND a.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.oral_assessment_assessments a
      WHERE a.id = assessment_id AND a.owner_id = auth.uid()
    )
  );

CREATE POLICY oral_assessment_rubric_criteria_owner ON public.oral_assessment_rubric_criteria
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.oral_assessment_rubrics r
      JOIN public.oral_assessment_assessments a ON a.id = r.assessment_id
      WHERE r.id = rubric_id AND a.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.oral_assessment_rubrics r
      JOIN public.oral_assessment_assessments a ON a.id = r.assessment_id
      WHERE r.id = rubric_id AND a.owner_id = auth.uid()
    )
  );

CREATE POLICY oral_assessment_blueprints_owner ON public.oral_assessment_blueprints
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.oral_assessment_assessments a
      WHERE a.id = assessment_id AND a.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.oral_assessment_assessments a
      WHERE a.id = assessment_id AND a.owner_id = auth.uid()
    )
  );

CREATE POLICY oral_assessment_students_workspace_owner ON public.oral_assessment_students
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.oral_assessment_workspaces w
      WHERE w.id = workspace_id AND w.owner_id = auth.uid()
    )
    OR user_id = auth.uid()
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.oral_assessment_workspaces w
      WHERE w.id = workspace_id AND w.owner_id = auth.uid()
    )
    OR user_id = auth.uid()
  );

CREATE POLICY oral_assessment_invitations_access ON public.oral_assessment_invitations
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.oral_assessment_assessments a
      WHERE a.id = assessment_id AND a.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.oral_assessment_students s
      WHERE s.id = student_id AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.oral_assessment_assessments a
      WHERE a.id = assessment_id AND a.owner_id = auth.uid()
    )
  );

CREATE POLICY oral_assessment_sessions_access ON public.oral_assessment_sessions
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.oral_assessment_assessments a
      WHERE a.id = assessment_id AND a.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.oral_assessment_students s
      WHERE s.id = student_id AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.oral_assessment_assessments a
      WHERE a.id = assessment_id AND a.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.oral_assessment_students s
      WHERE s.id = student_id AND s.user_id = auth.uid()
    )
  );

CREATE POLICY oral_assessment_transcript_turns_access ON public.oral_assessment_transcript_turns
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.oral_assessment_sessions sess
      JOIN public.oral_assessment_assessments a ON a.id = sess.assessment_id
      LEFT JOIN public.oral_assessment_students s ON s.id = sess.student_id
      WHERE sess.id = session_id
        AND (a.owner_id = auth.uid() OR s.user_id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.oral_assessment_sessions sess
      JOIN public.oral_assessment_assessments a ON a.id = sess.assessment_id
      LEFT JOIN public.oral_assessment_students s ON s.id = sess.student_id
      WHERE sess.id = session_id
        AND (a.owner_id = auth.uid() OR s.user_id = auth.uid())
    )
  );

CREATE POLICY oral_assessment_scores_access ON public.oral_assessment_scores
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.oral_assessment_sessions sess
      JOIN public.oral_assessment_assessments a ON a.id = sess.assessment_id
      LEFT JOIN public.oral_assessment_students s ON s.id = sess.student_id
      WHERE sess.id = session_id
        AND (a.owner_id = auth.uid() OR s.user_id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.oral_assessment_sessions sess
      JOIN public.oral_assessment_assessments a ON a.id = sess.assessment_id
      WHERE sess.id = session_id AND a.owner_id = auth.uid()
    )
  );

CREATE POLICY oral_assessment_integrity_flags_owner ON public.oral_assessment_integrity_flags
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.oral_assessment_sessions sess
      JOIN public.oral_assessment_assessments a ON a.id = sess.assessment_id
      WHERE sess.id = session_id AND a.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.oral_assessment_sessions sess
      JOIN public.oral_assessment_assessments a ON a.id = sess.assessment_id
      WHERE sess.id = session_id AND a.owner_id = auth.uid()
    )
  );

CREATE POLICY oral_assessment_reports_access ON public.oral_assessment_reports
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.oral_assessment_assessments a
      WHERE a.id = assessment_id AND a.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.oral_assessment_sessions sess
      JOIN public.oral_assessment_students s ON s.id = sess.student_id
      WHERE sess.id = session_id AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.oral_assessment_assessments a
      WHERE a.id = assessment_id AND a.owner_id = auth.uid()
    )
  );

CREATE POLICY oral_assessment_audit_events_owner ON public.oral_assessment_audit_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.oral_assessment_workspaces w
      WHERE w.id = workspace_id AND w.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.oral_assessment_assessments a
      WHERE a.id = assessment_id AND a.owner_id = auth.uid()
    )
  );

CREATE POLICY oral_assessment_audit_events_insert ON public.oral_assessment_audit_events
  FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid());

CREATE POLICY oral_assessment_integrations_owner ON public.oral_assessment_integrations
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.oral_assessment_workspaces w
      WHERE w.id = workspace_id AND w.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.oral_assessment_workspaces w
      WHERE w.id = workspace_id AND w.owner_id = auth.uid()
    )
  );

GRANT ALL ON public.oral_assessment_workspaces TO authenticated, service_role;
GRANT ALL ON public.oral_assessment_assessments TO authenticated, service_role;
GRANT ALL ON public.oral_assessment_files TO authenticated, service_role;
GRANT ALL ON public.oral_assessment_rubrics TO authenticated, service_role;
GRANT ALL ON public.oral_assessment_rubric_criteria TO authenticated, service_role;
GRANT ALL ON public.oral_assessment_blueprints TO authenticated, service_role;
GRANT ALL ON public.oral_assessment_students TO authenticated, service_role;
GRANT ALL ON public.oral_assessment_invitations TO authenticated, service_role;
GRANT ALL ON public.oral_assessment_sessions TO authenticated, service_role;
GRANT ALL ON public.oral_assessment_transcript_turns TO authenticated, service_role;
GRANT ALL ON public.oral_assessment_scores TO authenticated, service_role;
GRANT ALL ON public.oral_assessment_integrity_flags TO authenticated, service_role;
GRANT ALL ON public.oral_assessment_reports TO authenticated, service_role;
GRANT ALL ON public.oral_assessment_audit_events TO authenticated, service_role;
GRANT ALL ON public.oral_assessment_integrations TO authenticated, service_role;

-- Storage bucket for assessment uploads (private, 50 MB)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('oral-assessment', 'oral-assessment', false, 52428800)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY oral_assessment_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'oral-assessment' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY oral_assessment_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'oral-assessment' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY oral_assessment_storage_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'oral-assessment' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY oral_assessment_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'oral-assessment' AND (storage.foldername(name))[1] = auth.uid()::text);
