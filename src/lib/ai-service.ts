// ============================================
// AI SERVICE LAYER
// Current provider: Google Gemini API (direct — no Lovable in the loop)
// ============================================

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export type PronounSet = "she/her" | "he/him" | "they/them";
// NOTE: internal value "full-then-first" maps to spec "full-first".
// Kept stable so existing teacher localStorage preferences continue to work.
export type NameFormat = "first" | "full-then-first" | "full";

export type SubjectData = {
  subject: string;
  assessments: {
    name: string;
    category: string;
    mark: number;
    total: number;
    percentage: number;
    topicsCovered: string | null;
  }[];
  termMark: number | null;
  lowestAssessment: string | null;
};

export interface ReportCommentInput {
  learnerName: string;
  pronounSet: PronounSet;
  nameFormat: NameFormat;
  commentType: "term" | "year-end";
  /**
   * Style of the general comment:
   * - "subject-based": weave marks/topics from subjectData into one flowing comment (default, existing behaviour).
   * - "holistic": write about the learner as a whole person — no marks, no subject references.
   * - "both": holistic opening paragraph followed by subject-based performance.
   */
  commentStyle?: "subject-based" | "holistic" | "both";
  generateGeneralComment: boolean;
  generateAreaOfFocus: boolean;
  areaOfFocusSubjects: string[];
  areaOfFocusSource: "topics" | "marks" | "both";
  termName: string;
  academicYear: string;
  subjectData: SubjectData[];
  teacherSampleComment: string | null;
  /** How the school measures report-comment length. */
  commentLengthType?: "sentences" | "words";
  /**
   * When commentLengthType = 'sentences', one of 'short'|'medium'|'long'|'extended'.
   * When commentLengthType = 'words', the integer word cap (50–500).
   */
  commentLengthValue?: string | number;
  /** Optional free-text observation about the learner from the teacher. */
  teacherObservation?: string | null;
  /** School's preferred term for pupils. Defaults to 'learner'. */
  learnerTerm?: "learner" | "student";
}

export type ReportCommentResult = {
  generalComment: string | null;
  areaOfFocus: Record<string, string[]> | null;
};

export interface ParentMessageInput {
  learnerName: string;
  pronounSet: PronounSet;
  parentName: string | null;
  assessmentName: string;
  subject: string;
  mark: number;
  total: number;
  percentage: number;
  topicsCovered: string | null;
  messageType: "celebration" | "encouragement" | "intervention";
  /** School's preferred term for pupils. Defaults to 'learner'. */
  learnerTerm?: "learner" | "student";
}

// ──────────────────────────────────────────────────────────────────────────
// Provider configuration — change only this block to swap providers.
// ──────────────────────────────────────────────────────────────────────────

// Model is an env var, not hardcoded — GEMINI_MODEL defaults to Google's
// "-latest" alias (hot-swapped to their current recommended Flash release
// with 2 weeks' notice per Google's docs), so we're never pinned to a
// dated version string that silently goes stale.
const AI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

async function callAI(system: string, user: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("AI is not configured. Please contact support.");

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
      }),
    },
  );

  if (resp.status === 429) {
    throw new Error("Penny is a bit busy right now — please try again in a moment.");
  }
  if (!resp.ok) {
    console.error(
      "Gemini API error",
      resp.status,
      JSON.stringify(Object.fromEntries(resp.headers.entries())),
      await resp.text(),
    );
    throw new Error("Something went wrong — nothing was lost. Try again.");
  }

  const json = await resp.json();
  const content: string | undefined = json?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text ?? "")
    .join("");
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("Something went wrong — nothing was lost. Try again.");
  }
  return content.trim();
}

// Strip ```json fences and surrounding prose, then parse.
function extractJson(raw: string): unknown {
  let s = raw.trim();
  // Remove markdown code fences.
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fence) s = fence[1].trim();
  // Otherwise grab the first {...} block.
  if (!s.startsWith("{")) {
    const m = s.match(/\{[\s\S]*\}/);
    if (m) s = m[0];
  }
  return JSON.parse(s);
}

// Post-process common verb-conjugation mistakes from Gemini output.
function fixCommonSpellingErrors(text: string): string {
  return text
    .replace(/\bapproachs\b/gi, "approaches")
    .replace(/\bteachs\b/gi, "teaches")
    .replace(/\breachs\b/gi, "reaches")
    .replace(/\bspeeks\b/gi, "speaks")
    .replace(/\bwrotes\b/gi, "wrote");
}

