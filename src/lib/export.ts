// ============================================================================
// Penny Export Centre
// ----------------------------------------------------------------------------
// Teachers always own their data. This module turns Penny records into
// portable files: Excel workbooks today, CSV today, and easily-pluggable
// destinations tomorrow (SASAMS, d6, Google Sheets, Excel Online, PDF…).
//
// The architecture is intentionally split into three concerns:
//
//   1. SOURCES  — fetch the raw records for "what to export"
//                 (current assessment, entire class, individual learner,
//                  everything).
//   2. WORKBOOK BUILDERS — shape the records into rows/sheets that read
//                          naturally for a teacher in Excel.
//   3. FORMATTERS — write the shaped data to a downloadable file
//                   (xlsx today, csv today, pdf/sasams/d6/sheets tomorrow).
//
// To add a new format, register it in `FORMAT_REGISTRY` below. Sources and
// builders return a neutral `Workbook` shape so any future formatter can
// consume them without touching the data layer.
// ============================================================================

import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { pct } from "@/lib/penny";

// ─── Neutral workbook shape ────────────────────────────────────────────────
export type CellValue = string | number | null;
export type Sheet = {
  name: string;            // worksheet tab name (Excel limits to 31 chars)
  headerLines?: string[];  // free-text title lines before the table
  columns: string[];       // column headers
  rows: CellValue[][];     // data rows, aligned to columns
};
export type Workbook = {
  filename: string;        // base filename, no extension
  sheets: Sheet[];
};

// ─── Source / format types (extensible) ────────────────────────────────────
export type ExportSourceKind =
  | "assessment"
  | "class"
  | "learner"
  | "everything";

export type ExportFormat = "xlsx" | "csv";

export type ExportSource =
  | { kind: "assessment"; assessmentId: string }
  | { kind: "class"; classId: string }
  | { kind: "learner"; learnerId: string }
  | { kind: "everything"; teacherId: string };

// Future-ready: a registry lets us add formats without touching call sites.
type Formatter = {
  id: string;
  label: string;
  ext: string;
  mimeType: string;
  comingSoon?: boolean;
  // Best-fit hint per source (UI shows "Excel recommended").
  recommendedFor?: ExportSourceKind[];
  // When false, the format can't represent the source faithfully (e.g. CSV
  // cannot hold multiple worksheets); UI shows a friendly explanation.
  supports?: (kind: ExportSourceKind) => boolean;
  write: (wb: Workbook) => void;
};

export const FORMAT_REGISTRY: Record<string, Formatter> = {
  xlsx: {
    id: "xlsx",
    label: "Excel (.xlsx)",
    ext: "xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    recommendedFor: ["assessment", "class", "learner", "everything"],
    write: writeXlsx,
  },
  csv: {
    id: "csv",
    label: "CSV (.csv)",
    ext: "csv",
    mimeType: "text/csv",
    // CSV is one table — perfect for a single assessment or learner, not
    // for a multi-sheet class export.
    supports: (k) => k === "assessment" || k === "learner",
    write: writeCsv,
  },
  pdf: {
    id: "pdf",
    label: "PDF",
    ext: "pdf",
    mimeType: "application/pdf",
    comingSoon: true,
    write: () => { throw new Error("PDF export coming soon."); },
  },
};

// ─── Public entry point ────────────────────────────────────────────────────
export async function runExport(source: ExportSource, format: ExportFormat) {
  const fmt = FORMAT_REGISTRY[format];
  if (!fmt) throw new Error("Unknown export format");
  if (fmt.comingSoon) throw new Error(`${fmt.label} is coming soon.`);

  const wb = await buildWorkbookFor(source);
  fmt.write(wb);
}

