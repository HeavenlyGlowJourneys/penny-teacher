import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { canUseOralAssessment } from "@/features/oral-assessment/access";

type AuthCtx = {
  claims: unknown;
  userId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
};

export function requireOralAccess(context: AuthCtx) {
  const email = (context.claims as { email?: string } | null)?.email ?? null;
  if (!canUseOralAssessment(email)) throw new Error("Forbidden");
}

export async function getOrCreateWorkspace(context: AuthCtx) {
  const { data: existing } = await context.supabase
    .from("oral_assessment_workspaces" as never)
    .select("id, name, institution_name, retention_days")
    .eq("owner_id", context.userId)
    .maybeSingle();

  if (existing) {
    return existing as {
      id: string;
      name: string;
      institution_name: string;
      retention_days: number;
    };
  }

  const { data: ws, error } = await context.supabase
    .from("oral_assessment_workspaces" as never)
    .insert({
      owner_id: context.userId,
      name: "My institution",
    } as never)
    .select("id, name, institution_name, retention_days")
    .single();

  if (error || !ws) throw new Error("Could not create Oral Assessment workspace.");
  return ws as {
    id: string;
    name: string;
    institution_name: string;
    retention_days: number;
  };
}

export async function writeAudit(
  context: AuthCtx,
  event: {
    workspace_id?: string | null;
    assessment_id?: string | null;
    session_id?: string | null;
    event_type: string;
    payload?: Record<string, unknown>;
  },
) {
  await context.supabase.from("oral_assessment_audit_events" as never).insert({
    workspace_id: event.workspace_id ?? null,
    assessment_id: event.assessment_id ?? null,
    session_id: event.session_id ?? null,
    actor_id: context.userId,
    event_type: event.event_type,
    payload: event.payload ?? {},
  } as never);
}

export const ensureOralAssessmentWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    requireOralAccess(context);
    const ws = await getOrCreateWorkspace(context);
    return {
      workspaceId: ws.id,
      name: ws.name,
      institutionName: ws.institution_name,
      retentionDays: ws.retention_days,
    };
  });

export const getOralAssessmentWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    requireOralAccess(context);
    const ws = await getOrCreateWorkspace(context);
    return {
      workspace: {
        id: ws.id,
        name: ws.name,
        institutionName: ws.institution_name,
        retentionDays: ws.retention_days,
      },
    };
  });