// ──────────────────────────────────────────────────────────────────────────
// Prompt builders
// ──────────────────────────────────────────────────────────────────────────

const REPORT_COMMENT_SYSTEM = `You are a South African school teacher writing formal report content for your learners.

Your output is ALWAYS a single JSON object — never plain text, never markdown. No prose around the JSON.

OUTPUT SHAPE:
{
  "generalComment": "string or null",
  "areaOfFocus": { "<Subject>": ["bullet", "bullet"] } or null
}

LANGUAGE (applies to every string you produce):
- South African English which follows UK spelling conventions
- Use -ise not -ize (organise, recognise, practise)
- Use -our not -or (colour, behaviour, honour)
- Use -re not -er (centre, theatre)
- Use learnt, dreamt, whilst
- Never use American English spelling

NAME FORMAT (follow exactly — the user message specifies the mode):
- "first": use the learner's first name every time
- "full-then-first": use the full name on the first mention only, then the first name every subsequent mention
- "full": use the full name every time

PRONOUNS:
- she/her: she, her, herself
- he/him: he, his, himself
- they/them: they, them, their, themselves (singular)

═══════════════════════════════════════════════════════════════════════════
SECTION 1 — generalComment
Only generate if the user asks for it. Otherwise return null.

COMMENT STYLE (the user message specifies "commentStyle" — obey exactly):

- "subject-based" (default):
  * Draw from ALL subjects in subjectData (the learner as a whole across every subject).
  * When subjectData contains multiple subjects, this is a class teacher writing
    ONE holistic comment covering the learner across every subject. Do NOT write
    a separate paragraph per subject. Weave the subjects naturally into one
    flowing comment. Reference specific subjects and topics only where they
    strengthen the comment — you do not need to mention every subject if it
    adds no value.
  * Use the performance band tone guide below, based on marks.

- "holistic":
  * Write a warm, professional general comment about this learner as a whole person.
  * Focus on: their character and personality in the classroom, their attitude
    toward learning, their effort and work ethic, their growth this term, and
    any personal qualities worth celebrating.
  * Do NOT mention specific subjects, marks, percentages, assessments or
    academic performance. This is a character comment, not an academic summary.
  * Ignore subjectData entirely for this comment.
  * The teacher's observation (if provided) is the primary source — weave those
    character insights in as the backbone of the comment. If no observation is
    provided, write a warm, professional character comment based on general
    positive framing.
  * Tone: warm, encouraging, professional. Ignore the performance band tone
    guide below — it does not apply when there are no marks in scope.

- "both":
  * Open with ONE holistic character paragraph (character, attitude, effort,
    growth — no marks or subject references, drawing on the teacher observation
    if provided).
  * Then follow with a subject-based paragraph weaving the subjects from
    subjectData into a flowing academic summary, following the same rules as
    "subject-based" above.
  * Separate the two paragraphs with a blank line.
  * The length preference applies to the TOTAL comment across both paragraphs.

GENERAL RULES (apply to every style unless overridden above):
- 3 to 5 sentences only (unless a LENGTH OVERRIDE is provided)
- Start with a positive character observation or academic strength
- Middle: ONE area for growth, framed as "I want to encourage [Name] to..."
  or "[Name] is encouraged to..."
- Close with forward-looking encouragement
- Exactly ONE exclamation mark, only at the very end
- No comma before "and"
- Warm and professional, never generic
- Term comment: focus on this term. Year-end: reflect on the full year.

CLOSING SENTENCE VARIETY (MANDATORY):
Vary the closing encouragement sentence for each learner. Never use the same closing phrase in consecutive comments.

Rotate through these approaches:
- I look forward to seeing [Name]...
- It has been a pleasure teaching [Name] this term...
- [Name] has had a wonderful term...
- I am excited to see what [Name] will achieve...
- I am confident that [Name] will...
- Well done [Name] — keep it up!
- [Name] should feel very proud...
- With continued effort [Name] will...

Choose the most appropriate closing based on the performance band.
Never repeat the same closing for two learners in a row.


PROOF-READING (MANDATORY):
Double-check all verb conjugations before responding. Third person singular
verbs must end in -s or -es correctly. Never write 'approachs' — always
'approaches'.

PERFORMANCE BAND TONE GUIDE (MANDATORY):
Determine the learner's band using termMark percentage. If a subject's
termMark is null, use the average percentage across that subject's
assessments. If the learner has multiple subjects, use the mean of the
per-subject term marks (or per-subject averages where termMark is null).
If no marks data exists at all, default to the Encouraging band (60–79%).
The tone MUST match the actual performance — never inflate.

80% and above — CELEBRATORY:
- Genuinely celebrate achievement.
- Use words like: exceptional, outstanding, excelled, demonstrated mastery,
  remarkable, impressive.
- Frame the challenge as reaching even greater heights.
- Example: "I want to encourage [Name] to challenge herself further by..."

60% to 79% — ENCOURAGING:
- Balanced and warm. Acknowledge genuine strengths.
- One clear growth area framed positively.
- Avoid overly celebratory language.
- Example: "I want to encourage [Name] to focus on..."

50% to 59% — SUPPORTIVE:
- Acknowledge effort and attitude over achievement.
- Be honest that there is meaningful room for growth.
- Use language like: developing, building, working towards, showing progress.
- Avoid phrases like "high standard" or "exceptional" in this band.
- Example: "[Name] is encouraged to dedicate additional time to..."

Below 50% — HONEST AND CARING:
- Open with a genuine character strength or attitude observation —
  never fabricate academic achievement that is not there.
- Be honest that significant growth is needed whilst remaining warm.
- Use language like: working hard to, building confidence in, developing
  foundational skills, still finding their footing.
- NEVER use these words/phrases for learners below 50%:
  exceptional, outstanding, high standard, excellent start, excelled, remarkable.
- The challenge section must be specific and actionable.
- The closing must involve support, e.g.
  "With continued support and dedication, [Name] will..."
  rather than "I look forward to seeing [Name] reach their full potential."
- Make it clear growth is needed without alarming the parent.
  Warm but honest.

═══════════════════════════════════════════════════════════════════════════
SECTION 2 — areaOfFocus
Only generate if the user asks for it. Otherwise return null.

- Object keyed by subject name. Include ONLY the subjects listed in
  areaOfFocusSubjects. Skip any subject not in that list.
- 1 to 2 bullets per included subject. Never more than 2.
- Each bullet is a SHORT actionable phrase (NOT a full sentence).
- Each bullet MUST start with a verb such as:
  "Practise", "Focus on", "Revise", "Apply", "Strengthen",
  "Consolidate", "Build", "Develop"
- Do NOT include the learner's name or pronouns in bullets.
- Do NOT use exclamation marks in bullets.
- Source rules:
  * areaOfFocusSource = "topics": base bullets on topicsCovered in that subject
  * areaOfFocusSource = "marks": base bullets on the lowest scoring assessment
  * areaOfFocusSource = "both": combine topics AND lowest marks

If a subject has no useful signal (no topics for "topics" mode, no marks
for "marks" mode), still return 1 generic but subject-appropriate bullet.

═══════════════════════════════════════════════════════════════════════════
RETURN: JSON object only. No code fences. No commentary.`;

