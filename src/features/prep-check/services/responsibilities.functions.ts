import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ensureCurrentAcademicYear,
  ensureTerminology,
  requireFounder,
  workspaceIdFor,
} from "@/features/prep-check/planning-intelligence/services/pie-shared";

export const getResponsibilities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    requireFounder(context);
    const workspaceId = await workspaceIdFor(context);

    const { data, error } = await context.supabase
      .from("prep_check_responsibilities" as never)
      .select(
        "id, subject_id, stage_id, sort_order, phase_label, prep_check_subjects(id, name), prep_check_stages(id, name, code, sort_order)",
      )
      .eq("workspace_id", workspaceId)
      .order("sort_order");
    if (error) {
      console.error(error);
      throw new Error("Could not load responsibilities.");
    }
    return JSON.parse(JSON.stringify(data ?? []));
  });

export const setResponsibilities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        items: z
          .array(
            z.object({
              subjectId: z.string().uuid(),
              stageId: z.string().uuid(),
              phaseLabel: z.string().max(80).nullable().optional(),
            }),
          )
          .max(80),
      })
      .parse(raw),
  )
  .handler(async ({ context, data }) => {
    requireFounder(context);
    const workspaceId = await workspaceIdFor(context);

    // Replace set for workspace (editable anytime)
    await context.supabase
      .from("prep_check_responsibilities" as never)
      .delete()
      .eq("workspace_id", workspaceId);

    if (data.items.length) {
      const rows = data.items.map((item, i) => ({
        workspace_id: workspaceId,
        subject_id: item.subjectId,
        stage_id: item.stageId,
        phase_label: item.phaseLabel ?? null,
        sort_order: i,
      }));
      const { error } = await context.supabase
        .from("prep_check_responsibilities" as never)
        .insert(rows as never);
      if (error) {
        console.error(error);
        throw new Error("Could not save responsibilities.");
      }
    }
    return { ok: true, count: data.items.length };
  });

export type GradeProgress = {
  stageId: string;
  stageName: string;
  stageCode: string;
  documentCount: number;
  nodeCount: number;
  clarificationCount: number;
  lastReview: {
    id: string;
    status: string;
    overall_rating: string | null;
    confidence: number | null;
    created_at: string;
    workflow: string;
  } | null;
  planningTypes: string[];
};

