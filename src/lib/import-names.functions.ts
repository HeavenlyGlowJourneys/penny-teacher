import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ImageInput = z.object({
  imageDataUrl: z
    .string()
    .startsWith("data:")
    .refine((s) => s.length <= 5_500_000, "Image is too large (max ~4 MB)."),
});

const TranscriptInput = z.object({
  transcript: z.string().min(1).max(8000),
});

type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

// Splits a "data:<mime>;base64,<data>" URL into Gemini's inline_data shape.
function dataUrlToInlineData(dataUrl: string): { mime_type: string; data: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) throw new Error("Invalid data URL");
  return { mime_type: match[1], data: match[2] };
}

async function callGateway(system: string, parts: GeminiPart[]): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts }],
          generationConfig: { response_mime_type: "application/json" },
        }),
      },
    );
    if (!resp.ok) {
      console.error("Gemini API error", resp.status, await resp.text());
      return null;
    }
    const j = await resp.json();
    const c: string | undefined = j?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("");
    return typeof c === "string" && c ? c : null;
  } catch (err) {
    console.error("Gemini API call failed", err);
    return null;
  }
}

function extractNames(raw: string): string[] {
  try {
    const j = JSON.parse(raw);
    const arr = Array.isArray(j?.names) ? j.names : Array.isArray(j) ? j : [];
    return arr
      .map((x: unknown) => String(x ?? "").trim())
      .filter((s: string) => s.length >= 2 && s.length <= 80)
      .map((s: string) =>
        s.replace(/^\d+[\.\)]\s*/, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean);
  } catch {
    return [];
  }
}

const SYSTEM_OCR = `You extract LEARNER NAMES from an image or PDF page of a South African school class list, register, spreadsheet, or WhatsApp screenshot.
Return STRICT JSON: { "names": ["First Last", ...] }.
Rules:
- Include only learner/student names, in the order they appear.
- IGNORE column headers, page titles, dates, grade labels, subject labels, register numbers, ID numbers, phone numbers, parent contacts, the teacher's own name, and totals.
- Clean each name: trim spaces, capitalize Like This, drop trailing/leading punctuation.
- Keep every name exactly as spelled, including uncommon spellings. Do not anglicize or invent names.
- If a row has "Surname, First Name", output "First Name Surname".
- Do NOT invent names. If nothing usable is visible, return { "names": [] }.`;

const SYSTEM_VOICE = `You extract learner names a teacher dictated.
Return STRICT JSON: { "names": ["First Last", ...] }.
Rules:
- One name per array entry, in the order spoken.
- Strip filler ("next", "okay", "and", "um", "uh", "comma", "new line").
- Keep every name exactly as spelled, including uncommon spellings. Do not anglicize or invent names.
- If the teacher says "Alex Morgan" treat that as a single learner.
- Capitalize Like This. Trim. No numbers or punctuation.`;

export const extractNamesFromImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ImageInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { assertAiRateLimit } = await import("@/lib/ai-rate-limit.server");
    await assertAiRateLimit(context.userId);

    const isPdf = data.imageDataUrl.startsWith("data:application/pdf");
    const parts: GeminiPart[] = [
      {
        text: isPdf
          ? "Extract all learner names from this class list PDF."
          : "Extract all learner names from this class list image.",
      },
      { inline_data: dataUrlToInlineData(data.imageDataUrl) },
    ];
    const out = await callGateway(SYSTEM_OCR, parts);
    return { names: out ? extractNames(out) : [] };
  });

export const extractNamesFromTranscript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => TranscriptInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { assertAiRateLimit } = await import("@/lib/ai-rate-limit.server");
    await assertAiRateLimit(context.userId);

    const out = await callGateway(SYSTEM_VOICE, [{ text: data.transcript }]);
    return { names: out ? extractNames(out) : [] };
  });
