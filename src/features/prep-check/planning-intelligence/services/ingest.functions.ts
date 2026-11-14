import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  callGeminiJson,
  ensureCurrentAcademicYear,
  ensureTerminology,
  extractJson,
  matchNameToId,
  requireFounder,
  workspaceIdFor,
  type AuthCtx,
} from "@/features/prep-check/planning-intelligence/services/pie-shared";
import { PIE_CLASSIFY_SYSTEM } from "@/features/prep-check/planning-intelligence/prompts/classify";
import { PIE_LINK_GRAPH_SYSTEM } from "@/features/prep-check/planning-intelligence/prompts/link-graph";
import {
  CONFIDENCE_CLARIFY_THRESHOLD,
  DocumentClassificationSchema,
  GraphLinkProposalSchema,
  type ExtractedFilePayload,
} from "@/features/prep-check/planning-intelligence/types";

const IngestFileSchema = z.object({
  academicYearId: z.string().uuid().optional(),
  fileName: z.string().min(1).max(400),
  mimeType: z.string().max(200).nullable().optional(),
  text: z.string().min(1).max(80_000),
  kind: z.string().max(40),
  warning: z.string().max(500).optional(),
  storagePath: z.string().max(500).nullable().optional(),
  checksum: z.string().max(128).nullable().optional(),
  visionBase64: z.string().max(5_000_000).optional(),
  visionMime: z.string().max(100).optional(),
  /** Multi-grade session: pin document into this subject × grade hierarchy */
  forceSubjectId: z.string().uuid().optional(),
  forceStageId: z.string().uuid().optional(),
});

export type PlanningDocumentMeta = {
  document_type: string;
  subject_label: string | null;
  stage_label: string | null;
  term_label: string | null;
  period_label: string | null;
  confidence: number;
  needs_clarification: boolean;
  summary: string | null;
  subject_id: string | null;
  stage_id: string | null;
};

export type PlanningDocumentRow = {
  id: string;
  file_name: string;
  extract_status: string;
  extract_kind: string | null;
  warning: string | null;
  created_at: string;
  intended_subject_id: string | null;
  intended_stage_id: string | null;
  prep_check_document_meta: PlanningDocumentMeta | PlanningDocumentMeta[] | null;
};

async function loadSubjectStageLists(context: AuthCtx, workspaceId: string) {
  const [subjects, stages, terminology] = await Promise.all([
    context.supabase
      .from("prep_check_subjects" as never)
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .order("sort_order"),
    context.supabase
      .from("prep_check_stages" as never)
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .order("sort_order"),
    context.supabase
      .from("prep_check_terminology" as never)
      .select("canonical_key, display_label")
      .eq("workspace_id", workspaceId)
      .order("sort_order"),
  ]);
  return {
    subjects: (subjects.data ?? []) as Array<{ id: string; name: string }>,
    stages: (stages.data ?? []) as Array<{ id: string; name: string }>,
    terminology: (terminology.data ?? []) as Array<{ canonical_key: string; display_label: string }>,
  };
}

async function ensureGradeRootNode(
  context: AuthCtx,
  workspaceId: string,
  academicYearId: string,
  subjectId: string | null,
  stageId: string | null,
  lists: { subjects: Array<{ id: string; name: string }>; stages: Array<{ id: string; name: string }> },
): Promise<string | null> {
  if (!subjectId || !stageId) return null;
  const subjectName = lists.subjects.find((s) => s.id === subjectId)?.name ?? "Subject";
  const stageName = lists.stages.find((s) => s.id === stageId)?.name ?? "Grade";

  const { data: existing } = await context.supabase
    .from("prep_check_planning_nodes" as never)
    .select("id")
    .eq("academic_year_id", academicYearId)
    .eq("subject_id", subjectId)
    .eq("stage_id", stageId)
    .eq("canonical_type", "block")
    .ilike("display_label", `%${stageName}%`)
    .limit(1)
    .maybeSingle();
  if (existing) return (existing as { id: string }).id;

  // Subject root (shared across grades within subject — future cross-grade attach point)
  let subjectRootId: string | null = null;
  const { data: subRoot } = await context.supabase
    .from("prep_check_planning_nodes" as never)
    .select("id")
    .eq("academic_year_id", academicYearId)
    .eq("subject_id", subjectId)
    .is("stage_id", null)
    .eq("canonical_type", "curriculum")
    .limit(1)
    .maybeSingle();
  if (subRoot) {
    subjectRootId = (subRoot as { id: string }).id;
  } else {
    const { data: createdSub } = await context.supabase
      .from("prep_check_planning_nodes" as never)
      .insert({
        workspace_id: workspaceId,
        academic_year_id: academicYearId,
        canonical_type: "curriculum",
        display_label: subjectName,
        subject_id: subjectId,
        stage_id: null,
        sort_order: 0,
      } as never)
      .select("id")
      .single();
    subjectRootId = createdSub ? (createdSub as { id: string }).id : null;
  }

  const { data: gradeNode } = await context.supabase
    .from("prep_check_planning_nodes" as never)
    .insert({
      workspace_id: workspaceId,
      academic_year_id: academicYearId,
      parent_id: subjectRootId,
      canonical_type: "block",
      display_label: `${subjectName} — ${stageName}`,
      subject_id: subjectId,
      stage_id: stageId,
      sort_order: 10,
      meta: { grade_workspace: true },
    } as never)
    .select("id")
    .single();

  return gradeNode ? (gradeNode as { id: string }).id : null;
}

