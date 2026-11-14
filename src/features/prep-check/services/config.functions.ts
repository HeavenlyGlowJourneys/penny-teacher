import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { canUsePrepCheck } from "@/features/prep-check/access";
import { DEFAULT_STAGE_SEEDS, DEFAULT_SUBJECT_SEEDS } from "@/features/prep-check/types";

type AuthCtx = {
  claims: unknown;
  userId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
};

function requireFounder(context: AuthCtx) {
  const email = (context.claims as { email?: string } | null)?.email ?? null;
  if (!canUsePrepCheck(email)) throw new Error("Forbidden");
}

async function getOrCreateWorkspace(context: AuthCtx) {
  const { data: existing } = await context.supabase
    .from("prep_check_workspaces" as never)
    .select("id, name")
    .eq("owner_id", context.userId)
    .maybeSingle();

  if (existing) {
    return existing as { id: string; name: string };
  }

  const { data: ws, error } = await context.supabase
    .from("prep_check_workspaces" as never)
    .insert({ owner_id: context.userId, name: "My school" } as never)
    .select("id, name")
    .single();
  if (error || !ws) throw new Error("Could not create Prep Check workspace.");

  const workspace = ws as { id: string; name: string };
  await context.supabase
    .from("prep_check_school_config" as never)
    .insert({ workspace_id: workspace.id } as never);
  await context.supabase
    .from("prep_check_cognitive_profiles" as never)
    .insert({ workspace_id: workspace.id } as never);
  await context.supabase.from("prep_check_subjects" as never).insert(
    DEFAULT_SUBJECT_SEEDS.map((name, i) => ({
      workspace_id: workspace.id,
      name,
      sort_order: i,
    })) as never,
  );
  await context.supabase.from("prep_check_stages" as never).insert(
    DEFAULT_STAGE_SEEDS.map((s) => ({
      workspace_id: workspace.id,
      ...s,
    })) as never,
  );
  return workspace;
}

export const ensurePrepCheckWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    requireFounder(context);
    const ws = await getOrCreateWorkspace(context);
    return { workspaceId: ws.id, name: ws.name, created: true };
  });

export const getPrepCheckConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    requireFounder(context);
    const ws = await getOrCreateWorkspace(context);

    const [school, subjects, stages, cognitive] = await Promise.all([
      context.supabase
        .from("prep_check_school_config" as never)
        .select("*")
        .eq("workspace_id", ws.id)
        .maybeSingle(),
      context.supabase
        .from("prep_check_subjects" as never)
        .select("*")
        .eq("workspace_id", ws.id)
        .order("sort_order"),
      context.supabase
        .from("prep_check_stages" as never)
        .select("*")
        .eq("workspace_id", ws.id)
        .order("sort_order"),
      context.supabase
        .from("prep_check_cognitive_profiles" as never)
        .select("*")
        .eq("workspace_id", ws.id)
        .maybeSingle(),
    ]);

    return {
      workspace: { id: ws.id, name: ws.name },
      school: (school.data ?? null) as Record<string, string> | null,
      subjects: (subjects.data ?? []) as Array<Record<string, string>>,
      stages: (stages.data ?? []) as Array<Record<string, string>>,
      cognitive: (cognitive.data ?? null) as Record<string, string | number> | null,
    };
  });

const SchoolUpdate = z.object({
  curriculum_frameworks: z.string().max(20000).optional(),
  annual_teaching_plans: z.string().max(20000).optional(),
  assessment_policy: z.string().max(20000).optional(),
  homework_policy: z.string().max(20000).optional(),
  department_policy: z.string().max(20000).optional(),
  moderation_checklist: z.string().max(20000).optional(),
  school_improvement_goals: z.string().max(20000).optional(),
  planning_expectations: z.string().max(20000).optional(),
});

export const updatePrepCheckSchoolConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SchoolUpdate.parse(raw))
  .handler(async ({ context, data }) => {
    requireFounder(context);
    const ws = await getOrCreateWorkspace(context);
    const { error } = await context.supabase
      .from("prep_check_school_config" as never)
      .update({ ...data, updated_at: new Date().toISOString() } as never)
      .eq("workspace_id", ws.id);
    if (error) throw new Error("Could not save school configuration.");
    return { ok: true };
  });

const SubjectUpdate = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  teaching_expectations: z.string().max(20000).optional(),
  assessment_expectations: z.string().max(20000).optional(),
  review_criteria: z.string().max(20000).optional(),
  examples: z.string().max(20000).optional(),
});

export const updatePrepCheckSubject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SubjectUpdate.parse(raw))
  .handler(async ({ context, data }) => {
    requireFounder(context);
    const { id, ...rest } = data;
    const { error } = await context.supabase
      .from("prep_check_subjects" as never)
      .update({ ...rest, updated_at: new Date().toISOString() } as never)
      .eq("id", id);
    if (error) throw new Error("Could not save subject.");
    return { ok: true };
  });

const StageUpdate = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  learner_development: z.string().max(20000).optional(),
  pacing: z.string().max(20000).optional(),
  cognitive_ability: z.string().max(20000).optional(),
  assessment_difficulty: z.string().max(20000).optional(),
  classroom_experience: z.string().max(20000).optional(),
});

export const updatePrepCheckStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => StageUpdate.parse(raw))
  .handler(async ({ context, data }) => {
    requireFounder(context);
    const { id, ...rest } = data;
    const { error } = await context.supabase
      .from("prep_check_stages" as never)
      .update({ ...rest, updated_at: new Date().toISOString() } as never)
      .eq("id", id);
    if (error) throw new Error("Could not save stage.");
    return { ok: true };
  });

const CognitiveUpdate = z.object({
  level1_pct: z.number().min(0).max(100),
  level2_pct: z.number().min(0).max(100),
  level3_pct: z.number().min(0).max(100),
  level1_label: z.string().max(80).optional(),
  level2_label: z.string().max(80).optional(),
  level3_label: z.string().max(80).optional(),
});

export const updatePrepCheckCognitive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => CognitiveUpdate.parse(raw))
  .handler(async ({ context, data }) => {
    requireFounder(context);
    const sum = data.level1_pct + data.level2_pct + data.level3_pct;
    if (Math.abs(sum - 100) > 0.5) {
      throw new Error("Cognitive levels must add up to 100%.");
    }
    const ws = await getOrCreateWorkspace(context);
    const { error } = await context.supabase
      .from("prep_check_cognitive_profiles" as never)
      .update({ ...data, updated_at: new Date().toISOString() } as never)
      .eq("workspace_id", ws.id);
    if (error) throw new Error("Could not save cognitive profile.");
    return { ok: true };
  });
