import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  transcript: z.string().min(1).max(4000),
  totalMarks: z.number().positive(),
  learnerNames: z.array(z.string()).max(500),
});

export type AiParsedEntry =
  | { kind: "mark"; name: string; mark: number }
  | { kind: "absent"; name: string };

/**
 * Use Gemini to extract structured (learner, mark|absent) pairs from a
 * messy spoken transcript. Falls back to empty array on any failure — the
 * caller already has client-side parsing.
 */
export const parseTranscriptWithAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => Input.parse(raw))
  .handler(async ({ data, context }) => {
    const { assertAiRateLimit } = await import("@/lib/ai-rate-limit.server");
    await assertAiRateLimit(context.userId);

    const key = process.env.GEMINI_API_KEY;
    if (!key) return { entries: [] as AiParsedEntry[] };

    const system = `You extract assessment marks from a teacher's spoken transcript.
Return STRICT JSON: { "entries": [{ "name": string, "mark": number|null, "absent": boolean }] }.
- "name" must match one of the provided learner names exactly when possible.
- "mark" is a number 0..${data.totalMarks}. If learner is absent, set mark=null and absent=true.
- Ignore filler words ("um", "okay", "next"). Ignore self-corrections — keep the latest value spoken for a learner.
- If unsure, omit the entry. Do not invent learners.`;

    const user = `Total marks: ${data.totalMarks}
Learners: ${data.learnerNames.join(", ")}
Transcript:
"""
${data.transcript}
"""`;

    try {
      const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
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
      if (!resp.ok) {
        console.error("Gemini API error", resp.status, await resp.text());
        return { entries: [] as AiParsedEntry[] };
      }
      const json = await resp.json();
      const content: string | undefined = json?.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text ?? "")
        .join("");
      if (typeof content !== "string" || !content) return { entries: [] as AiParsedEntry[] };
      const parsed = JSON.parse(content);
      const raw = Array.isArray(parsed?.entries) ? parsed.entries : [];
      const entries: AiParsedEntry[] = [];
      for (const e of raw) {
        if (typeof e?.name !== "string") continue;
        if (e.absent === true) entries.push({ kind: "absent", name: e.name });
        else if (typeof e.mark === "number" && e.mark >= 0 && e.mark <= data.totalMarks) {
          entries.push({ kind: "mark", name: e.name, mark: e.mark });
        }
      }
      return { entries };
    } catch {
      return { entries: [] as AiParsedEntry[] };
    }
  });