async function classifyAndLinkDocument(
  context: AuthCtx,
  workspaceId: string,
  academicYearId: string,
  docId: string,
  payload: ExtractedFilePayload,
  forced?: { subjectId?: string; stageId?: string },
) {
  const lists = await loadSubjectStageLists(context, workspaceId);

  const forcedSubjectName = forced?.subjectId
    ? lists.subjects.find((s) => s.id === forced.subjectId)?.name
    : null;
  const forcedStageName = forced?.stageId
    ? lists.stages.find((s) => s.id === forced.stageId)?.name
    : null;

  const userText = `File name (weak hint only): ${payload.fileName}
Extract kind: ${payload.kind}
School subjects: ${lists.subjects.map((s) => s.name).join(", ") || "(none)"}
School stages/grades: ${lists.stages.map((s) => s.name).join(", ") || "(none)"}
School terminology: ${JSON.stringify(lists.terminology)}
${forcedSubjectName ? `FORCED SUBJECT (must use): ${forcedSubjectName}` : ""}
${forcedStageName ? `FORCED GRADE/STAGE (must use): ${forcedStageName}` : ""}

DOCUMENT TEXT:
${payload.text}
`;

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
    { text: userText },
  ];
  if (payload.visionBase64 && payload.visionMime) {
    parts.push({
      inlineData: { mimeType: payload.visionMime, data: payload.visionBase64 },
    });
  }

  const raw = await callGeminiJson(PIE_CLASSIFY_SYSTEM, userText, parts);
  const classification = DocumentClassificationSchema.parse(extractJson(raw));

  let subjectId =
    forced?.subjectId ?? matchNameToId(lists.subjects, classification.subjectLabel);
  let stageId = forced?.stageId ?? matchNameToId(lists.stages, classification.stageLabel);

  if (forced?.subjectId) {
    classification.subjectLabel = forcedSubjectName ?? classification.subjectLabel;
  }
  if (forced?.stageId) {
    classification.stageLabel = forcedStageName ?? classification.stageLabel;
  }

  const needsClarification =
    !forced?.subjectId &&
    !forced?.stageId &&
    (classification.confidence < CONFIDENCE_CLARIFY_THRESHOLD ||
      Boolean(classification.clarificationQuestion));

  await context.supabase.from("prep_check_document_meta" as never).upsert(
    {
      document_id: docId,
      document_type: classification.documentType,
      subject_id: subjectId,
      stage_id: stageId,
      subject_label: classification.subjectLabel ?? null,
      stage_label: classification.stageLabel ?? null,
      term_label: classification.termLabel ?? null,
      period_label: classification.periodLabel ?? null,
      planning_level: classification.planningLevel ?? null,
      confidence: forced?.subjectId || forced?.stageId
        ? Math.max(classification.confidence, 85)
        : classification.confidence,
      needs_clarification: needsClarification,
      summary: classification.summary,
      raw_classification: classification,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "document_id" },
  );

  if (needsClarification && classification.clarificationQuestion) {
    await context.supabase.from("prep_check_clarifications" as never).insert({
      workspace_id: workspaceId,
      document_id: docId,
      question: classification.clarificationQuestion,
    } as never);
  }

  for (const c of classification.concepts.slice(0, 40)) {
    await context.supabase.from("prep_check_concept_mentions" as never).insert({
      workspace_id: workspaceId,
      academic_year_id: academicYearId,
      concept_label: c.label.slice(0, 200),
      mention_kind: c.kind,
      document_id: docId,
      subject_id: subjectId,
      stage_id: stageId,
      confidence: classification.confidence,
    } as never);
  }

  const gradeRootId = await ensureGradeRootNode(
    context,
    workspaceId,
    academicYearId,
    subjectId,
    stageId,
    lists,
  );

  // Link into grade-scoped graph
  let nodesQuery = context.supabase
    .from("prep_check_planning_nodes" as never)
    .select("id, canonical_type, display_label, parent_id, subject_id, stage_id")
    .eq("academic_year_id", academicYearId)
    .limit(200);
  if (subjectId) nodesQuery = nodesQuery.eq("subject_id", subjectId);
  if (stageId) nodesQuery = nodesQuery.eq("stage_id", stageId);
  const { data: existingNodes } = await nodesQuery;

  const linkUser = `New document id: ${docId}
Classification: ${JSON.stringify(classification)}
School terminology: ${JSON.stringify(lists.terminology)}
Grade workspace root node id (parent new nodes under this when unsure): ${gradeRootId ?? "none"}
Existing nodes in THIS grade only (reuse labels when matching):
${JSON.stringify(existingNodes ?? [], null, 2)}

Document excerpt:
${payload.text.slice(0, 12_000)}
`;

  try {
    const linkRaw = await callGeminiJson(PIE_LINK_GRAPH_SYSTEM, linkUser);
    const proposal = GraphLinkProposalSchema.parse(extractJson(linkRaw));
    const tempToId = new Map<string, string>();

    const existing = (existingNodes ?? []) as Array<{
      id: string;
      canonical_type: string;
      display_label: string;
    }>;

    for (const n of proposal.nodes) {
      const match = existing.find(
        (e) =>
          e.canonical_type === n.canonicalType &&
          e.display_label.trim().toLowerCase() === n.displayLabel.trim().toLowerCase(),
      );
      if (match) {
        tempToId.set(n.tempId, match.id);
        continue;
      }
      const { data: created } = await context.supabase
        .from("prep_check_planning_nodes" as never)
        .insert({
          workspace_id: workspaceId,
          academic_year_id: academicYearId,
          parent_id: gradeRootId,
          canonical_type: n.canonicalType,
          display_label: n.displayLabel.slice(0, 300),
          subject_id: subjectId,
          stage_id: stageId,
          source_document_id: docId,
        } as never)
        .select("id")
        .single();
      if (created) tempToId.set(n.tempId, (created as { id: string }).id);
    }

    for (const n of proposal.nodes) {
      const id = tempToId.get(n.tempId);
      const parentId = n.parentTempId ? tempToId.get(n.parentTempId) : gradeRootId;
      if (id && parentId) {
        await context.supabase
          .from("prep_check_planning_nodes" as never)
          .update({ parent_id: parentId } as never)
          .eq("id", id);
      }
    }

    for (const e of proposal.edges) {
      const fromId = tempToId.get(e.fromTempId);
      const toId = tempToId.get(e.toTempId);
      if (!fromId || !toId || fromId === toId) continue;
      await context.supabase.from("prep_check_planning_edges" as never).upsert(
        {
          workspace_id: workspaceId,
          academic_year_id: academicYearId,
          from_node_id: fromId,
          to_node_id: toId,
          relation: e.relation,
          confidence: e.confidence,
          source_document_id: docId,
        } as never,
        { onConflict: "from_node_id,to_node_id,relation" },
      );
    }
  } catch (err) {
    console.error("[prep-check/pie] graph link failed", err);
    await context.supabase.from("prep_check_planning_nodes" as never).insert({
      workspace_id: workspaceId,
      academic_year_id: academicYearId,
      parent_id: gradeRootId,
      canonical_type:
        classification.documentType === "annual_plan"
          ? "annual_plan"
          : classification.documentType === "assessment"
            ? "assessment"
            : classification.documentType === "memorandum"
              ? "memorandum"
              : classification.documentType === "rubric"
                ? "rubric"
                : classification.documentType === "policy"
                  ? "policy"
                  : classification.documentType === "calendar"
                    ? "calendar"
                    : classification.documentType === "curriculum"
                      ? "curriculum"
                      : "other",
      display_label: payload.fileName.replace(/\.[^.]+$/, "") || classification.summary.slice(0, 80),
      subject_id: subjectId,
      stage_id: stageId,
      source_document_id: docId,
    } as never);
  }

  return { classification, needsClarification, subjectId, stageId };
}