export const getSubjectDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        subjectId: z.string().uuid(),
        academicYearId: z.string().uuid().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ context, data }) => {
    requireFounder(context);
    const workspaceId = await workspaceIdFor(context);
    await ensureTerminology(context, workspaceId);
    const year = data.academicYearId
      ? { id: data.academicYearId }
      : await ensureCurrentAcademicYear(context, workspaceId);

    const { data: subject } = await context.supabase
      .from("prep_check_subjects" as never)
      .select("id, name")
      .eq("id", data.subjectId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!subject) throw new Error("Subject not found.");

    const { data: respRows } = await context.supabase
      .from("prep_check_responsibilities" as never)
      .select("stage_id, sort_order, prep_check_stages(id, name, code, sort_order)")
      .eq("workspace_id", workspaceId)
      .eq("subject_id", data.subjectId)
      .order("sort_order");

    let stages = ((respRows ?? []) as Array<{
      stage_id: string;
      prep_check_stages:
        | { id: string; name: string; code: string; sort_order: number }
        | { id: string; name: string; code: string; sort_order: number }[]
        | null;
    }>).map((r) => {
      const st = Array.isArray(r.prep_check_stages) ? r.prep_check_stages[0] : r.prep_check_stages;
      return st
        ? { id: st.id, name: st.name, code: st.code, sort_order: st.sort_order }
        : null;
    }).filter(Boolean) as Array<{ id: string; name: string; code: string; sort_order: number }>;

    // Fallback: all workspace stages if no responsibilities configured yet
    if (!stages.length) {
      const { data: allStages } = await context.supabase
        .from("prep_check_stages" as never)
        .select("id, name, code, sort_order")
        .eq("workspace_id", workspaceId)
        .order("sort_order");
      stages = (allStages ?? []) as Array<{
        id: string;
        name: string;
        code: string;
        sort_order: number;
      }>;
    }

    const grades: GradeProgress[] = [];

    for (const stage of stages) {
      const { data: docs } = await context.supabase
        .from("prep_check_documents" as never)
        .select(
          "id, intended_stage_id, prep_check_document_meta(document_type, stage_id, subject_id)",
        )
        .eq("academic_year_id", year.id)
        .eq("owner_id", context.userId);

      const matchingDocs = ((docs ?? []) as Array<{
        id: string;
        intended_stage_id: string | null;
        prep_check_document_meta:
          | { document_type: string; stage_id: string | null; subject_id: string | null }
          | Array<{ document_type: string; stage_id: string | null; subject_id: string | null }>
          | null;
      }>).filter((d) => {
        if (d.intended_stage_id === stage.id) {
          // intended subject checked below via meta or intended_subject
          return true;
        }
        const meta = Array.isArray(d.prep_check_document_meta)
          ? d.prep_check_document_meta[0]
          : d.prep_check_document_meta;
        return meta?.stage_id === stage.id && meta?.subject_id === data.subjectId;
      });

      // Prefer intended_subject when set
      const { count: intendedCount } = await context.supabase
        .from("prep_check_documents" as never)
        .select("id", { count: "exact", head: true })
        .eq("academic_year_id", year.id)
        .eq("intended_subject_id", data.subjectId)
        .eq("intended_stage_id", stage.id);

      const documentCount = Math.max(matchingDocs.length, intendedCount ?? 0);

      const { data: nodes } = await context.supabase
        .from("prep_check_planning_nodes" as never)
        .select("id, canonical_type")
        .eq("academic_year_id", year.id)
        .eq("subject_id", data.subjectId)
        .eq("stage_id", stage.id);

      const nodeList = (nodes ?? []) as Array<{ id: string; canonical_type: string }>;

      const { data: clarDocs } = await context.supabase
        .from("prep_check_documents" as never)
        .select("id")
        .eq("academic_year_id", year.id)
        .eq("intended_subject_id", data.subjectId)
        .eq("intended_stage_id", stage.id);

      const clarDocIds = ((clarDocs ?? []) as Array<{ id: string }>).map((d) => d.id);
      let clarificationCount = 0;
      if (clarDocIds.length) {
        const { count } = await context.supabase
          .from("prep_check_clarifications" as never)
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .is("answer", null)
          .in("document_id", clarDocIds);
        clarificationCount = count ?? 0;
      }

      const { data: reviews } = await context.supabase
        .from("prep_check_reviews" as never)
        .select("id, status, overall_rating, confidence, created_at, workflow")
        .eq("owner_id", context.userId)
        .eq("subject_id", data.subjectId)
        .eq("stage_id", stage.id)
        .order("created_at", { ascending: false })
        .limit(1);

      const lastReview = ((reviews ?? [])[0] as GradeProgress["lastReview"]) ?? null;
      const planningTypes = [...new Set(nodeList.map((n) => n.canonical_type))];

      grades.push({
        stageId: stage.id,
        stageName: stage.name,
        stageCode: stage.code,
        documentCount,
        nodeCount: nodeList.length,
        clarificationCount,
        lastReview,
        planningTypes,
      });
    }

    // Sibling subjects with responsibilities (for quick switch)
    const { data: allResp } = await context.supabase
      .from("prep_check_responsibilities" as never)
      .select("subject_id, prep_check_subjects(id, name)")
      .eq("workspace_id", workspaceId);

    const subjectMap = new Map<string, string>();
    for (const r of (allResp ?? []) as Array<{
      subject_id: string;
      prep_check_subjects: { id: string; name: string } | { id: string; name: string }[] | null;
    }>) {
      const sub = Array.isArray(r.prep_check_subjects)
        ? r.prep_check_subjects[0]
        : r.prep_check_subjects;
      if (sub) subjectMap.set(sub.id, sub.name);
    }

    return {
      academicYearId: year.id,
      subject: subject as { id: string; name: string },
      grades,
      siblingSubjects: [...subjectMap.entries()].map(([id, name]) => ({ id, name })),
    };
  });

export const listResponsibilitySubjects = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    requireFounder(context);
    const workspaceId = await workspaceIdFor(context);

    const { data: resp } = await context.supabase
      .from("prep_check_responsibilities" as never)
      .select("subject_id, prep_check_subjects(id, name)")
      .eq("workspace_id", workspaceId);

    const map = new Map<string, { id: string; name: string; gradeCount: number }>();
    for (const r of (resp ?? []) as Array<{
      subject_id: string;
      prep_check_subjects: { id: string; name: string } | { id: string; name: string }[] | null;
    }>) {
      const sub = Array.isArray(r.prep_check_subjects)
        ? r.prep_check_subjects[0]
        : r.prep_check_subjects;
      if (!sub) continue;
      const cur = map.get(sub.id);
      if (cur) cur.gradeCount += 1;
      else map.set(sub.id, { id: sub.id, name: sub.name, gradeCount: 1 });
    }

    if (map.size === 0) {
      const { data: subjects } = await context.supabase
        .from("prep_check_subjects" as never)
        .select("id, name")
        .eq("workspace_id", workspaceId)
        .order("sort_order");
      return ((subjects ?? []) as Array<{ id: string; name: string }>).map((s) => ({
        id: s.id,
        name: s.name,
        gradeCount: 0,
      }));
    }

    return [...map.values()];
  });
