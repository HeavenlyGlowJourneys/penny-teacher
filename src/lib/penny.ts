// Shared helpers for Penny.
import { dlog } from "@/lib/debug-log";
import { normalizeSpokenDecimals, parseSpokenWhole } from "@/lib/spoken-numbers";

export const ASSESSMENT_TYPES = [
  "Test",
  "Exam",
  "Reading Assessment",
  "Comprehension",
  "Project",
  "Oral",
  "Assignment",
  "Quiz",
] as const;

export const GRADES = [
  "Grade R", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5",
  "Grade 6", "Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12",
] as const;

// Normalize a name for fuzzy matching: lowercase, strip punctuation, collapse spaces.
export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
}

// Phonetic-ish key: collapse common South African spelling variants so
// Synthetic pairs: "kaymo" ~ "khaymo", "tamo" ~ "thamo", "sifi" ~ "siphi", "anodi" ~ "anodayi".
export function phoneticKey(s: string): string {
  let t = normalizeName(s);
  // Digraphs that sound like a single sound
  t = t.replace(/ph/g, "f");
  t = t.replace(/kh/g, "k");
  t = t.replace(/th/g, "t");
  t = t.replace(/gh/g, "g");
  t = t.replace(/sh/g, "s");
  t = t.replace(/ch/g, "c");
  t = t.replace(/qu/g, "kw");
  t = t.replace(/ck/g, "k");
  // Vowel collapse — South African names use many vowels interchangeably
  t = t.replace(/[aeiou]+/g, "a");
  // Drop trailing/repeated consonants
  t = t.replace(/(.)\1+/g, "$1");
  return t;
}