export const ingestPlanningDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => IngestFileSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireFounder(context);
    const { assertAiRateLimit } = await import("@/lib/ai-rate-limit.server");
    await assertAiRateLimit(context.userId);

    const workspaceId = await workspaceIdFor(context);
    await ensureTerminology(context, workspaceId);

    let yearId = data.academicYearId;
    if (!yearId) {
      const year = await ensureCurrentAcademicYear(context, workspaceId);
      yearId = year.id;
    } else {
      const { data: y } = await context.supabase
        .from("prep_check_academic_years" as never)
        .select("id")
        .eq("id", yearId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (!y) throw new Error("Academic year not found.");
    }

    const { data: doc, error } = await context.supabase
      .from("prep_check_documents" as never)
      .insert({
        workspace_id: workspaceId,
        academic_year_id: yearId,
        owner_id: context.userId,
        file_name: data.fileName,
        mime_type: data.mimeType ?? null,
        storage_path: data.storagePath ?? null,
        checksum: data.checksum ?? null,
        extract_status: data.warning ? "partial" : "ready",
        extract_kind: data.kind,
        excerpt: data.text.slice(0, 12_000),
        extract_meta: { chars: data.text.length },
        warning: data.warning ?? null,
        intended_subject_id: data.forceSubjectId ?? null,
        intended_stage_id: data.forceStageId ?? null,
      } as never)
      .select("id")
      .single();

    if (error || !doc) {
      console.error(error);
      throw new Error("Could not save document.");
    }
    const docId = (doc as { id: string }).id;

    const result = await classifyAndLinkDocument(
      context,
      workspaceId,
      yearId,
      docId,
      {
        fileName: data.fileName,
        mimeType: data.mimeType,
        text: data.text,
        kind: data.kind,
        warning: data.warning,
        visionBase64: data.visionBase64,
        visionMime: data.visionMime,
      },
      { subjectId: data.forceSubjectId, stageId: data.forceStageId },
    );

    return {
      documentId: docId,
      academicYearId: yearId,
      classification: result.classification,
      needsClarification: result.needsClarification,
      subjectId: result.subjectId,
      stageId: result.stageId,
    };
  });

