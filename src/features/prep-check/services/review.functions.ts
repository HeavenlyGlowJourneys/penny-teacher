import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { canUsePrepCheck } from "@/features/prep-check/access";
import { PrepCheckReportSchema, type PrepCheckReport, type PrepCheckWorkflow } from "@/features/prep-check/types";
import { PIE_CROSS_DOCUMENT_REVIEW_SYSTEM } from "@/features/prep-check/planning-intelligence/prompts/cross-document-review";
import {
  callGeminiJson,
  ensureCurrentAcademicYear,
  ensureTerminology,
  extractJson,
  workspaceIdFor,
  type AuthCtx,
} from "@/features/prep-check/planning-intelligence/services/pie-shared";

function requireFounder(context: AuthCtx) {
  const email = (context.claims as { email?: string } | null)?.email ?? null;
  if (!canUsePrepCheck(email)) throw new Error("Forbidden");
}

const RunInput = z.object({
  workflow: z.enum(["teacher_prep", "subject_head_review"]),
  subjectId: z.string().uuid().nullable(),
  stageId: z.string().uuid().nullable(),
  academicYearId: z.string().uuid().optional(),
  title: z.string().min(1).max(200).default("Planning model review"),
  /** Optional extra corpus from newly uploaded files (already ingested separately preferred). */
  extraCorpus: z.string().max(80_000).optional(),
  manifest: z
    .array(
      z.object({
        path: z.string(),
        size: z.number(),
        kind: z.string(),
        extractedChars: z.number(),
      }),
    )
    .max(120)
    .optional(),
  warnings: z.array(z.string()).max(100).optional(),
  zipStoragePath: z.string().max(500).nullable().optional(),
});

