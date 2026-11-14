// Sprint 4 — Excel import helpers for historical marks.
// Builds the Penny template, parses uploaded files, and matches learner names.

import * as XLSX from "xlsx";

export const PENNY_TEMPLATE_HEADERS = [
  "Learner Name",
  "Assessment Name",
  "Mark",
  "Total",
  "Term Period",
  "Subject",
  "Category",
  "Assessment Date",
  "Topics Covered",
] as const;

export type ParsedRow = {
  rowIndex: number; // 1-based row number in the source file
  learnerName: string;
  assessmentName: string;
  mark: number | null;
  total: number | null;
  termPeriod: string | null;
  subject: string | null;
  category: string | null;
  assessmentDate: string | null; // ISO yyyy-mm-dd
  topicsCovered: string | null;
  // Validation:
  valid: boolean;
  reason?: string;
};

/** Generate the Penny import template (.xlsx) and trigger a browser download. */
export function downloadPennyTemplate() {
  const example = [
    "Alex Morgan",
    "Class Test 1",
    45,
    50,
    "Term 1",
    "Mathematics",
    "Class Test",
    "2026-02-15",
    "Fractions and decimals",
  ];
  const rows: (string | number)[][] = [
    [...PENNY_TEMPLATE_HEADERS],
    example,
  ];
  // Pad with blank rows for data entry.
  for (let i = 0; i < 30; i++) rows.push(["", "", "", "", "", "", "", "", ""]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 22 }, { wch: 24 }, { wch: 8 }, { wch: 8 },
    { wch: 14 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 32 },
  ];
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  // Bold header row (xlsx is limited on styling without the pro build, but values + freeze work fine).
  for (let c = 0; c < PENNY_TEMPLATE_HEADERS.length; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    const cell = ws[addr];
    if (cell) cell.s = { font: { bold: true } };
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Marks");
  XLSX.writeFile(wb, "penny_import_template.xlsx");
}

/** Read an .xlsx or .csv file as a 2D array of cell values (first sheet). */
export async function readFileAsRows(file: File): Promise<unknown[][]> {
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("File too large — max 10MB.");
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, blankrows: false });
}

const HEADER_CANONICAL: Record<string, keyof Omit<ParsedRow, "rowIndex" | "valid" | "reason">> = {
  "learner name": "learnerName",
  "learner": "learnerName",
  "name": "learnerName",
  "full name": "learnerName",
  "student": "learnerName",
  "assessment name": "assessmentName",
  "assessment": "assessmentName",
  "test": "assessmentName",
  "mark": "mark",
  "score": "mark",
  "result": "mark",
  "total": "total",
  "out of": "total",
  "total marks": "total",
  "term period": "termPeriod",
  "term": "termPeriod",
  "subject": "subject",
  "category": "category",
  "type": "category",
  "assessment date": "assessmentDate",
  "date": "assessmentDate",
  "topics covered": "topicsCovered",
  "topics": "topicsCovered",
};

/** Try to detect Penny template columns automatically from headers. Returns a mapping by column index. */
export function detectColumns(headers: unknown[]): Record<number, keyof Omit<ParsedRow, "rowIndex" | "valid" | "reason"> | "ignore"> {
  const map: Record<number, keyof Omit<ParsedRow, "rowIndex" | "valid" | "reason"> | "ignore"> = {};
  headers.forEach((h, i) => {
    const key = String(h ?? "").toLowerCase().trim();
    map[i] = HEADER_CANONICAL[key] ?? "ignore";
  });
  return map;
}

function toIsoDate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s; // keep as-is, downstream will note invalid
  return d.toISOString().slice(0, 10);
}

function toNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/,/g, "."));
  return Number.isFinite(n) ? n : null;
}

/** Parse rows from a column map. Skips the header row (rowIndex 1). */
export function parseRows(
  raw: unknown[][],
  columnMap: Record<number, keyof Omit<ParsedRow, "rowIndex" | "valid" | "reason"> | "ignore">,
  options: { firstNameCol?: number; surnameCol?: number; assessmentNameFallback?: string; totalFallback?: number } = {},
): ParsedRow[] {
  const out: ParsedRow[] = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i] ?? [];
    const isBlank = r.every((c) => c == null || String(c).trim() === "");
    if (isBlank) continue;

    let learnerName = "";
    let assessmentName = "";
    let mark: number | null = null;
    let total: number | null = null;
    let termPeriod: string | null = null;
    let subject: string | null = null;
    let category: string | null = null;
    let assessmentDate: string | null = null;
    let topicsCovered: string | null = null;

    for (const [idxStr, field] of Object.entries(columnMap)) {
      if (field === "ignore") continue;
      const v = r[Number(idxStr)];
      switch (field) {
        case "learnerName": learnerName = String(v ?? "").trim(); break;
        case "assessmentName": assessmentName = String(v ?? "").trim(); break;
        case "mark": mark = toNumber(v); break;
        case "total": total = toNumber(v); break;
        case "termPeriod": termPeriod = v ? String(v).trim() : null; break;
        case "subject": subject = v ? String(v).trim() : null; break;
        case "category": category = v ? String(v).trim() : null; break;
        case "assessmentDate": assessmentDate = toIsoDate(v); break;
        case "topicsCovered": topicsCovered = v ? String(v).trim() : null; break;
      }
    }

    // First name + Surname → combine
    if (!learnerName && (options.firstNameCol != null || options.surnameCol != null)) {
      const first = options.firstNameCol != null ? String(r[options.firstNameCol] ?? "").trim() : "";
      const last = options.surnameCol != null ? String(r[options.surnameCol] ?? "").trim() : "";
      learnerName = `${first} ${last}`.trim();
    }

    if (!assessmentName && options.assessmentNameFallback) assessmentName = options.assessmentNameFallback;
    if (total == null && options.totalFallback != null) total = options.totalFallback;

    let valid = true;
    let reason: string | undefined;
    if (!learnerName) { valid = false; reason = "missing name"; }
    else if (!assessmentName) { valid = false; reason = "missing assessment"; }
    else if (mark == null) { valid = false; reason = "missing mark"; }
    else if (total == null || total <= 0) { valid = false; reason = "missing total"; }
    else if (mark > total) { valid = false; reason = "mark exceeds total"; }

    out.push({
      rowIndex: i + 1,
      learnerName, assessmentName, mark, total,
      termPeriod, subject, category, assessmentDate, topicsCovered,
      valid, reason,
    });
  }
  return out;
}

// ─── Name matching ────────────────────────────────────────────────────────

function normalise(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

export type LearnerLite = { id: string; name: string; aliases?: string[] | null };

/** Match a name against existing class learners. Returns learner id or null. */
export function matchLearner(input: string, learners: LearnerLite[]): string | null {
  const target = normalise(input);
  if (!target) return null;
  // Exact normalised match.
  for (const l of learners) {
    if (normalise(l.name) === target) return l.id;
    for (const a of l.aliases ?? []) if (normalise(a) === target) return l.id;
  }
  // Token-subset match: every token of the shorter name appears in the other.
  const tokens = target.split(" ");
  for (const l of learners) {
    const ln = normalise(l.name);
    const lTokens = ln.split(" ");
    const short = tokens.length <= lTokens.length ? tokens : lTokens;
    const long = tokens.length <= lTokens.length ? lTokens : tokens;
    if (short.length > 0 && short.every((t) => long.includes(t))) return l.id;
  }
  return null;
}
