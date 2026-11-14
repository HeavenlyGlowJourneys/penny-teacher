import { canUsePrepCheck } from "@/features/prep-check/access";
import { DEFAULT_TERMINOLOGY } from "@/features/prep-check/planning-intelligence/types";

export type AuthCtx = {
  claims: unknown;
  userId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
};

export function requireFounder(context: AuthCtx) {
  const email = (context.claims as { email?: string } | null)?.email ?? null;
  if (!canUsePrepCheck(email)) throw new Error("Forbidden");
}

export async function workspaceIdFor(context: AuthCtx): Promise<string> {
  const { data } = await context.supabase
    .from("prep_check_workspaces" as never)
    .select("id")
    .eq("owner_id", context.userId)
    .maybeSingle();
  if (!data) throw new Error("Create your Prep Check configuration first.");
  return (data as { id: string }).id;
}

export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1].trim() : trimmed;
  return JSON.parse(body);
}

export async function callGeminiJson(
  system: string,
  user: string,
  parts?: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>,
): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("AI is not configured.");
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";

  const userParts =
    parts && parts.length > 0 ? parts : [{ text: user }];

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: userParts }],
        generationConfig: { response_mime_type: "application/json" },
      }),
    },
  );
  if (resp.status === 429) {
    throw new Error("Penny is a bit busy — try again in a moment.");
  }
  if (!resp.ok) {
    console.error("[prep-check/pie] Gemini error", resp.status, await resp.text());
    throw new Error("AI request failed. Please try again.");
  }
  const json = await resp.json();
  const content: string | undefined = json?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text ?? "")
    .join("");
  if (!content) throw new Error("Empty AI response.");
  return content;
}

export async function ensureTerminology(context: AuthCtx, workspaceId: string) {
  const { data: existing } = await context.supabase
    .from("prep_check_terminology" as never)
    .select("id")
    .eq("workspace_id", workspaceId)
    .limit(1);
  if (existing && (existing as unknown[]).length > 0) return;

  await context.supabase.from("prep_check_terminology" as never).insert(
    DEFAULT_TERMINOLOGY.map((t) => ({
      workspace_id: workspaceId,
      canonical_key: t.canonical_key,
      display_label: t.display_label,
      sort_order: t.sort_order,
    })) as never,
  );
}

export async function ensureCurrentAcademicYear(
  context: AuthCtx,
  workspaceId: string,
): Promise<{ id: string; label: string }> {
  const { data: current } = await context.supabase
    .from("prep_check_academic_years" as never)
    .select("id, label")
    .eq("workspace_id", workspaceId)
    .eq("is_current", true)
    .maybeSingle();
  if (current) return current as { id: string; label: string };

  const { data: anyYear } = await context.supabase
    .from("prep_check_academic_years" as never)
    .select("id, label")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (anyYear) {
    await context.supabase
      .from("prep_check_academic_years" as never)
      .update({ is_current: true } as never)
      .eq("id", (anyYear as { id: string }).id);
    return anyYear as { id: string; label: string };
  }

  const year = new Date().getFullYear();
  const label = `${year}`;
  const { data: created, error } = await context.supabase
    .from("prep_check_academic_years" as never)
    .insert({
      workspace_id: workspaceId,
      label,
      is_current: true,
      starts_on: `${year}-01-01`,
      ends_on: `${year}-12-31`,
    } as never)
    .select("id, label")
    .single();
  if (error || !created) throw new Error("Could not create academic year.");
  return created as { id: string; label: string };
}

export function matchNameToId(
  rows: Array<{ id: string; name: string }>,
  label: string | null | undefined,
): string | null {
  if (!label?.trim()) return null;
  const n = label.trim().toLowerCase();
  const exact = rows.find((r) => r.name.trim().toLowerCase() === n);
  if (exact) return exact.id;
  const soft = rows.find(
    (r) => r.name.toLowerCase().includes(n) || n.includes(r.name.toLowerCase()),
  );
  return soft?.id ?? null;
}
