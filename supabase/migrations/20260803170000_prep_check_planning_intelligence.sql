-- Planning Intelligence Engine tables (under Prep Check).
-- Additive; removable with prep_check feature.

-- Academic year memory scope
CREATE TABLE IF NOT EXISTS public.prep_check_academic_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.prep_check_workspaces (id) ON DELETE CASCADE,
  label text NOT NULL,
  starts_on date,
  ends_on date,
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prep_check_academic_years_ws_idx
  ON public.prep_check_academic_years (workspace_id, is_current DESC, created_at DESC);

-- School terminology (canonical key → display label)
CREATE TABLE IF NOT EXISTS public.prep_check_terminology (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.prep_check_workspaces (id) ON DELETE CASCADE,
  canonical_key text NOT NULL,
  display_label text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, canonical_key)
);

-- Ingested documents
-- intended_subject_id / intended_stage_id pin a document to a grade during
-- multi-grade upload sessions: the AI may refine document type but must not
-- move the document to another grade.
CREATE TABLE IF NOT EXISTS public.prep_check_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.prep_check_workspaces (id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES public.prep_check_academic_years (id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  file_name text NOT NULL,
  mime_type text,
  storage_path text,
  checksum text,
  extract_status text NOT NULL DEFAULT 'pending'
    CHECK (extract_status IN ('pending', 'ready', 'partial', 'failed')),
  extract_kind text,
  excerpt text,
  extract_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  warning text,
  intended_subject_id uuid REFERENCES public.prep_check_subjects (id) ON DELETE SET NULL,
  intended_stage_id uuid REFERENCES public.prep_check_stages (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- If prep_check_documents already existed from a partial earlier run without
-- these columns, CREATE TABLE IF NOT EXISTS above is a no-op — add them now.
ALTER TABLE public.prep_check_documents
  ADD COLUMN IF NOT EXISTS intended_subject_id uuid
    REFERENCES public.prep_check_subjects (id) ON DELETE SET NULL;
ALTER TABLE public.prep_check_documents
  ADD COLUMN IF NOT EXISTS intended_stage_id uuid
    REFERENCES public.prep_check_stages (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS prep_check_documents_year_idx
  ON public.prep_check_documents (academic_year_id, created_at DESC);
CREATE INDEX IF NOT EXISTS prep_check_documents_owner_idx
  ON public.prep_check_documents (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS prep_check_documents_scope_idx
  ON public.prep_check_documents (intended_subject_id, intended_stage_id);

-- Classification metadata
CREATE TABLE IF NOT EXISTS public.prep_check_document_meta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.prep_check_documents (id) ON DELETE CASCADE UNIQUE,
  document_type text NOT NULL DEFAULT 'other',
  subject_id uuid REFERENCES public.prep_check_subjects (id) ON DELETE SET NULL,
  stage_id uuid REFERENCES public.prep_check_stages (id) ON DELETE SET NULL,
  subject_label text,
  stage_label text,
  term_label text,
  period_label text,
  planning_level text,
  confidence numeric NOT NULL DEFAULT 0,
  needs_clarification boolean NOT NULL DEFAULT false,
  summary text,
  raw_classification jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Planning hierarchy nodes.
-- A subject root node has stage_id NULL; each grade hangs off it as a child
-- scoped by (subject_id, stage_id), leaving room for cross-grade analysis later.
CREATE TABLE IF NOT EXISTS public.prep_check_planning_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.prep_check_workspaces (id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES public.prep_check_academic_years (id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.prep_check_planning_nodes (id) ON DELETE SET NULL,
  canonical_type text NOT NULL,
  display_label text NOT NULL,
  subject_id uuid REFERENCES public.prep_check_subjects (id) ON DELETE SET NULL,
  stage_id uuid REFERENCES public.prep_check_stages (id) ON DELETE SET NULL,
  source_document_id uuid REFERENCES public.prep_check_documents (id) ON DELETE SET NULL,
  sort_order int NOT NULL DEFAULT 0,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prep_check_planning_nodes_year_idx
  ON public.prep_check_planning_nodes (academic_year_id, canonical_type);
CREATE INDEX IF NOT EXISTS prep_check_planning_nodes_parent_idx
  ON public.prep_check_planning_nodes (parent_id);
CREATE INDEX IF NOT EXISTS prep_check_planning_nodes_scope_idx
  ON public.prep_check_planning_nodes (academic_year_id, subject_id, stage_id);

-- Relationship edges
CREATE TABLE IF NOT EXISTS public.prep_check_planning_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.prep_check_workspaces (id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES public.prep_check_academic_years (id) ON DELETE CASCADE,
  from_node_id uuid NOT NULL REFERENCES public.prep_check_planning_nodes (id) ON DELETE CASCADE,
  to_node_id uuid NOT NULL REFERENCES public.prep_check_planning_nodes (id) ON DELETE CASCADE,
  relation text NOT NULL,
  confidence numeric NOT NULL DEFAULT 70,
  source_document_id uuid REFERENCES public.prep_check_documents (id) ON DELETE SET NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_node_id, to_node_id, relation)
);

CREATE INDEX IF NOT EXISTS prep_check_planning_edges_year_idx
  ON public.prep_check_planning_edges (academic_year_id);

-- Clarification Q&A
CREATE TABLE IF NOT EXISTS public.prep_check_clarifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.prep_check_workspaces (id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.prep_check_documents (id) ON DELETE CASCADE,
  question text NOT NULL,
  answer text,
  applied boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz
);

CREATE INDEX IF NOT EXISTS prep_check_clarifications_doc_idx
  ON public.prep_check_clarifications (document_id, created_at DESC);

-- Concept mentions (taught-before-assessed checks; subject/stage scoped so a
-- future Grade 4→7 progression report can join without a redesign)
CREATE TABLE IF NOT EXISTS public.prep_check_concept_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.prep_check_workspaces (id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES public.prep_check_academic_years (id) ON DELETE CASCADE,
  concept_label text NOT NULL,
  mention_kind text NOT NULL DEFAULT 'mentioned'
    CHECK (mention_kind IN ('introduced', 'practised', 'revised', 'assessed', 'mastered', 'omitted', 'mentioned')),
  document_id uuid REFERENCES public.prep_check_documents (id) ON DELETE SET NULL,
  node_id uuid REFERENCES public.prep_check_planning_nodes (id) ON DELETE SET NULL,
  subject_id uuid REFERENCES public.prep_check_subjects (id) ON DELETE SET NULL,
  stage_id uuid REFERENCES public.prep_check_stages (id) ON DELETE SET NULL,
  confidence numeric NOT NULL DEFAULT 60,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.prep_check_concept_mentions
  ADD COLUMN IF NOT EXISTS subject_id uuid
    REFERENCES public.prep_check_subjects (id) ON DELETE SET NULL;
ALTER TABLE public.prep_check_concept_mentions
  ADD COLUMN IF NOT EXISTS stage_id uuid
    REFERENCES public.prep_check_stages (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS prep_check_concept_mentions_year_idx
  ON public.prep_check_concept_mentions (academic_year_id, concept_label);
CREATE INDEX IF NOT EXISTS prep_check_concept_mentions_scope_idx
  ON public.prep_check_concept_mentions (subject_id, stage_id, concept_label);

-- Link reviews to academic year (additive column)
ALTER TABLE public.prep_check_reviews
  ADD COLUMN IF NOT EXISTS academic_year_id uuid
    REFERENCES public.prep_check_academic_years (id) ON DELETE SET NULL;

-- RLS
ALTER TABLE public.prep_check_academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prep_check_terminology ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prep_check_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prep_check_document_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prep_check_planning_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prep_check_planning_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prep_check_clarifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prep_check_concept_mentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY prep_check_academic_years_owner ON public.prep_check_academic_years
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

CREATE POLICY prep_check_terminology_owner ON public.prep_check_terminology
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

CREATE POLICY prep_check_documents_owner ON public.prep_check_documents
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY prep_check_document_meta_owner ON public.prep_check_document_meta
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.prep_check_documents d
      WHERE d.id = document_id AND d.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.prep_check_documents d
      WHERE d.id = document_id AND d.owner_id = auth.uid()
    )
  );

CREATE POLICY prep_check_planning_nodes_owner ON public.prep_check_planning_nodes
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

CREATE POLICY prep_check_planning_edges_owner ON public.prep_check_planning_edges
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

CREATE POLICY prep_check_clarifications_owner ON public.prep_check_clarifications
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

CREATE POLICY prep_check_concept_mentions_owner ON public.prep_check_concept_mentions
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

GRANT ALL ON public.prep_check_academic_years TO authenticated, service_role;
GRANT ALL ON public.prep_check_terminology TO authenticated, service_role;
GRANT ALL ON public.prep_check_documents TO authenticated, service_role;
GRANT ALL ON public.prep_check_document_meta TO authenticated, service_role;
GRANT ALL ON public.prep_check_planning_nodes TO authenticated, service_role;
GRANT ALL ON public.prep_check_planning_edges TO authenticated, service_role;
GRANT ALL ON public.prep_check_clarifications TO authenticated, service_role;
GRANT ALL ON public.prep_check_concept_mentions TO authenticated, service_role;