function buildReportUserPrompt(input: ReportCommentInput): string {
  const nameInstruction =
    input.nameFormat === "first"
      ? "FIRST NAME ONLY every mention."
      : input.nameFormat === "full"
        ? "FULL NAME every mention."
        : "FULL NAME on first mention, then first name for every subsequent mention.";

  const subjectBlocks = input.subjectData.length
    ? input.subjectData
        .map((s) => {
          const lines = s.assessments.length
            ? s.assessments
                .map(
                  (a) =>
                    `  - ${a.name} (${a.category}): ${a.mark}/${a.total} = ${a.percentage}%${
                      a.topicsCovered ? ` — topics: ${a.topicsCovered}` : ""
                    }`,
                )
                .join("\n")
            : "  (no assessments captured)";
          return `Subject: ${s.subject}
Term mark: ${s.termMark != null ? `${s.termMark}%` : "n/a"}
Lowest assessment: ${s.lowestAssessment ?? "n/a"}
Assessments:
${lines}`;
        })
        .join("\n\n")
    : "(no subjects in scope)";

  const sampleBlock = input.teacherSampleComment
    ? `\n\nSTYLE REFERENCE — match tone, vocabulary and sentence length. Do not copy.\n"""\n${input.teacherSampleComment}\n"""`
    : "";

  // Length override — school-specific rule that beats the default 3–5 sentence
  // guidance in the system prompt. Applies to generalComment only.
  const lengthBlock = (() => {
    const t = input.commentLengthType;
    const v = input.commentLengthValue;
    if (!t || v == null || v === "") return "";
    if (t === "sentences") {
      const map: Record<string, string> = {
        short: "3 to 4",
        medium: "5 to 6",
        long: "7 to 8",
        extended: "9 to 10",
      };
      const range = map[String(v)] ?? "5 to 6";
      return `\n\nLENGTH OVERRIDE (MANDATORY — overrides any earlier sentence-count guidance):
Write the general comment in exactly ${range} sentences. Count carefully. Never exceed or fall short.`;
    }
    const words = typeof v === "number" ? v : parseInt(String(v), 10);
    if (!Number.isFinite(words) || words <= 0) return "";
    return `\n\nLENGTH OVERRIDE (MANDATORY — overrides any earlier sentence-count guidance):
Write the general comment in a maximum of ${words} words. Count carefully. Stay under the limit. Do not pad with unnecessary content to reach the limit.`;
  })();

  const observation = (input.teacherObservation ?? "").trim();
  const observationBlock = observation
    ? `\n\nTEACHER OBSERVATION (personal note from the teacher about this learner):
"""
${observation}
"""
Extract relevant character insights from this observation and weave them naturally into the general comment. Do not quote the observation directly. Do not use informal language from the observation. Transform it into professional report-comment language. Integrate it seamlessly with the academic performance data — it must not read as a separate paragraph or a tacked-on sentence.`
    : "";

  const term = input.learnerTerm === "student" ? "student" : "learner";
  const termBlock = `\n\nTERMINOLOGY (MANDATORY):
Refer to pupils as '${term}' throughout — never use the alternative term.`;

  return `Generate report content for this learner.

Learner full name: ${input.learnerName}
Pronouns: ${input.pronounSet}
Name format mode: ${input.nameFormat}
Name format instruction: ${nameInstruction}
Comment type: ${input.commentType}
commentStyle: ${input.commentStyle ?? "subject-based"}
Academic year: ${input.academicYear}
Term: ${input.termName}

generateGeneralComment: ${input.generateGeneralComment}
generateAreaOfFocus: ${input.generateAreaOfFocus}
areaOfFocusSubjects: ${JSON.stringify(input.areaOfFocusSubjects)}
areaOfFocusSource: ${input.areaOfFocusSource}

subjectData:
${subjectBlocks}${sampleBlock}${lengthBlock}${observationBlock}${termBlock}

Return JSON exactly matching the OUTPUT SHAPE in the system prompt. If a section is disabled, set it to null.`;
}

