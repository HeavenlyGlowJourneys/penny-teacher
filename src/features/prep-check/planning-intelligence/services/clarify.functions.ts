import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  callGeminiJson,
  extractJson,
  matchNameToId,
  requireFounder,
  workspaceIdFor,
} from "@/features/prep-check/planning-intelligence/services/pie-shared";
import { DocumentClassificationSchema } from "@/features/prep-check/planning-intelligence/types";
import { PIE_CLASSIFY_SYSTEM } from "@/features/prep-check/planning-intelligence/prompts/classify";

export const listOpenClarifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ academicYearId: z.string().uuid().optional() }).parse(raw ?? {}),
  )
  .handler(async ({ context, data }) => {
    requireFounder(context);
    const workspaceId = await workspaceIdFor(context);

    let query = context.supabase
      .from("prep_check_clarifications" as never)
      .select(
        "id, document_id, question, answer, applied, created_at, prep_check_documents(file_name, academic_year_id)",
      )
      .eq("workspace_id", workspaceId)
      .is("answer", null)
      .order("created_at", { ascending: false })
      .limit(40);

    const { data: rows, error } = await query;
    if (error) throw new Error("Could not load clarifications.");

    let list = JSON.parse(JSON.stringify(rows ?? [])) as Array<{
      id: string;
      document_id: string;
      question: string;
      prep_check_documents?: { file_name: string; academic_year_id: string };
    }>;

    if (data.academicYearId) {
      list = list.filter(
        (r) => r.prep_check_documents?.academic_year_id === data.academicYearId,
      );
    }
    return list;
  });

export const answerClarification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        clarificationId: z.string().uuid(),
        answer: z.string().min(1).max(2000),
      })
      .parse(raw),
  )
  .handler(async ({ context, data }) => {
    requireFounder(context);
    const { assertAiRateLimit } = await import("@/lib/ai-rate-limit.server");
    await assertAiRateLimit(context.userId);
    const workspaceId = await workspaceIdFor(context);

    const { data: row, error } = await context.supabase
      .from("prep_check_clarifications" as never)
      .select("id, document_id, question")
      .eq("id", data.clarificationId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error || !row) throw new Error("Clarification not found.");

    const clar = row as { id: string; document_id: string; question: string };

    await context.supabase
      .from("prep_check_clarifications" as never)
      .update({
        answer: data.answer,
        answered_at: new Date().toISOString(),
      } as never)
      .eq("id", clar.id);

    const { data: doc } = await context.supabase
      .from("prep_check_documents" as never)
      .select("id, file_name, excerpt, extract_kind, academic_year_id")
      .eq("id", clar.document_id)
      .maybeSingle();
    if (!doc) throw new Error("Document missing.");

    const document = doc as {
      id: string;
      file_name: string;
      excerpt: string;
      extract_kind: string;
      academic_year_id: string;
    };

    const [subjects, stages, terminology] = await Promise.all([
      context.supabase
        .from("prep_check_subjects" as never)
        .select("id, name")
        .eq("workspace_id", workspaceId),
      context.supabase
        .from("prep_check_stages" as never)
        .select("id, name")
        .eq("workspace_id", workspaceId),
      context.supabase
        .from("prep_check_terminology" as never)
        .select("canonical_key, display_label")
        .eq("workspace_id", workspaceId),
    ]);

    const subjectList = (subjects.data ?? []) as Array<{ id: string; name: string }>;
    const stageList = (stages.data ?? []) as Array<{ id: string; name: string }>;

    const user = `File name: ${document.file_name}
Prior clarification question: ${clar.question}
User answer (learn from this): ${data.answer}
School subjects: ${subjectList.map((s) => s.name).join(", ")}
School stages: ${stageList.map((s) => s.name).join(", ")}
Terminology: ${JSON.stringify(terminology.data ?? [])}

DOCUMENT TEXT:
${document.excerpt ?? ""}
`;

    const raw = await callGeminiJson(PIE_CLASSIFY_SYSTEM, user);
    const classification = DocumentClassificationSchema.parse(extractJson(raw));

    const subjectId = matchNameToId(subjectList, classification.subjectLabel);
    const stageId = matchNameToId(stageList, classification.stageLabel);

    await context.supabase.from("prep_check_document_meta" as never).upsert(
      {
        document_id: document.id,
        document_type: classification.documentType,
        subject_id: subjectId,
        stage_id: stageId,
        subject_label: classification.subjectLabel ?? null,
        stage_label: classification.stageLabel ?? null,
        term_label: classification.termLabel ?? null,
        period_label: classification.periodLabel ?? null,
        planning_level: classification.planningLevel ?? null,
        confidence: Math.max(classification.confidence, 75),
        needs_clarification: false,
        summary: classification.summary,
        raw_classification: classification,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "document_id" },
    );

    // Learn terminology if answer looks like a label remap (simple heuristic)
    const termMatch = data.answer.match(
      /(?:we call|we use|our|called)\s+["']?([a-zA-Z ]{2,40})["']?\s+(?:instead of|for|not)\s+["']?([a-zA-Z ]{2,40})/i,
    );
    if (termMatch) {
      const display = termMatch[1].trim();
      const canonicalGuess = termMatch[2].trim().toLowerCase().replace(/\s+/g, "_");
      await context.supabase.from("prep_check_terminology" as never).upsert(
        {
          workspace_id: workspaceId,
          canonical_key: canonicalGuess.slice(0, 60),
          display_label: display.slice(0, 80),
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "workspace_id,canonical_key" },
      );
    }

    await context.supabase
      .from("prep_check_clarifications" as never)
      .update({ applied: true } as never)
      .eq("id", clar.id);

    return { ok: true, classification };
  });
