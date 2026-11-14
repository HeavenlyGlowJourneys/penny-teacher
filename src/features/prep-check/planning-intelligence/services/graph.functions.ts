import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ensureCurrentAcademicYear,
  ensureTerminology,
  requireFounder,
  workspaceIdFor,
} from "@/features/prep-check/planning-intelligence/services/pie-shared";
import { DEFAULT_TERMINOLOGY } from "@/features/prep-check/planning-intelligence/types";

export const listAcademicYears = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    requireFounder(context);
    const workspaceId = await workspaceIdFor(context);
    await ensureTerminology(context, workspaceId);
    await ensureCurrentAcademicYear(context, workspaceId);

    const { data, error } = await context.supabase
      .from("prep_check_academic_years" as never)
      .select("id, label, starts_on, ends_on, is_current, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw new Error("Could not list academic years.");
    return JSON.parse(JSON.stringify(data ?? []));
  });

export const createAcademicYear = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        label: z.string().min(1).max(80),
        startsOn: z.string().max(20).nullable().optional(),
        endsOn: z.string().max(20).nullable().optional(),
        setCurrent: z.boolean().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ context, data }) => {
    requireFounder(context);
    const workspaceId = await workspaceIdFor(context);
    const setCurrent = data.setCurrent !== false;

    if (setCurrent) {
      await context.supabase
        .from("prep_check_academic_years" as never)
        .update({ is_current: false } as never)
        .eq("workspace_id", workspaceId);
    }

    const { data: row, error } = await context.supabase
      .from("prep_check_academic_years" as never)
      .insert({
        workspace_id: workspaceId,
        label: data.label,
        starts_on: data.startsOn ?? null,
        ends_on: data.endsOn ?? null,
        is_current: setCurrent,
      } as never)
      .select("id, label, is_current")
      .single();
    if (error || !row) throw new Error("Could not create academic year.");
    return row as { id: string; label: string; is_current: boolean };
  });

export const setCurrentAcademicYear = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ academicYearId: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    requireFounder(context);
    const workspaceId = await workspaceIdFor(context);
    await context.supabase
      .from("prep_check_academic_years" as never)
      .update({ is_current: false } as never)
      .eq("workspace_id", workspaceId);
    const { error } = await context.supabase
      .from("prep_check_academic_years" as never)
      .update({ is_current: true } as never)
      .eq("id", data.academicYearId)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error("Could not set current year.");
    return { ok: true };
  });

export const getTerminology = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    requireFounder(context);
    const workspaceId = await workspaceIdFor(context);
    await ensureTerminology(context, workspaceId);
    const { data, error } = await context.supabase
      .from("prep_check_terminology" as never)
      .select("id, canonical_key, display_label, sort_order")
      .eq("workspace_id", workspaceId)
      .order("sort_order");
    if (error) throw new Error("Could not load terminology.");
    return JSON.parse(JSON.stringify(data ?? []));
  });

export const updateTerminology = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        items: z
          .array(
            z.object({
              canonical_key: z.string().min(1).max(60),
              display_label: z.string().min(1).max(80),
            }),
          )
          .min(1)
          .max(40),
      })
      .parse(raw),
  )
  .handler(async ({ context, data }) => {
    requireFounder(context);
    const workspaceId = await workspaceIdFor(context);
    for (const item of data.items) {
      const seed = DEFAULT_TERMINOLOGY.find((t) => t.canonical_key === item.canonical_key);
      await context.supabase.from("prep_check_terminology" as never).upsert(
        {
          workspace_id: workspaceId,
          canonical_key: item.canonical_key,
          display_label: item.display_label,
          sort_order: seed?.sort_order ?? 100,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "workspace_id,canonical_key" },
      );
    }
    return { ok: true };
  });

export const getPlanningGraph = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        academicYearId: z.string().uuid().optional(),
        subjectId: z.string().uuid().nullable().optional(),
        stageId: z.string().uuid().nullable().optional(),
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

    let nodesQuery = context.supabase
      .from("prep_check_planning_nodes" as never)
      .select(
        "id, parent_id, canonical_type, display_label, subject_id, stage_id, source_document_id, sort_order",
      )
      .eq("academic_year_id", year.id)
      .order("sort_order")
      .limit(400);

    if (data.subjectId) nodesQuery = nodesQuery.eq("subject_id", data.subjectId);
    // Include null subject nodes when filtering so school-level nodes remain
    const { data: nodes, error: nErr } = await nodesQuery;
    if (nErr) throw new Error("Could not load planning nodes.");

    let filtered = (nodes ?? []) as Array<Record<string, unknown>>;
    if (data.subjectId) {
      const { data: allNodes } = await context.supabase
        .from("prep_check_planning_nodes" as never)
        .select(
          "id, parent_id, canonical_type, display_label, subject_id, stage_id, source_document_id, sort_order",
        )
        .eq("academic_year_id", year.id)
        .limit(400);
      filtered = ((allNodes ?? []) as Array<Record<string, unknown>>).filter(
        (n) => !n.subject_id || n.subject_id === data.subjectId,
      );
    }
    if (data.stageId) {
      filtered = filtered.filter((n) => !n.stage_id || n.stage_id === data.stageId);
    }

    const nodeIds = filtered.map((n) => n.id as string);
    let edges: unknown[] = [];
    if (nodeIds.length) {
      const { data: edgeRows } = await context.supabase
        .from("prep_check_planning_edges" as never)
        .select("id, from_node_id, to_node_id, relation, confidence")
        .eq("academic_year_id", year.id)
        .in("from_node_id", nodeIds)
        .limit(800);
      edges = (edgeRows ?? []).filter((e: { to_node_id: string }) =>
        nodeIds.includes(e.to_node_id),
      );
    }

    const { data: terminology } = await context.supabase
      .from("prep_check_terminology" as never)
      .select("canonical_key, display_label")
      .eq("workspace_id", workspaceId);

    const { data: concepts } = await context.supabase
      .from("prep_check_concept_mentions" as never)
      .select("concept_label, mention_kind, document_id, confidence")
      .eq("academic_year_id", year.id)
      .limit(200);

    return {
      academicYearId: year.id,
      nodes: JSON.parse(JSON.stringify(filtered)),
      edges: JSON.parse(JSON.stringify(edges)),
      terminology: JSON.parse(JSON.stringify(terminology ?? [])),
      concepts: JSON.parse(JSON.stringify(concepts ?? [])),
    };
  });