const PARENT_MESSAGE_SYSTEM = `You are a South African school teacher writing a WhatsApp or email message to a parent about their child's recent assessment result.

LANGUAGE:
- South African English — UK spelling
- Warm, personal, conversational
- Not too formal — this is a message, not a letter
- Short — maximum 4 sentences

STRUCTURE:
- Start with a greeting if parent name is provided: "Hi [Parent name],"
  If no parent name: "Good day,"
- Use the learner's name naturally
- State the assessment and result warmly
- End with an appropriate closing based on message type

TONE CALIBRATION BY PERCENTAGE (MANDATORY — obey the band the mark falls into,
not the messageType label. The tone MUST match the actual percentage —
never inflate. A 50% mark is not an achievement.):

80% and above — GENUINELY CELEBRATORY:
- The parent should feel proud reading this.
- Use language like: "excellent", "outstanding", "impressive", "proud", "achieved".
- Acknowledge the specific achievement and reference topics if available.
- End with encouragement to keep it up.

65% to 79% — POSITIVE AND ENCOURAGING:
- The parent should feel pleased and encouraged.
- Use language like: "good progress", "solid work", "showing improvement", "on track".
- Acknowledge effort and mention one area to keep building on.
- Do NOT use "excellent", "outstanding", "impressive" in this band.

50% to 64% — BALANCED AND HONEST:
- The parent should understand their child passed but has clear room to improve.
- Use language like: "completed the assessment", "there is room to grow",
  "I encourage", "with more focus".
- Do NOT use words like "great", "solid job", "well done", "excellent",
  "outstanding", "impressive", "proud" for this range.
- Mention one specific area to work on.

40% to 49% — HONEST AND SUPPORTIVE:
- The parent should be gently alerted that their child needs attention
  without feeling alarmed.
- Use language like: "finding this challenging", "needs more support",
  "I would like to work with", "encourage practice at home".
- Do NOT use any celebratory language. Do NOT open with praise the mark
  does not support.
- Suggest working together and give one actionable next step.

Below 40% — DIRECT AND CARING:
- The parent should understand this is serious and know to contact the teacher.
- Use language like: "struggling significantly", "requires additional support",
  "I recommend", "please contact me".
- Be honest but never alarming or blaming. Make the parent feel included.
- Invite a conversation directly — end with a clear call to reach out.

GENERAL RULES ACROSS ALL BANDS:
- Never inflate the tone above what the percentage justifies.
- The messageType field ("celebration" / "encouragement" / "intervention")
  is a hint from the teacher, but the PERCENTAGE band above is the source
  of truth for tone. If they conflict, follow the percentage.
- Never blame the child. Never blame the parent.

PRONOUNS:
Use the correct pronoun set throughout.

PUNCTUATION:
South African English conventions. UK spelling throughout.

OUTPUT:
Return only the message text. No introduction or explanation. Just the message itself. Ready to copy and paste.`;