export const runPrepCheckReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => RunInput.parse(raw))
  .handler(async ({ context, data }) => {
    requireFounder(context);
    const { assertAiRateLimit } = await import("@/lib/ai-rate-limit.server");
    await assertAiRateLimit(context.userId);

    const wsId = await workspaceIdFor(context);
    await ensureTerminology(context, wsId);
    const year = data.academicYearId
      ? { id: data.academicYearId }
      : await ensureCurrentAcademicYear(context, wsId);

    const [school, subject, stage, cognitive, terminology] = await Promise.all([
      context.supabase
        .from("prep_check_school_config" as never)
        .select("*")
        .eq("workspace_id", wsId)
        .maybeSingle(),
      data.subjectId
        ? context.supabase
            .from("prep_check_subjects" as never)
            .select("*")
            .eq("id", data.subjectId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      data.stageId
        ? context.supabase
            .from("prep_check_stages" as never)
            .select("*")
            .eq("id", data.stageId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      context.supabase
        .from("prep_check_cognitive_profiles" as never)
        .select("*")
        .eq("workspace_id", wsId)
        .maybeSingle(),
      context.supabase
        .from("prep_check_terminology" as never)
        .select("canonical_key, display_label")
        .eq("workspace_id", wsId),
    ]);

    // Load planning subgraph
    const { data: allNodes } = await context.supabase
      .from("prep_check_planning_nodes" as never)
      .select(
        "id, parent_id, canonical_type, display_label, subject_id, stage_id, source_document_id",
      )
      .eq("academic_year_id", year.id)
      .limit(400);

    let nodes = (allNodes ?? []) as Array<Record<string, unknown>>;
    if (data.subjectId) {
      nodes = nodes.filter((n) => !n.subject_id || n.subject_id === data.subjectId);
    }
    if (data.stageId) {
      nodes = nodes.filter((n) => !n.stage_id || n.stage_id === data.stageId);
    }
    const nodeIds = nodes.map((n) => n.id as string);

    const { data: edges } = nodeIds.length
      ? await context.supabase
          .from("prep_check_planning_edges" as never)
          .select("from_node_id, to_node_id, relation, confidence")
          .eq("academic_year_id", year.id)
          .in("from_node_id", nodeIds)
          .limit(800)
      : { data: [] };

    const filteredEdges = ((edges ?? []) as Array<{ to_node_id: string }>).filter((e) =>
      nodeIds.includes(e.to_node_id),
    );

    const { data: docs } = await context.supabase
      .from("prep_check_documents" as never)
      .select(
        "id, file_name, excerpt, extract_kind, prep_check_document_meta(document_type, subject_label, stage_label, term_label, period_label, confidence, summary)",
      )
      .eq("academic_year_id", year.id)
      .eq("owner_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(80);

    let documents = (docs ?? []) as Array<Record<string, unknown>>;

    const { data: concepts } = await context.supabase
      .from("prep_check_concept_mentions" as never)
      .select("concept_label, mention_kind, confidence")
      .eq("academic_year_id", year.id)
      .limit(150);

    const docSummaries = documents.map((d) => {
      const meta = Array.isArray(d.prep_check_document_meta)
        ? d.prep_check_document_meta[0]
        : d.prep_check_document_meta;
      return {
        id: d.id,
        fileName: d.file_name,
        kind: d.extract_kind,
        meta,
        excerpt: String(d.excerpt ?? "").slice(0, 2500),
      };
    });

    if (nodes.length === 0 && documents.length === 0 && !(data.extraCorpus?.length)) {
      throw new Error(
        "No planning documents in this academic year yet. Upload files in the Library first.",
      );
    }

    const { data: reviewRow, error: insErr } = await context.supabase
      .from("prep_check_reviews" as never)
      .insert({
        workspace_id: wsId,
        owner_id: context.userId,
        workflow: data.workflow,
        subject_id: data.subjectId,
        stage_id: data.stageId,
        academic_year_id: year.id,
        status: "processing",
        title: data.title,
        zip_storage_path: data.zipStoragePath ?? null,
        file_manifest: data.manifest ?? documents.map((d) => ({
          path: String(d.file_name),
          size: 0,
          kind: String(d.extract_kind ?? "other"),
          extractedChars: String(d.excerpt ?? "").length,
        })),
        corpus_excerpt: JSON.stringify({
          nodeCount: nodes.length,
          edgeCount: filteredEdges.length,
          docCount: documents.length,
        }).slice(0, 8000),
      } as never)
      .select("id")
      .single();

    if (insErr || !reviewRow) {
      console.error(insErr);
      throw new Error("Could not start review.");
    }
    const reviewId = (reviewRow as { id: string }).id;

    const workflowLabel =
      data.workflow === "teacher_prep"
        ? "Teacher Prep Check (coaching tone for the teacher)"
        : "Subject Head Review (moderation report for HOD)";

    const userPrompt = `Workflow: ${workflowLabel}

School configuration:
${JSON.stringify(school.data ?? {}, null, 2)}

Subject configuration:
${JSON.stringify(subject.data ?? { note: "Not specified" }, null, 2)}

Stage configuration:
${JSON.stringify(stage.data ?? { note: "Not specified" }, null, 2)}

Cognitive targets:
${JSON.stringify(cognitive.data ?? { level1_pct: 50, level2_pct: 35, level3_pct: 15 }, null, 2)}

School terminology (use these labels in the report):
${JSON.stringify(terminology.data ?? [], null, 2)}

PLANNING GRAPH NODES:
${JSON.stringify(nodes, null, 2)}

PLANNING GRAPH EDGES:
${JSON.stringify(filteredEdges, null, 2)}

CLASSIFIED DOCUMENTS (excerpts):
${JSON.stringify(docSummaries, null, 2)}

CONCEPT MENTIONS:
${JSON.stringify(concepts ?? [], null, 2)}

EXTRA CORPUS (optional newly uploaded text):
${data.extraCorpus ?? "(none)"}

Extraction warnings:
${JSON.stringify(data.warnings ?? [], null, 2)}
`;

    try {
      const raw = await callGeminiJson(PIE_CROSS_DOCUMENT_REVIEW_SYSTEM, userPrompt);
      const parsed = PrepCheckReportSchema.parse(extractJson(raw));

      await context.supabase
        .from("prep_check_reviews" as never)
        .update({
          status: "ready",
          report: parsed,
          confidence: parsed.confidence,
          overall_rating: parsed.overallRating,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", reviewId);

      return { reviewId, report: parsed, workflow: data.workflow as PrepCheckWorkflow };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Review failed";
      await context.supabase
        .from("prep_check_reviews" as never)
        .update({
          status: "failed",
          error_message: message.slice(0, 500),
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", reviewId);
      throw new Error(message);
    }
  });

export const getPrepCheckReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ reviewId: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    requireFounder(context);
    const { data: row, error } = await context.supabase
      .from("prep_check_reviews" as never)
      .select("*")
      .eq("id", data.reviewId)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (error || !row) throw new Error("Review not found.");
    const cloned = JSON.parse(JSON.stringify(row)) as {
      id: string;
      title: string;
      workflow: string;
      status: string;
      report: PrepCheckReport | null;
      error_message: string | null;
      overall_rating: string | null;
      confidence: number | null;
    };
    return cloned;
  });

export const listPrepCheckReviews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    requireFounder(context);
    const { data, error } = await context.supabase
      .from("prep_check_reviews" as never)
      .select("id, title, workflow, status, overall_rating, confidence, created_at")
      .eq("owner_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error("Could not list reviews.");
    return JSON.parse(JSON.stringify(data ?? [])) as Array<{
      id: string;
      title: string;
      workflow: string;
      status: string;
      overall_rating: string | null;
      confidence: number | null;
      created_at: string;
    }>;
  });
