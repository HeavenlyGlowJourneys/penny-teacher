/**
 * South African spoken-number normalisation for voice mark capture.
 *
 * Teachers dictate decimals many ways ("point", "comma", "dot", "and a half").
 * This layer collapses those phrases into canonical digit form with `.` before
 * the rest of the utterance parser runs.
 *
 * Extensible: add entries to MULTI_FRAC_PHRASES for more two-place values
 * (e.g. "two five" → 25 for .25). Single-digit fractions are handled generically.
 */

/** Whole-number words used in mark dictation (0–90 compounds). */
export const NUM_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

/** Single digit words — building blocks for fractional parts. */
const DIGIT_WORDS: Record<string, string> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

/**
 * Known multi-place spoken fractions. Longer phrases first so
 * "twenty five" wins over a lone "twenty".
 * Add new mark decimals here (maintainable extension point).
 */
const MULTI_FRAC_PHRASES: Array<{ pattern: string; digits: string }> = [
  { pattern: "twenty\\s+five", digits: "25" },
  { pattern: "two\\s+five", digits: "25" },
  { pattern: "seven\\s+five", digits: "75" },
  { pattern: "five\\s+zero", digits: "50" },
];

const DIGIT_WORD_ALT = Object.keys(DIGIT_WORDS).join("|");
const NUM_WORD_ALT = Object.keys(NUM_WORDS).join("|");
const SEP_ALT = "point|comma|dot";

/**
 * Parse a whole-number phrase: digits, a number word, or a two-part compound
 * ("eighty nine", "twenty-one").
 */
export function parseSpokenWhole(raw: string): number | null {
  const t = raw.toLowerCase().trim().replace(/-/g, " ");
  if (/^\d+$/.test(t)) return Number(t);
  if (t in NUM_WORDS) return NUM_WORDS[t]!;
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length === 2 && parts[0]! in NUM_WORDS && parts[1]! in NUM_WORDS) {
    return NUM_WORDS[parts[0]!]! + NUM_WORDS[parts[1]!]!;
  }
  return null;
}

/**
 * Parse a fractional part into digit characters (no leading dot).
 * Supports: "5", "25", "five", "two five", "seven five".
 */
export function parseSpokenFraction(raw: string): string | null {
  const t = raw.toLowerCase().trim().replace(/-/g, " ");
  if (/^\d+$/.test(t)) return t;
  for (const { pattern, digits } of MULTI_FRAC_PHRASES) {
    if (new RegExp(`^${pattern}$`, "i").test(t)) return digits;
  }
  if (t in DIGIT_WORDS) return DIGIT_WORDS[t]!;
  return null;
}

function formatDecimal(whole: number, fractionDigits: string): string {
  return `${whole}.${fractionDigits}`;
}

function wholeNumberPattern(): string {
  return `(?:(?:${NUM_WORD_ALT})(?:[\\s-]+(?:${NUM_WORD_ALT}))?|\\d+)`;
}

/** Multi-place spoken/digit fractions (.25, .75, .50, or "25"). */
function multiFractionPattern(): string {
  const phrases = MULTI_FRAC_PHRASES.map((p) => p.pattern).join("|");
  return `(?:${phrases}|\\d{2})`;
}

/** Single-place spoken/digit fraction (.5, "5"). */
function singleFractionPattern(): string {
  return `(?:${DIGIT_WORD_ALT}|\\d)`;
}

function replaceWholeSepFraction(text: string, fracPat: string): string {
  const whole = wholeNumberPattern();
  return text.replace(
    new RegExp(`\\b(${whole})\\s+(?:${SEP_ALT})\\s+(${fracPat})\\b`, "gi"),
    (match, w: string, f: string) => {
      const n = parseSpokenWhole(w);
      const fd = parseSpokenFraction(f);
      if (n === null || fd === null) return match;
      return formatDecimal(n, fd);
    },
  );
}

function replaceBareSepFraction(text: string, fracPat: string): string {
  return text.replace(
    new RegExp(`(?:^|[^\\w.])(?:${SEP_ALT})\\s+(${fracPat})\\b`, "gi"),
    (match, f: string) => {
      const fd = parseSpokenFraction(f);
      if (fd === null) return match;
      const prefix = match.match(/^([^\w.]*)/)?.[1] ?? "";
      return `${prefix}${formatDecimal(0, fd)}`;
    },
  );
}

/**
 * Normalise all supported spoken / locale decimal forms into canonical
 * `N.frac` digit strings. Safe to run on a full utterance (name + marks).
 */
export function normalizeSpokenDecimals(raw: string): string {
  let t = raw;

  // 1. Digit forms with a comma decimal separator (SA/EU): "12,5" → "12.5"
  t = t.replace(/\b(\d+),(\d+)\b/g, "$1.$2");

  // 2. Leading bare decimals from the speech engine: ".5", ",5" → "0.5"
  t = t.replace(/(^|[^\d])[.,](\d+)\b/g, (_m, pre: string, dig: string) => `${pre}0.${dig}`);

  const whole = wholeNumberPattern();

  // 3. "twelve and a half" / "twelve and half" → 12.5
  t = t.replace(
    new RegExp(`\\b(${whole})\\s+and\\s+(?:a\\s+)?half\\b`, "gi"),
    (match, w: string) => {
      const n = parseSpokenWhole(w);
      return n !== null ? formatDecimal(n, "5") : match;
    },
  );

  // 4. Multi-place fractions first ("seven point two five" → 7.25), then
  //    single-place ("eight point five" → 8.5). Ordering prevents
  //    "eight point five seven …" (two marks) being swallowed as 8.57.
  const multi = multiFractionPattern();
  const single = singleFractionPattern();
  t = replaceWholeSepFraction(t, multi);
  t = replaceWholeSepFraction(t, single);
  t = replaceBareSepFraction(t, multi);
  t = replaceBareSepFraction(t, single);

  return t;
}