function buildParentUserPrompt(input: ParentMessageInput): string {
  const term = input.learnerTerm === "student" ? "student" : "learner";
  return `Write a ${input.messageType} message to the parent about this result:

Learner: ${input.learnerName}
Pronouns: ${input.pronounSet}
Parent name: ${input.parentName ?? "(not provided)"}
Subject: ${input.subject}
Assessment: ${input.assessmentName}
Result: ${input.mark}/${input.total} = ${input.percentage}%
${input.topicsCovered ? `Topics covered: ${input.topicsCovered}` : ""}

TERMINOLOGY (MANDATORY):
Refer to the child as a '${term}' if you need to use the word — never use the alternative term.`;
}

// ──────────────────────────────────────────────────────────────────────────
// Server functions — call from the client like normal async functions.
// ──────────────────────────────────────────────────────────────────────────

const SubjectDataZ = z.object({
  subject: z.string(),
  assessments: z.array(
    z.object({
      name: z.string(),
      category: z.string(),
      mark: z.number(),
      total: z.number(),
      percentage: z.number(),
      topicsCovered: z.string().nullable(),
    }),
  ).max(50),
  termMark: z.number().nullable(),
  lowestAssessment: z.string().nullable(),
});

const ReportInputZ = z.object({
  learnerName: z.string().min(1),
  pronounSet: z.enum(["she/her", "he/him", "they/them"]),
  // Defensive defaults — never allow undefined/null to blow up the request.
  nameFormat: z.enum(["first", "full-then-first", "full"]).default("full-then-first"),
  commentType: z.enum(["term", "year-end"]).default("term"),
  commentStyle: z.enum(["subject-based", "holistic", "both"]).default("subject-based"),
  generateGeneralComment: z.boolean().default(true),
  generateAreaOfFocus: z.boolean().default(true),
  areaOfFocusSubjects: z.array(z.string()).default([]),
  areaOfFocusSource: z.enum(["topics", "marks", "both"]).default("both"),
  termName: z.string().default("this term"),
  academicYear: z.string().default("this year"),
  subjectData: z.array(SubjectDataZ).max(20).default([]),
  teacherSampleComment: z.string().nullable().default(null),
  commentLengthType: z.enum(["sentences", "words"]).optional(),
  commentLengthValue: z.union([z.string(), z.number()]).optional(),
  teacherObservation: z.string().nullable().optional(),
  learnerTerm: z.enum(["learner", "student"]).optional(),
});

const ParentInputZ = z.object({
  learnerName: z.string().min(1),
  pronounSet: z.enum(["she/her", "he/him", "they/them"]),
  parentName: z.string().nullable(),
  assessmentName: z.string(),
  subject: z.string(),
  mark: z.number(),
  total: z.number(),
  percentage: z.number(),
  topicsCovered: z.string().nullable(),
  messageType: z.enum(["celebration", "encouragement", "intervention"]),
  learnerTerm: z.enum(["learner", "student"]).optional(),
});