// Levenshtein distance (small inputs, simple impl).
function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(
        dp[i] + 1,
        dp[i - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return dp[a.length];
}

export type LearnerLike = {
  id: string;
  name: string;
  pronunciation?: string | null;
  aliases?: string[] | null;
};

export type MatchResult = { learner: LearnerLike; confidence: number };

/**
 * Find the best learner match for a spoken name. Tries (a) aliases (exact/fuzzy),
 * (b) pronunciation hint, (c) full name, (d) any first/middle name word,
 * (e) phonetic key. Returns the candidate with the smallest normalized distance.
 */
export function matchLearnerEx(
  spoken: string,
  learners: LearnerLike[],
): MatchResult | null {
  const target = normalizeName(spoken);
  if (!target) return null;
  const targetPhon = phoneticKey(target);
  const targetWords = target.split(" ");

  // Score each learner. Aliases and pronunciation count as stronger evidence
  // than the official name — that's the whole point of "Let's Learn Your
  // Learners". Give those candidates a SMALL bias so a close pronunciation
  // wins ties, WITHOUT letting a short 3-4 char alias phonetically collide
  // its way into beating a literal name match on a different learner.
  // (Regression: alias "Nate" → phoneticKey "nata" was within lev=2 of
  //  phoneticKey("joshua")="jasa"; the old -2 bias made it score 0 and steal
  //  every "Joshua" utterance from Joshua Blower.)
  type Scored = { learner: LearnerLike; score: number; maxLen: number; via: string; probeLen: number };
  const scored: Scored[] = [];

  // Short tokens phonetic-collide with everything once vowels collapse to "a".
  // Require both sides to be at least this long before trusting the phonetic key.
  const PHON_MIN_LEN = 5;

  for (const l of learners) {
    const probes: { text: string; bias: number; label: string }[] = [];
    probes.push({ text: normalizeName(l.name), bias: 0, label: "name" });
    for (const w of normalizeName(l.name).split(" ")) {
      if (w.length > 1) probes.push({ text: w, bias: 0.1, label: "namePart" });
    }
    if (l.pronunciation) probes.push({ text: normalizeName(l.pronunciation), bias: -0.5, label: "pron" });
    if (l.aliases) for (const a of l.aliases) probes.push({ text: normalizeName(a), bias: -0.75, label: "alias" });

    let bestForThis = Infinity;
    let bestLen = 0;
    let bestVia = "name";
    let bestProbeLen = 0;
    const targetProbes = [target, ...targetWords.filter((w) => w.length > 1)];
    for (const c of probes) {
      if (!c.text) continue;
      for (const p of targetProbes) {
        const d = lev(p, c.text) + c.bias;
        const len = Math.max(p.length, c.text.length);
        if (d < bestForThis) { bestForThis = d; bestLen = len; bestVia = c.label; bestProbeLen = c.text.length; }
      }
      // Phonetic fallback — gated by length so 3-4 char tokens can't collide.
      if (c.text.length >= PHON_MIN_LEN && targetPhon.length >= PHON_MIN_LEN) {
        const dPhon = lev(phoneticKey(c.text), targetPhon) + c.bias;
        if (dPhon < bestForThis) {
          bestForThis = dPhon;
          bestLen = Math.max(phoneticKey(c.text).length, targetPhon.length);
          bestVia = c.label;
          bestProbeLen = c.text.length;
        }
      }
    }
    scored.push({ learner: l, score: bestForThis, maxLen: bestLen, via: bestVia, probeLen: bestProbeLen });
  }
  if (scored.length === 0) return null;

  // Exact literal-word override: if the spoken target appears verbatim as a
  // word inside an official learner name, that learner wins outright. This
  // is what guarantees "Joshua" → Joshua Blower even when another learner
  // has an alias whose phonetic key happens to score lower.
  const literalHits = scored.filter((s) => {
    const nameWords = normalizeName(s.learner.name).split(" ");
    return nameWords.some((w) => w.length >= 3 && (w === target || targetWords.includes(w)));
  });
  if (literalHits.length > 0) {
    literalHits.sort((a, b) => a.score - b.score);
    const winner = literalHits[0];
    scored.sort((a, b) => (a === winner ? -1 : b === winner ? 1 : a.score - b.score));
  } else {
    scored.sort((a, b) => a.score - b.score);
  }
  const best = scored[0];
  const second = scored[1];

  // Normal threshold scales with length.
  const threshold = best.maxLen <= 4 ? 1 : best.maxLen <= 7 ? 2 : 3;

  // Accept when (1) inside the normal threshold, or (2) uniquely closer than
  // every other learner by a meaningful margin. Tighter margin and looseCap
  // when the winning probe is short, so a 3-letter nickname can't claim a
  // longer spoken name.
  const margin = second ? second.score - best.score : Infinity;
  const taught = best.via === "pron" || best.via === "alias";
  const shortProbe = best.probeLen > 0 && best.probeLen < 5;
  const requiredMargin = shortProbe ? 1.5 : 2;
  const looseCap = taught ? threshold + (shortProbe ? 1 : 3) : threshold + 1;
  const uniquelyClose = margin >= requiredMargin && best.score <= looseCap;
  const accepted = !(best.score > threshold && !uniquelyClose);


  // Debug visibility into matcher decisions — surfaces whether pronunciation/alias
  // data is actually being consulted during capture.
  try {
    const top = scored.slice(0, 3).map((s) => ({
      name: s.learner.name,
      score: Number(s.score.toFixed(2)),
      via: s.via,
    }));
    dlog("[matcher]", {
      transcript: spoken,
      candidates: top,
      winner: accepted ? best.learner.name : null,
      reason: accepted ? `${best.via} match (score ${best.score.toFixed(2)}, threshold ${threshold}${uniquelyClose ? `, uniquely close by ${margin.toFixed(2)}` : ""})` : `rejected (best ${best.via} score ${best.score.toFixed(2)} > threshold ${threshold})`,
    });
  } catch { /* ignore logging failures */ }

  if (!accepted) return null;

  const confidence = Math.max(0, 1 - Math.max(0, best.score) / Math.max(3, best.maxLen));
  return { learner: best.learner, confidence };
}


/** Back-compat wrapper. */
export function matchLearner(spoken: string, learners: LearnerLike[]): LearnerLike | null {
  return matchLearnerEx(spoken, learners)?.learner ?? null;
}

/** Quick client-side parser for utterances like "Anna 15", "John absent". */
export type ParsedUtterance =
  | { kind: "mark"; name: string; mark: number }
  | { kind: "absent"; name: string }
  | { kind: "sections"; name: string; marks: number[] }
  | { kind: "unknown" };

function wordToNum(s: string): number | null {
  const t = s.toLowerCase().trim();
  // Canonical decimals from normalizeSpokenDecimals ("12.5", "7.25").
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  return parseSpokenWhole(t);
}

function cleanText(raw: string): string {
  // Collapse SA spoken decimals ("twelve comma five", "point five", "12,5")
  // into canonical digit form before tokenize() can split them apart.
  return normalizeSpokenDecimals(raw).trim().replace(/[,.!?]+$/, "");
}

// Words to discard wherever they appear — they carry no signal for name or marks.
// These are filler/discourse words and stock verbs around marks. Names should never
// be in here (we'd lose the learner) — keep South African names safe.
export const FILLER_TOKENS = new Set([
  "um", "uh", "uhh", "umm", "er", "erm", "mm", "mmm", "hmm",
  "okay", "ok", "kay", "right", "alright", "well", "like", "so", "now",
  "then", "next", "sorry", "oops", "please", "just", "yeah", "ya", "yep",
  "the", "a", "an", "and", "is", "was", "were", "be",
  "mark", "marks", "got", "gets", "scored", "scores", "score",
  "received", "receives", "made", "makes", "has", "had", "have", "with",
  "of", "for", "points", "point", "comma", "dot", "half", "out", "total",
]);
export function isFillerToken(t: string): boolean {
  return FILLER_TOKENS.has(t.toLowerCase());
}

function tokenize(text: string): string[] {
  return text
    // Strip punctuation, but keep a decimal point attached to a digit intact
    // ("15.5" and preprocessed "fifteen.5" must survive as one token).
    .replace(/(?<![a-z0-9])\.(?!\d)|(?<=[a-z0-9])\.(?!\d)|[,!?;:]+/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function tokenAsNumber(t: string): number | null {
  const x = t.toLowerCase();
  return wordToNum(x);
}

const isFiller = isFillerToken;


/**
 * Split a transcript into:
 *   nameTokens — the leading non-numeric, non-filler words (the learner name)
 *   nums       — every numeric token found anywhere after the name (fillers ignored)
 *
 * "Alex um 8 7 okay 10 9 sorry 6" → name: "Alex", nums: [8,7,10,9,6]
 * "Kumo 8 7 10 9 6"               → name: "Kumo", nums: [8,7,10,9,6]
 * "April 6612 136"                → name: "April", nums: [6612, 136]
 */
function splitNameAndNumbers(text: string): { name: string; nums: number[] } {
  const tokens = tokenize(text);
  const nameParts: string[] = [];
  let i = 0;
  // Skip leading fillers, then collect name words until we hit a number.
  while (i < tokens.length) {
    const t = tokens[i];
    if (tokenAsNumber(t) !== null) break;
    if (!isFiller(t)) nameParts.push(t);
    i++;
  }
  const nums: number[] = [];
  // From the first number onwards, pick up every numeric token; ignore fillers and noise words.
  for (; i < tokens.length; i++) {
    const n = tokenAsNumber(tokens[i]);
    if (n !== null) nums.push(n);
    // Non-numeric mid-stream tokens (fillers, mispronounced words like "section",
    // "sorry") are intentionally dropped — they're clues, not truth.
  }
  return { name: nameParts.join(" ").trim(), nums };
}

export function parseUtterance(raw: string): ParsedUtterance {
  const text = cleanText(raw);
  if (!text) return { kind: "unknown" };
  const lower = text.toLowerCase();

  const absentMatch = lower.match(/^(.+?)\s+(?:is|was|were)?\s*(?:absent|away|not here|missing)$/);
  if (absentMatch) return { kind: "absent", name: absentMatch[1].trim() };

  const { name, nums } = splitNameAndNumbers(text);
  if (!name) return { kind: "unknown" };
  if (nums.length === 0) return { kind: "unknown" };
  // For final-mark mode, the LAST number spoken wins (self-correction friendly).
  return { kind: "mark", name, mark: nums[nums.length - 1] };
}

/**
 * Parse a section-mode utterance.
 * Also handles a single-section update: "Alex Section B 9" or "Alex section 2 9".
 */
export type ParsedSectionUpdate = { kind: "sectionUpdate"; name: string; sectionIndex: number; mark: number };

/**
 * Greedy split of a merged digit string ("6612136") into N section marks,
 * using each section's max total to disambiguate. Returns null if no split fits.
 */
export function splitMergedSectionDigits(digits: string, totals: number[]): number[] | null {
  function rec(pos: number, idx: number): number[] | null {
    if (idx === totals.length) return pos === digits.length ? [] : null;
    const remaining = totals.length - idx;
    const left = digits.length - pos;
    if (left < remaining || left > remaining * 2) return null;
    const tryOrder = totals[idx] >= 10 ? [2, 1] : [1, 2];
    for (const take of tryOrder) {
      if (pos + take > digits.length) continue;
      const n = Number(digits.slice(pos, pos + take));
      if (!Number.isFinite(n)) continue;
      if (n > totals[idx]) continue;
      if (take === 2 && digits[pos] === "0") continue;
      const rest = rec(pos + take, idx + 1);
      if (rest) return [n, ...rest];
    }
    return null;
  }
  return rec(0, 0);
}

export function parseSectionUtterance(
  raw: string,
  expectedCount: number,
  sectionTotals?: number[],
): ParsedUtterance | ParsedSectionUpdate {
  const text = cleanText(raw);
  if (!text) return { kind: "unknown" };
  const lower = text.toLowerCase();
  const absentMatch = lower.match(/^(.+?)\s+(?:is|was|were)?\s*(?:absent|away|not here|missing)$/);
  if (absentMatch) return { kind: "absent", name: absentMatch[1].trim() };

  // Single-section update — "Alex section B 9"
  const secMatch = text.match(/^(.+?)\s+section\s+([a-zA-Z]|\d+)\s+(\d+(?:\.\d+)?)$/i);
  if (secMatch) {
    const ref = secMatch[2];
    const idx = /^\d+$/.test(ref) ? Number(ref) - 1 : ref.toUpperCase().charCodeAt(0) - 65;
    if (idx >= 0 && idx < expectedCount) {
      return { kind: "sectionUpdate", name: secMatch[1].trim(), sectionIndex: idx, mark: Number(secMatch[3]) };
    }
  }

  const { name, nums } = splitNameAndNumbers(text);
  if (!name) return { kind: "unknown" };

  // Perfect: heard exactly the expected count of section marks.
  if (nums.length === expectedCount) {
    // Sanity check against section totals — if every number fits, accept directly.
    if (!sectionTotals || nums.every((n, i) => n <= sectionTotals[i])) {
      return { kind: "sections", name, marks: nums };
    }
  }

  // Recovery: speech engine merged or split digits ("6612136", "6612 136", "66 12 13 6").
  // Concatenate ALL numeric tokens and let the section totals split them.
  if (sectionTotals && sectionTotals.length === expectedCount && nums.length > 0) {
    const digitConcat = nums.map((n) => String(Math.trunc(n))).join("");
    const split = splitMergedSectionDigits(digitConcat, sectionTotals);
    if (split) return { kind: "sections", name, marks: split };
  }

  // One number → treat as final-mark style (caller will flag if section mode expected more).
  if (nums.length === 1) return { kind: "mark", name, mark: nums[0] };

  return { kind: "unknown" };
}

export function pct(mark: number | null, total: number) {
  if (mark == null || !total) return 0;
  return Math.round((mark / total) * 100);
}

export type Section = { name: string; total: number };

export function sumSections(marks: number[] | null | undefined): number {
  if (!marks) return 0;
  return marks.reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0);
}