export const listPlanningDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        academicYearId: z.string().uuid().optional(),
        subjectId: z.string().uuid().optional(),
        stageId: z.string().uuid().optional(),
      })
      .parse(raw ?? {}),
  )
  .handler(async ({ context, data }) => {
    requireFounder(context);
    const workspaceId = await workspaceIdFor(context);
    await ensureTerminology(context, workspaceId);
    const year = data.academicYearId
      ? { id: data.academicYearId }
      : await ensureCurrentAcademicYear(context, workspaceId);

    let query = context.supabase
      .from("prep_check_documents" as never)
      .select(
        "id, file_name, extract_status, extract_kind, warning, created_at, intended_subject_id, intended_stage_id, prep_check_document_meta(document_type, subject_label, stage_label, term_label, period_label, confidence, needs_clarification, summary, subject_id, stage_id)",
      )
      .eq("academic_year_id", year.id)
      .eq("owner_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(150);

    if (data.subjectId) query = query.eq("intended_subject_id", data.subjectId);
    if (data.stageId) query = query.eq("intended_stage_id", data.stageId);

    const { data: docs, error } = await query;
    if (error) {
      console.error(error);
      throw new Error("Could not list documents.");
    }

    const list = JSON.parse(JSON.stringify(docs ?? [])) as PlanningDocumentRow[];

    // Also include docs classified into this scope without intended_* set
    if (data.subjectId || data.stageId) {
      const { data: viaMeta } = await context.supabase
        .from("prep_check_documents" as never)
        .select(
          "id, file_name, extract_status, extract_kind, warning, created_at, intended_subject_id, intended_stage_id, prep_check_document_meta!inner(document_type, subject_label, stage_label, term_label, period_label, confidence, needs_clarification, summary, subject_id, stage_id)",
        )
        .eq("academic_year_id", year.id)
        .eq("owner_id", context.userId)
        .is("intended_subject_id", null)
        .order("created_at", { ascending: false })
        .limit(150);

      const extra = (
        JSON.parse(JSON.stringify(viaMeta ?? [])) as PlanningDocumentRow[]
      ).filter((d) => {
        const m = Array.isArray(d.prep_check_document_meta)
          ? d.prep_check_document_meta[0]
          : d.prep_check_document_meta;
        if (data.subjectId && m?.subject_id !== data.subjectId) return false;
        if (data.stageId && m?.stage_id !== data.stageId) return false;
        return true;
      });

      const seen = new Set(list.map((d) => d.id));
      for (const e of extra) {
        if (!seen.has(e.id)) list.push(e);
      }
    }

    return list;
  });