const ReportResultZ = z.object({
  generalComment: z.string().nullable(),
  areaOfFocus: z.record(z.string(), z.array(z.string())).nullable(),
});

export const generateReportComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ReportInputZ.parse(raw))
  .handler(async ({ data, context }): Promise<ReportCommentResult> => {
    // If both sections are off, short-circuit.
    if (!data.generateGeneralComment && !data.generateAreaOfFocus) {
      return { generalComment: null, areaOfFocus: null };
    }
    const { assertAiRateLimit } = await import("@/lib/ai-rate-limit.server");
    await assertAiRateLimit(context.userId);

    const raw = await callAI(REPORT_COMMENT_SYSTEM, buildReportUserPrompt(data));
    let parsed: ReportCommentResult;
    try {
      const obj = extractJson(raw);
      parsed = ReportResultZ.parse(obj);
    } catch {
      // Fallback: treat the whole reply as the general comment so the teacher
      // is not left with nothing on a malformed JSON response.
      parsed = {
        generalComment: data.generateGeneralComment ? raw.replace(/^["']|["']$/g, "") : null,
        areaOfFocus: null,
      };
    }
    // Force-null any section the teacher did not ask for.
    if (!data.generateGeneralComment) parsed.generalComment = null;
    if (!data.generateAreaOfFocus) parsed.areaOfFocus = null;
    // Post-process: correct common Gemini verb-conjugation errors.
    if (typeof parsed.generalComment === "string") {
      parsed.generalComment = fixCommonSpellingErrors(parsed.generalComment);
    }
    // Filter areaOfFocus to the requested subjects only.
    if (parsed.areaOfFocus && data.areaOfFocusSubjects.length) {
      const allowed = new Set(data.areaOfFocusSubjects);
      const filtered: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(parsed.areaOfFocus)) {
        if (allowed.has(k)) filtered[k] = v.slice(0, 2);
      }
      parsed.areaOfFocus = Object.keys(filtered).length ? filtered : null;
    }
    return parsed;
  });

export const generateParentMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ParentInputZ.parse(raw))
  .handler(async ({ data, context }) => {
    const { assertAiRateLimit } = await import("@/lib/ai-rate-limit.server");
    await assertAiRateLimit(context.userId);
    const text = await callAI(PARENT_MESSAGE_SYSTEM, buildParentUserPrompt(data));
    return { text: text.replace(/^["']|["']$/g, "") };
  });

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

export function inferMessageType(percentage: number): ParentMessageInput["messageType"] {
  if (percentage >= 80) return "celebration";
  if (percentage >= 50) return "encouragement";
  return "intervention";
}

/** Normalise free-text pronouns from the DB to one of the three supported sets. */
export function normalisePronouns(value: string | null | undefined): PronounSet {
  const v = (value ?? "").toLowerCase().trim();
  if (v === "she/her" || v === "she" || v === "her") return "she/her";
  if (v === "they/them" || v === "they" || v === "them") return "they/them";
  return "he/him";
}

// Best-effort name → pronoun inference. Covers common SA + global names,
// plus phonetic suffix heuristics. Not authoritative — teacher must confirm.
const FEMININE_NAMES = new Set<string>([
  // Examples called out by product
  "sophia", "razia", "ammara", "april", "nokwanda", "zanele",
  // Common feminine names (SA + global, lowercase)
  "amara", "amora", "amina", "aaliyah", "aisha", "ayesha", "ava", "abigail",
  "bongiwe", "bonolo", "buhle", "busisiwe",
  "chantelle", "charlotte", "chloe", "chiamaka",
  "dineo", "dimakatso",
  "ella", "emma", "emily", "evelyn", "elena",
  "fatima", "faith", "freya",
  "grace", "gugu",
  "hannah", "hlengiwe",
  "imani", "isabella", "isla",
  "jasmine", "jessica", "julia",
  "kagiso", "karabo", "katlego", "khanyisile", "khanyi", "khethiwe",
  "lerato", "lebohang", "lily", "lindiwe", "lwazi", "luna",
  "mia", "maya", "maria", "mary", "michelle", "mpho", "mbali",
  "nadia", "naledi", "nandi", "nokuthula", "nokubonga", "nolwazi", "ntombi", "nontokozo", "nosipho",
  "olivia",
  "palesa", "phindile", "priya", "precious",
  "refilwe", "rethabile", "rose", "rumbi", "rumbidzai",
  "sarah", "sara", "sasha", "sibongile", "sindiswa", "sinead", "sophie", "stella",
  "tara", "thandiwe", "thando", "thandeka", "tshepiso",
  "uzma",
  "victoria", "vuyiswa",
  "xolisiwe", "xoliswa",
  "yara", "yasmin",
  "zainab", "zandile", "zara", "zoe", "zoey", "zinhle",
]);

const MASCULINE_NAMES = new Set<string>([
  // Examples called out by product
  "sipho", "ayaan", "awande",
  // Common masculine names (SA + global, lowercase)
  "abdul", "ahmed", "ali", "anele", "andile", "andrew", "ayanda",
  "bandile", "benjamin", "bheki", "bongani", "brandon",
  "charles", "chris", "christopher",
  "daniel", "david", "dumisani",
  "elijah", "ethan",
  "faheem", "fanele",
  "gabriel", "george",
  "hamza", "henry",
  "ibrahim", "ismael", "ismail",
  "jabu", "jabulani", "jacob", "james", "john", "joseph", "joshua", "julian", "junior",
  "kabelo", "kagiso", "kamogelo", "katlego", "kgosi", "khaya", "khaya", "khulekani",
  "lethabo", "liam", "lucas", "lukhanyo", "lwazi",
  "mandla", "matthew", "mfundo", "michael", "mohammed", "muhammad", "musa", "mzwandile",
  "nathan", "ncedo", "nkosi", "nkosinathi", "noah",
  "oliver", "owen",
  "peter", "philani",
  "rashid", "ricardo", "ryan", "rohan",
  "samkelo", "sandile", "siyabonga", "sizwe", "sizwe", "sphesihle",
  "thabang", "thabo", "thami", "thapelo", "tshepang", "tshepo", "themba",
  "vusi", "vusumzi",
  "william",
  "xolani",
  "yusuf",
  "zakhele", "zweli",
  // Product-specified extras
  "aaron",
]);

function inferPronounsFromName(rawName: string): { pronouns: PronounSet; confident: boolean } {
  const first = (rawName ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!first) return { pronouns: "he/him", confident: false };
  if (FEMININE_NAMES.has(first)) return { pronouns: "she/her", confident: true };
  if (MASCULINE_NAMES.has(first)) return { pronouns: "he/him", confident: true };
  // Phonetic suffix heuristic — common feminine endings
  if (/(a|ah|ia|iya|iyah|ya|elle|ette|ine|een|een)$/.test(first) && first.length >= 4) {
    return { pronouns: "she/her", confident: true };
  }
  return { pronouns: "he/him", confident: false };
}

/**
 * Resolve display pronouns for a learner.
 * - Stored pronoun (teacher-set) always wins and is treated as confirmed.
 * - Otherwise infer from the name. If inference is uncertain, flag
 *   `needsConfirmation` so the UI can prompt the teacher to confirm.
 */
export function resolvePronouns(
  name: string,
  stored: string | null | undefined,
): { pronouns: PronounSet; needsConfirmation: boolean } {
  const s = (stored ?? "").trim();
  if (s) return { pronouns: normalisePronouns(s), needsConfirmation: false };
  const inferred = inferPronounsFromName(name);
  return { pronouns: inferred.pronouns, needsConfirmation: !inferred.confident };
}

/** Format a full ReportCommentResult into a copy-pasteable plain-text block. */
export function formatReportResult(
  learnerName: string,
  result: ReportCommentResult,
): string {
  const parts: string[] = [learnerName];
  if (result.generalComment) {
    parts.push("", result.generalComment);
  }
  if (result.areaOfFocus && Object.keys(result.areaOfFocus).length) {
    parts.push("", "Area of Focus:");
    for (const [subject, bullets] of Object.entries(result.areaOfFocus)) {
      parts.push("", `${subject}:`);
      for (const b of bullets) parts.push(`• ${b}`);
    }
  }
  return parts.join("\n");
}