async function buildWorkbookFor(source: ExportSource): Promise<Workbook> {
  switch (source.kind) {
    case "assessment": return buildAssessmentWorkbook(source.assessmentId);
    case "class":      return buildClassWorkbook(source.classId);
    case "learner":    return buildLearnerWorkbook(source.learnerId);
    case "everything": return buildEverythingWorkbook(source.teacherId);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function safe(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "penny";
}

function tabName(s: string): string {
  // Excel: max 31 chars, no [ ] : * ? / \
  return s.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet";
}

function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type DbAssessment = {
  id: string; name: string; assessment_type: string; assessment_date: string;
  total_marks: number; pass_mark: number; capture_mode: string;
  sections: { name: string; total: number }[] | null;
  class_id: string;
  classes?: { name: string; grade: string; subject: string } | null;
};
type DbLearner = {
  id: string; name: string; class_id: string;
  pronunciation: string | null; aliases: string[] | null; active: boolean;
};
type DbMark = {
  learner_id: string; assessment_id: string;
  mark: number | null; status: string; section_marks: number[] | null;
};

// ─── Sheet builders ────────────────────────────────────────────────────────
type Stats = {
  count: number; absent: number; missing: number;
  avg: number | null; avgPct: number | null;
  highest: { name: string; mark: number; pct: number } | null;
  lowest: { name: string; mark: number; pct: number } | null;
};

function computeStats(
  learners: DbLearner[], marks: Map<string, DbMark>, totalMarks: number,
): Stats {
  let sum = 0, count = 0, absent = 0, missing = 0;
  let highest: Stats["highest"] = null;
  let lowest: Stats["lowest"] = null;
  for (const l of learners) {
    const m = marks.get(l.id);
    if (!m) { missing++; continue; }
    if (m.status === "absent") { absent++; continue; }
    if (typeof m.mark !== "number") continue;
    sum += m.mark; count++;
    const p = pct(m.mark, totalMarks);
    if (!highest || m.mark > highest.mark) highest = { name: l.name, mark: m.mark, pct: p };
    if (!lowest || m.mark < lowest.mark) lowest = { name: l.name, mark: m.mark, pct: p };
  }
  const avg = count ? sum / count : null;
  const avgPct = avg != null ? pct(avg, totalMarks) : null;
  return { count, absent, missing, avg, avgPct, highest, lowest };
}

function assessmentSheet(
  a: DbAssessment,
  learners: DbLearner[],
  marks: Map<string, DbMark>,
): Sheet {
  const sections = a.sections ?? [];
  const hasSections = a.capture_mode === "sections" && sections.length > 0;

  const columns = ["#", "Learner"];
  if (hasSections) sections.forEach((s) => columns.push(`${s.name} (/${s.total})`));
  columns.push("Mark", "Out of", "Percent", "Status");

  const rows: CellValue[][] = learners.map((l, i) => {
    const m = marks.get(l.id);
    const status = !m ? "Missing" : m.status === "absent" ? "Absent" : "Captured";
    const mark =
      m?.status === "captured" && typeof m.mark === "number" ? m.mark : null;
    const percent =
      mark != null ? pct(mark, a.total_marks) : null;
    const row: CellValue[] = [i + 1, l.name];
    if (hasSections) {
      sections.forEach((_, si) => {
        const v = m?.section_marks?.[si];
        row.push(typeof v === "number" ? v : null);
      });
    }
    row.push(mark, a.total_marks, percent != null ? percent / 100 : null, status);
    return row;
  });

  const s = computeStats(learners, marks, a.total_marks);
  const headerLines = [
    a.name,
    `${a.assessment_type} · ${a.assessment_date}`,
    `Class: ${a.classes?.name ?? ""} · Out of: ${a.total_marks} · Pass mark: ${a.pass_mark}%`,
    `Class average: ${s.avgPct != null ? s.avgPct + "%" : "—"}  ·  ` +
      `Highest: ${s.highest ? `${s.highest.name} (${s.highest.mark}/${a.total_marks})` : "—"}  ·  ` +
      `Lowest: ${s.lowest ? `${s.lowest.name} (${s.lowest.mark}/${a.total_marks})` : "—"}`,
    `Captured: ${s.count} · Absent: ${s.absent} · Missing: ${s.missing}`,
  ];

  return { name: tabName(a.name), headerLines, columns, rows };
}

// ─── Source: single assessment ─────────────────────────────────────────────
async function buildAssessmentWorkbook(assessmentId: string): Promise<Workbook> {
  const { data: a, error } = await supabase
    .from("assessments")
    .select("id, name, assessment_type, assessment_date, total_marks, pass_mark, capture_mode, sections, class_id, classes(name, grade, subject)")
    .eq("id", assessmentId).single();
  if (error || !a) throw new Error(error?.message ?? "Assessment not found");

  const assessment = a as unknown as DbAssessment;
  const [{ data: learners }, { data: marks }] = await Promise.all([
    supabase.from("learners")
      .select("id, name, class_id, pronunciation, aliases, active")
      .eq("class_id", assessment.class_id).eq("active", true).order("sort_key"),
    supabase.from("marks")
      .select("learner_id, assessment_id, mark, status, section_marks")
      .eq("assessment_id", assessmentId),
  ]);

  const marksMap = new Map<string, DbMark>();
  for (const m of (marks ?? []) as DbMark[]) marksMap.set(m.learner_id, m);

  const sheet = assessmentSheet(assessment, (learners ?? []) as DbLearner[], marksMap);
  return {
    filename: `${safe(assessment.name)}_${todayStamp()}`,
    sheets: [sheet],
  };
}

// ─── Source: entire class ──────────────────────────────────────────────────
async function buildClassWorkbook(classId: string): Promise<Workbook> {
  const { data: cls, error: ce } = await supabase
    .from("classes").select("id, name, grade, subject").eq("id", classId).single();
  if (ce || !cls) throw new Error(ce?.message ?? "Class not found");

  const [{ data: learners }, { data: assessments }, { data: marks }] = await Promise.all([
    supabase.from("learners")
      .select("id, name, class_id, pronunciation, aliases, active")
      .eq("class_id", classId).eq("active", true).order("sort_key"),
    supabase.from("assessments")
      .select("id, name, assessment_type, assessment_date, total_marks, pass_mark, capture_mode, sections, class_id")
      .eq("class_id", classId).order("assessment_date", { ascending: true }),
    supabase.from("marks")
      .select("learner_id, assessment_id, mark, status, section_marks, assessments!inner(class_id)")
      .eq("assessments.class_id", classId),
  ]);

  const dbLearners = (learners ?? []) as DbLearner[];
  const dbAssessments = ((assessments ?? []) as DbAssessment[]).map((a) => ({
    ...a, classes: { name: cls.name, grade: cls.grade, subject: cls.subject },
  }));
  const dbMarks = (marks ?? []) as DbMark[];

  const sheets: Sheet[] = [];

  // 1. Summary sheet — one row per assessment.
  const summaryRows: CellValue[][] = dbAssessments.map((a) => {
    const m = new Map<string, DbMark>();
    for (const x of dbMarks) if (x.assessment_id === a.id) m.set(x.learner_id, x);
    const s = computeStats(dbLearners, m, a.total_marks);
    return [
      a.assessment_date, a.name, a.assessment_type, a.total_marks, a.pass_mark,
      s.count, s.absent, s.missing,
      s.avgPct != null ? s.avgPct / 100 : null,
      s.highest ? `${s.highest.name} (${s.highest.mark}/${a.total_marks})` : null,
      s.lowest ? `${s.lowest.name} (${s.lowest.mark}/${a.total_marks})` : null,
    ];
  });
  sheets.push({
    name: "Summary",
    headerLines: [
      cls.name,
      `${cls.grade} · ${cls.subject}`,
      `Learners: ${dbLearners.length} · Assessments: ${dbAssessments.length}`,
    ],
    columns: ["Date", "Assessment", "Type", "Out of", "Pass %", "Captured", "Absent", "Missing", "Class avg", "Highest", "Lowest"],
    rows: summaryRows,
  });

  // 2. Learner Progress — wide table: row per learner, column per assessment %.
  const progCols = ["#", "Learner", ...dbAssessments.map((a) => tabName(a.name)), "Overall %"];
  const progRows: CellValue[][] = dbLearners.map((l, i) => {
    const row: CellValue[] = [i + 1, l.name];
    let sumP = 0, n = 0;
    for (const a of dbAssessments) {
      const m = dbMarks.find((x) => x.assessment_id === a.id && x.learner_id === l.id);
      if (!m) { row.push(null); continue; }
      if (m.status === "absent") { row.push("Absent"); continue; }
      if (typeof m.mark !== "number") { row.push(null); continue; }
      const p = pct(m.mark, a.total_marks);
      row.push(p / 100);
      sumP += p; n++;
    }
    row.push(n ? Math.round(sumP / n) / 100 : null);
    return row;
  });
  sheets.push({
    name: "Learner Progress",
    headerLines: [`${cls.name} — progress across all assessments`],
    columns: progCols, rows: progRows,
  });

  // 3. Class Statistics — quick KPI block.
  const allCaptured = dbMarks.filter((m) => m.status === "captured" && typeof m.mark === "number");
  const overallPct = allCaptured.length
    ? Math.round(allCaptured.reduce((s, m) => {
        const a = dbAssessments.find((x) => x.id === m.assessment_id);
        return s + (a ? pct(m.mark as number, a.total_marks) : 0);
      }, 0) / allCaptured.length)
    : null;
  sheets.push({
    name: "Class Statistics",
    headerLines: [`${cls.name} — at a glance`],
    columns: ["Metric", "Value"],
    rows: [
      ["Active learners", dbLearners.length],
      ["Assessments", dbAssessments.length],
      ["Marks captured", allCaptured.length],
      ["Overall class average", overallPct != null ? overallPct / 100 : null],
      ["Exported on", todayStamp()],
    ],
  });

  // 4. One sheet per assessment — full detail.
  for (const a of dbAssessments) {
    const m = new Map<string, DbMark>();
    for (const x of dbMarks) if (x.assessment_id === a.id) m.set(x.learner_id, x);
    sheets.push(assessmentSheet(a, dbLearners, m));
  }

  return { filename: `${safe(cls.name)}_class_${todayStamp()}`, sheets };
}

// ─── Source: individual learner ────────────────────────────────────────────
async function buildLearnerWorkbook(learnerId: string): Promise<Workbook> {
  const { data: learner, error } = await supabase
    .from("learners")
    .select("id, name, class_id, pronunciation, aliases, active, classes(name, grade, subject)")
    .eq("id", learnerId).single();
  if (error || !learner) throw new Error(error?.message ?? "Learner not found");

  const cls = (learner as { classes: { name: string; grade: string; subject: string } | null }).classes;

  const [{ data: assessments }, { data: marks }] = await Promise.all([
    supabase.from("assessments")
      .select("id, name, assessment_type, assessment_date, total_marks, pass_mark")
      .eq("class_id", learner.class_id).order("assessment_date", { ascending: true }),
    supabase.from("marks")
      .select("learner_id, assessment_id, mark, status, section_marks")
      .eq("learner_id", learnerId),
  ]);

  type DbA = { id: string; name: string; assessment_type: string; assessment_date: string; total_marks: number; pass_mark: number };
  const dbAssessments = (assessments ?? []) as DbA[];
  const dbMarks = (marks ?? []) as DbMark[];
  const byAsmt = new Map(dbMarks.map((m) => [m.assessment_id, m] as const));

  const rows: CellValue[][] = dbAssessments.map((a) => {
    const m = byAsmt.get(a.id);
    const status = !m ? "Missing" : m.status === "absent" ? "Absent" : "Captured";
    const mark = m?.status === "captured" && typeof m.mark === "number" ? m.mark : null;
    const p = mark != null ? pct(mark, a.total_marks) : null;
    return [a.assessment_date, a.name, a.assessment_type, mark, a.total_marks, p != null ? p / 100 : null, status];
  });

  const captured = rows.filter((r) => typeof r[5] === "number");
  const avg = captured.length
    ? captured.reduce((s, r) => s + (r[5] as number), 0) / captured.length
    : null;

  const sheets: Sheet[] = [
    {
      name: "Assessment history",
      headerLines: [
        learner.name,
        cls ? `${cls.name} · ${cls.grade} · ${cls.subject}` : "",
        `Overall average: ${avg != null ? Math.round(avg * 100) + "%" : "—"} across ${captured.length} assessment${captured.length === 1 ? "" : "s"}`,
      ].filter(Boolean),
      columns: ["Date", "Assessment", "Type", "Mark", "Out of", "Percent", "Status"],
      rows,
    },
    {
      name: "Progress",
      headerLines: [`${learner.name} — progress over time`],
      columns: ["Date", "Assessment", "Percent"],
      rows: rows
        .filter((r) => typeof r[5] === "number")
        .map((r) => [r[0], r[1], r[5]]),
    },
  ];

  return { filename: `${safe(learner.name)}_${todayStamp()}`, sheets };
}

// ─── Source: everything for this teacher ───────────────────────────────────
async function buildEverythingWorkbook(teacherId: string): Promise<Workbook> {
  const { data: classes, error } = await supabase
    .from("classes").select("id, name, grade, subject")
    .eq("teacher_id", teacherId).order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const sheets: Sheet[] = [];
  const overviewRows: CellValue[][] = [];

  for (const cls of classes ?? []) {
    const [{ data: learners }, { data: assessments }, { data: marks }] = await Promise.all([
      supabase.from("learners")
        .select("id, name, class_id, pronunciation, aliases, active")
        .eq("class_id", cls.id).eq("active", true).order("sort_key"),
      supabase.from("assessments")
        .select("id, name, assessment_type, assessment_date, total_marks, pass_mark, capture_mode, sections, class_id")
        .eq("class_id", cls.id).order("assessment_date", { ascending: true }),
      supabase.from("marks")
        .select("learner_id, assessment_id, mark, status, section_marks, assessments!inner(class_id)")
        .eq("assessments.class_id", cls.id),
    ]);

    const dbLearners = (learners ?? []) as DbLearner[];
    const dbAssessments = ((assessments ?? []) as DbAssessment[]).map((a) => ({
      ...a, classes: { name: cls.name, grade: cls.grade, subject: cls.subject },
    }));
    const dbMarks = (marks ?? []) as DbMark[];

    // Per-class summary row.
    const allCaptured = dbMarks.filter((m) => m.status === "captured" && typeof m.mark === "number");
    const overallPct = allCaptured.length
      ? Math.round(allCaptured.reduce((s, m) => {
          const a = dbAssessments.find((x) => x.id === m.assessment_id);
          return s + (a ? pct(m.mark as number, a.total_marks) : 0);
        }, 0) / allCaptured.length)
      : null;
    overviewRows.push([
      cls.name, cls.grade, cls.subject,
      dbLearners.length, dbAssessments.length,
      overallPct != null ? overallPct / 100 : null,
    ]);

    // Per-class summary sheet.
    sheets.push({
      name: tabName(`${cls.name} — Summary`),
      headerLines: [cls.name, `${cls.grade} · ${cls.subject}`],
      columns: ["Date", "Assessment", "Type", "Out of", "Captured", "Absent", "Missing", "Class avg"],
      rows: dbAssessments.map((a) => {
        const m = new Map<string, DbMark>();
        for (const x of dbMarks) if (x.assessment_id === a.id) m.set(x.learner_id, x);
        const s = computeStats(dbLearners, m, a.total_marks);
        return [a.assessment_date, a.name, a.assessment_type, a.total_marks,
          s.count, s.absent, s.missing,
          s.avgPct != null ? s.avgPct / 100 : null];
      }),
    });

    // One sheet per assessment for full detail.
    for (const a of dbAssessments) {
      const m = new Map<string, DbMark>();
      for (const x of dbMarks) if (x.assessment_id === a.id) m.set(x.learner_id, x);
      sheets.push({
        ...assessmentSheet(a, dbLearners, m),
        name: tabName(`${cls.name} · ${a.name}`),
      });
    }
  }

  sheets.unshift({
    name: "All Classes",
    headerLines: [`Penny export · ${todayStamp()}`, `${(classes ?? []).length} class${(classes ?? []).length === 1 ? "" : "es"}`],
    columns: ["Class", "Grade", "Subject", "Learners", "Assessments", "Overall avg"],
    rows: overviewRows,
  });

  return { filename: `penny_everything_${todayStamp()}`, sheets };
}

// ─── Formatters ────────────────────────────────────────────────────────────
function sheetToAoa(sheet: Sheet): CellValue[][] {
  const aoa: CellValue[][] = [];
  if (sheet.headerLines) for (const h of sheet.headerLines) aoa.push([h]);
  if (sheet.headerLines && sheet.headerLines.length) aoa.push([]);
  aoa.push(sheet.columns);
  for (const r of sheet.rows) aoa.push(r);
  return aoa;
}

function writeXlsx(wb: Workbook) {
  const xlwb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const s of wb.sheets) {
    let n = tabName(s.name);
    let i = 2;
    while (used.has(n.toLowerCase())) {
      const suffix = ` (${i++})`;
      n = tabName(s.name).slice(0, 31 - suffix.length) + suffix;
    }
    used.add(n.toLowerCase());

    const ws = XLSX.utils.aoa_to_sheet(sheetToAoa(s));
    // Percent formatting where appropriate
    const headerRow = (s.headerLines?.length ?? 0) + (s.headerLines?.length ? 1 : 0);
    for (let ci = 0; ci < s.columns.length; ci++) {
      const col = s.columns[ci].toLowerCase();
      if (!(col.includes("percent") || col.includes("avg") || col.includes("pass %"))) continue;
      for (let ri = 0; ri < s.rows.length; ri++) {
        const addr = XLSX.utils.encode_cell({ r: headerRow + 1 + ri, c: ci });
        const cell = ws[addr];
        if (cell && typeof cell.v === "number") cell.z = "0%";
      }
    }
    // Reasonable column widths
    ws["!cols"] = s.columns.map((c) => ({ wch: Math.min(40, Math.max(10, c.length + 4)) }));
    XLSX.utils.book_append_sheet(xlwb, ws, n);
  }
  XLSX.writeFile(xlwb, `${wb.filename}.xlsx`);
}

function writeCsv(wb: Workbook) {
  // For CSV we use the first (and typically only) sheet.
  const sheet = wb.sheets[0];
  if (!sheet) throw new Error("Nothing to export");
  const aoa = sheetToAoa(sheet);
  const lines = aoa.map((row) =>
    row.map((v) => {
      if (v == null) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(","),
  );
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${wb.filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
