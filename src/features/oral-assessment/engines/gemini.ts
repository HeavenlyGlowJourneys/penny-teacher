/**
 * Shared Gemini JSON helper for Oral Assessment engines.
 */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1].trim() : trimmed;
  return JSON.parse(body);
}

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export async function callOralGeminiJson(
  system: string,
  user: string,
  extraParts?: GeminiPart[],
): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("AI is not configured.");
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";

  const parts: GeminiPart[] = [{ text: user }, ...(extraParts ?? [])];

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
        contents: [{ role: "user", parts }],
        generationConfig: { response_mime_type: "application/json" },
      }),
    },
  );
  if (resp.status === 429) {
    throw new Error("Penny is a bit busy — try again in a moment.");
  }
  if (!resp.ok) {
    console.error("[oral-assessment] Gemini error", resp.status, await resp.text());
    throw new Error("AI request failed. Please try again.");
  }
  const json = await resp.json();
  const content: string | undefined = json?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text ?? "")
    .join("");
  if (!content) throw new Error("Empty AI response.");
  return content;
}
