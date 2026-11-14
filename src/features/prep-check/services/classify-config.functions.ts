import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { canUsePrepCheck } from "@/features/prep-check/access";

const SCHOOL_KEYS = [
  "curriculum_frameworks",
  "annual_teaching_plans",
  "assessment_policy",
  "homework_policy",
  "department_policy",
  "moderation_checklist",
  "school_improvement_goals",
  "planning_expectations",
] as const;

const SUBJECT_KEYS = [
  "teaching_expectations",
  "assessment_expectations",
  "review_criteria",
  "examples",
] as const;

const STAGE_KEYS = [
  "learner_development",
  "pacing",
  "cognitive_ability",
  "assessment_difficulty",
  "classroom_experience",
] as const;

const ClassifyInput = z.object({
  fileName: z.string().max(300),
  documentText: z.string().min(20).max(50_000),
  subjectNames: z.array(z.string()).max(40),
  stageNames: z.array(z.string()).max(20),
});

const ClassifyResult = z.object({
  documentType: z.string(),
  summary: z.string(),
  schoolUpdates: z.record(z.string(), z.string()).default({}),
  subjectUpdates: z
    .array(
      z.object({
        subjectName: z.string(),
        fields: z.record(z.string(), z.string()),
      }),
    )
    .default([]),
  stageUpdates: z
    .array(
      z.object({
        stageName: z.string(),
        fields: z.record(z.string(), z.string()),
      }),
    )
    .default([]),
  confidence: z.number().min(0).max(100),
  notes: z.array(z.string()).default([]),
});

export type ConfigClassifyResult = z.infer<typeof ClassifyResult>;

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(fence ? fence[1].trim() : trimmed);
}

export const classifyConfigDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ClassifyInput.parse(raw))
  .handler(async ({ context, data }) => {
    const email = (context.claims as { email?: string } | null)?.email ?? null;
    if (!canUsePrepCheck(email)) throw new Error("Forbidden");

    const { assertAiRateLimit } = await import("@/lib/ai-rate-limit.server");
    await assertAiRateLimit(context.userId);

    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("AI is not configured.");
    const model = process.env.GEMINI_MODEL || "gemini-flash-latest";

    const system = `You classify school curriculum/policy documents into Prep Check configuration buckets.

Return STRICT JSON only:
{
  "documentType": string,
  "summary": string,
  "schoolUpdates": { "<field>": "<concise content to store>" },
  "subjectUpdates": [{ "subjectName": string, "fields": { "<field>": string } }],
  "stageUpdates": [{ "stageName": string, "fields": { "<field>": string } }],
  "confidence": number,
  "notes": string[]
}

Allowed schoolUpdates keys ONLY:
${SCHOOL_KEYS.join(", ")}

Allowed subject field keys ONLY:
${SUBJECT_KEYS.join(", ")}

Allowed stage field keys ONLY:
${STAGE_KEYS.join(", ")}

Rules:
- Put content only where it belongs. Omit buckets that do not apply.
- Prefer matching subjectName / stageName to the provided lists when possible.
- Summarise into useful config text (not a full dump of the source).
- If the file is an ATP, prefer annual_teaching_plans (+ subject fields if subject-specific).
- If assessment policy/memo rules → assessment_policy.
- If moderation checklist → moderation_checklist.
- If SIP / goals → school_improvement_goals.
- If CAPS/curriculum framework → curriculum_frameworks.
- Stage guidance (e.g. Stage 4 pacing) → stageUpdates.
- confidence 0–100.`;

    const user = `Filename: ${data.fileName}

Known subjects: ${data.subjectNames.join(", ") || "(none)"}
Known stages: ${data.stageNames.join(", ") || "(none)"}

DOCUMENT TEXT:
${data.documentText}`;

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
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { response_mime_type: "application/json" },
        }),
      },
    );

    if (resp.status === 429) {
      throw new Error("Penny is a bit busy — try again in a moment.");
    }
    if (!resp.ok) {
      console.error("[prep-check] classify error", resp.status, await resp.text());
      throw new Error("Could not classify that document.");
    }

    const json = await resp.json();
    const content: string | undefined = json?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("");
    if (!content) throw new Error("Empty AI response.");

    const parsed = ClassifyResult.parse(extractJson(content));

    // Strip unknown keys
    const schoolUpdates: Record<string, string> = {};
    for (const k of SCHOOL_KEYS) {
      const v = parsed.schoolUpdates[k];
      if (typeof v === "string" && v.trim()) schoolUpdates[k] = v.trim();
    }

    const subjectUpdates = parsed.subjectUpdates
      .map((u) => {
        const fields: Record<string, string> = {};
        for (const k of SUBJECT_KEYS) {
          const v = u.fields[k];
          if (typeof v === "string" && v.trim()) fields[k] = v.trim();
        }
        return { subjectName: u.subjectName, fields };
      })
      .filter((u) => Object.keys(u.fields).length > 0);

    const stageUpdates = parsed.stageUpdates
      .map((u) => {
        const fields: Record<string, string> = {};
        for (const k of STAGE_KEYS) {
          const v = u.fields[k];
          if (typeof v === "string" && v.trim()) fields[k] = v.trim();
        }
        return { stageName: u.stageName, fields };
      })
      .filter((u) => Object.keys(u.fields).length > 0);

    return {
      documentType: parsed.documentType,
      summary: parsed.summary,
      schoolUpdates,
      subjectUpdates,
      stageUpdates,
      confidence: parsed.confidence,
      notes: parsed.notes,
    };
  });
