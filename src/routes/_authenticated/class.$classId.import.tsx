import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { ArrowRight, Download, FileSpreadsheet, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/penny/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useCurrentAcademicYear, useTermPeriods } from "@/hooks/use-academic-year";
import {
  downloadPennyTemplate, readFileAsRows, detectColumns, parseRows,
  matchLearner, PENNY_TEMPLATE_HEADERS, type ParsedRow, type LearnerLite,
} from "@/lib/import-marks";

export const Route = createFileRoute("/_authenticated/class/$classId/import")({
  head: () => ({ meta: [{ title: "Import marks – Penny" }] }),
  component: ImportPage,
});

type Decision = "left" | "stay" | "skip";
type Step = "choose" | "mapping" | "review" | "resolve" | "confirm" | "done";

function ImportPage() {
  const { classId } = Route.useParams();
  return <ImportFlow classId={classId} />;
}

function ImportFlow({ classId }: { classId: string }) {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const { current: currentYear } = useCurrentAcademicYear();
  const { data: termPeriods = [] } = useTermPeriods(currentYear?.id);

  const { data: learners = [] } = useQuery({
    queryKey: ["learners-all", classId],
    queryFn: async (): Promise<LearnerLite[]> => {
      const { data, error } = await supabase
        .from("learners").select("id, name, aliases")
        .eq("class_id", classId);
      if (error) throw error;
      return data ?? [];
    },
  });

  const [step, setStep] = useState<Step>("choose");
  const [method, setMethod] = useState<"penny_template" | "custom_excel" | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [rawRows, setRawRows] = useState<unknown[][]>([]);
  const [columnMap, setColumnMap] = useState<Record<number, string>>({});
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File, asTemplate: boolean) {
    if (file.size > 10 * 1024 * 1024) { toast.error("File too large — max 10MB."); return; }
    try {
      const rows = await readFileAsRows(file);
      setFileName(file.name);
      setRawRows(rows);
      if (asTemplate) {
        setMethod("penny_template");
        const map = detectColumns(rows[0] ?? []);
        // Force the template's known order in case headers were modified.
        const safeMap: Record<number, string> = {};
        PENNY_TEMPLATE_HEADERS.forEach((_, i) => {
          safeMap[i] = (map[i] && map[i] !== "ignore") ? map[i] : ([
            "learnerName", "assessmentName", "mark", "total",
            "termPeriod", "subject", "category", "assessmentDate", "topicsCovered",
          ][i] as string);
        });
        setColumnMap(safeMap);
        const p = parseRows(rows, safeMap as Parameters<typeof parseRows>[1]);
        setParsed(p);
        setStep("review");
      } else {
        setMethod("custom_excel");
        const auto = detectColumns(rows[0] ?? []);
        const init: Record<number, string> = {};
        (rows[0] ?? []).forEach((_, i) => { init[i] = auto[i] ?? "ignore"; });
        setColumnMap(init);
        setStep("mapping");
      }
    } catch {
      toast.error("Could not read that file. Try a .xlsx or .csv.");
    }
  }

  function applyMapping() {
    // Detect first-name / surname split.
    let firstNameCol: number | undefined;
    let surnameCol: number | undefined;
    Object.entries(columnMap).forEach(([k, v]) => {
      if (v === "firstName") firstNameCol = Number(k);
      if (v === "surname") surnameCol = Number(k);
    });
    const sanitised: Record<number, "ignore" | keyof Omit<ParsedRow, "rowIndex" | "valid" | "reason">> = {};
    Object.entries(columnMap).forEach(([k, v]) => {
      if (v === "firstName" || v === "surname") { sanitised[Number(k)] = "ignore"; }
      else { sanitised[Number(k)] = v as "ignore" | keyof Omit<ParsedRow, "rowIndex" | "valid" | "reason">; }
    });
    const p = parseRows(rawRows, sanitised, { firstNameCol, surnameCol });
    setParsed(p);
    setStep("review");
  }

  // Compute unmatched names + match results
  const rowMatches = useMemo(() => {
    return parsed.map((r) => ({
      row: r,
      matchedId: r.valid ? matchLearner(r.learnerName, learners) : null,
    }));
  }, [parsed, learners]);

  const unmatchedNames = useMemo(() => {
    const set = new Map<string, ParsedRow>();
    for (const m of rowMatches) {
      if (m.row.valid && !m.matchedId) {
        const key = m.row.learnerName.trim();
        if (!set.has(key)) set.set(key, m.row);
      }
    }
    return Array.from(set.keys());
  }, [rowMatches]);

  const counts = useMemo(() => {
    let ready = 0, missing = 0, skipped = 0;
    for (const m of rowMatches) {
      if (!m.row.valid) { skipped++; continue; }
      if (m.matchedId) ready++; else missing++;
    }
    return { ready, missing, skipped, totalRows: rowMatches.length };
  }, [rowMatches]);

  const allDecided = unmatchedNames.every((n) => decisions[n]);

  async function runImport() {
    setSaving(true);
    try {
      // 1. Create any new learners for unmatched decisions.
      const nameToLearnerId = new Map<string, string>();
      for (const [name, dec] of Object.entries(decisions)) {
        if (dec === "skip") continue;
        const { data: created, error } = await supabase.from("learners").insert({
          class_id: classId,
          teacher_id: user.id,
          name,
          active: dec === "stay",
        }).select("id").single();
        if (error) throw error;
        nameToLearnerId.set(name, created.id);
      }

      // 2. Group rows by assessment-identity and resolve assessment IDs.
      type AsmKey = string;
      const asmCache = new Map<AsmKey, string>();

      // Load existing assessments once.
      const { data: existing = [] } = await supabase
        .from("assessments").select("id, name, total_marks").eq("class_id", classId);
      const existingByKey = new Map<string, string>();
      (existing ?? []).forEach((a) => existingByKey.set(`${a.name.toLowerCase()}|${a.total_marks}`, a.id));

      const marksToUpsert: { assessment_id: string; learner_id: string; teacher_id: string; mark: number; status: "captured" }[] = [];
      let imported = 0, skipped = 0;
      let learnersAdded = 0, learnersArchived = 0;
      for (const dec of Object.values(decisions)) {
        if (dec === "stay") learnersAdded++;
        else if (dec === "left") learnersArchived++;
      }

      for (const m of rowMatches) {
        const r = m.row;
        if (!r.valid) { skipped++; continue; }

        // Resolve learner.
        let learnerId = m.matchedId;
        if (!learnerId) {
          const dec = decisions[r.learnerName.trim()];
          if (!dec || dec === "skip") { skipped++; continue; }
          learnerId = nameToLearnerId.get(r.learnerName.trim()) ?? null;
        }
        if (!learnerId) { skipped++; continue; }

        // Resolve / create assessment.
        const key: AsmKey = `${r.assessmentName.toLowerCase()}|${r.total}`;
        let aid = asmCache.get(key) ?? existingByKey.get(key);
        if (!aid) {
          // Match a term period by name if provided.
          let termPeriodId: string | null = null;
          if (r.termPeriod) {
            const tp = termPeriods.find((p) => p.name.toLowerCase() === r.termPeriod!.toLowerCase());
            if (tp) termPeriodId = tp.id;
          }
          const { data: createdA, error: aErr } = await supabase.from("assessments").insert({
            class_id: classId, teacher_id: user.id,
            name: r.assessmentName, total_marks: r.total!,
            assessment_type: r.category ?? "Imported",
            category: r.category ?? null,
            subject: r.subject ?? null,
            assessment_date: r.assessmentDate ?? new Date().toISOString().slice(0, 10),
            topics_covered: r.topicsCovered ?? null,
            academic_year_id: currentYear?.id ?? null,
            term_period_id: termPeriodId,
          }).select("id").single();
          if (aErr) throw aErr;
          aid = createdA.id;
          asmCache.set(key, aid);
        }

        marksToUpsert.push({
          assessment_id: aid, learner_id: learnerId, teacher_id: user.id,
          mark: r.mark!, status: "captured",
        });
        imported++;
      }

      if (marksToUpsert.length > 0) {
        const { error: mErr } = await supabase
          .from("marks").upsert(marksToUpsert, { onConflict: "assessment_id,learner_id" });
        if (mErr) throw mErr;
      }

      // 3. Log the import.
      await supabase.from("import_logs").insert({
        teacher_id: user.id, class_id: classId,
        file_name: fileName || null,
        rows_total: counts.totalRows,
        rows_imported: imported,
        rows_skipped: skipped,
        learners_added: learnersAdded,
        learners_archived: learnersArchived,
        import_method: method ?? "penny_template",
      });

      toast.success(`Done. ${imported} marks have been added to your records.`);
      setStep("done");
    } catch (e) {
      toast.error(e instanceof Error ? `Most marks imported — ${e.message}` : "Most marks imported successfully. Some rows could not be saved — nothing was lost.");
    } finally {
      setSaving(false);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────
  return (
    <AppShell back={`/class/${classId}`}>
      <div className="mb-4">
        <h1 className="font-display text-2xl font-semibold leading-tight">Import historical marks</h1>
        <p className="text-sm text-muted-foreground mt-1">Bring in marks from an Excel or CSV file.</p>
      </div>

      {step === "choose" && (
        <div className="space-y-3">
          <Card className="p-4 rounded-3xl shadow-soft">
            <p className="font-display text-lg font-semibold">Use Penny template</p>
            <p className="text-sm text-muted-foreground mt-1">
              Download our template, fill in your marks, and upload it here.
            </p>
            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              <Button variant="outline" className="rounded-xl h-11" onClick={downloadPennyTemplate}>
                <Download className="h-4 w-4 mr-2" /> Download template
              </Button>
              <label className="flex-1">
                <input
                  type="file" accept=".xlsx,.csv" className="sr-only"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f, true); }}
                />
                <span className="inline-flex w-full items-center justify-center rounded-xl h-11 bg-primary text-primary-foreground font-medium cursor-pointer">
                  <Upload className="h-4 w-4 mr-2" /> Upload filled template
                </span>
              </label>
            </div>
          </Card>

          <Card className="p-4 rounded-3xl shadow-soft">
            <p className="font-display text-lg font-semibold">Upload your own Excel</p>
            <p className="text-sm text-muted-foreground mt-1">
              Already have your marks in Excel? Upload your file and Penny will help you map the columns.
            </p>
            <div className="mt-3">
              <label>
                <input
                  type="file" accept=".xlsx,.csv" className="sr-only" ref={fileRef}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f, false); }}
                />
                <span className="inline-flex w-full items-center justify-center rounded-xl h-11 border border-border bg-card cursor-pointer">
                  <FileSpreadsheet className="h-4 w-4 mr-2" /> Drop your Excel file here or tap to browse
                </span>
              </label>
              <p className="text-[11px] text-muted-foreground text-center mt-2">Accepts .xlsx and .csv files. Max 10MB.</p>
            </div>
          </Card>
        </div>
      )}

      {step === "mapping" && (
        <div className="space-y-3">
          <Card className="p-4 rounded-3xl shadow-soft">
            <p className="font-display text-lg font-semibold">Help Penny understand your spreadsheet</p>
            <p className="text-sm text-muted-foreground mt-1">Match each column to what it contains.</p>
          </Card>

          <Card className="p-3 rounded-3xl shadow-soft divide-y divide-border">
            {(rawRows[0] ?? []).map((h, i) => (
              <div key={i} className="flex items-center gap-2 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">Column {String.fromCharCode(65 + i)}</p>
                  <p className="text-sm font-medium truncate">{String(h ?? "(no header)")}</p>
                </div>
                <Select value={columnMap[i] ?? "ignore"} onValueChange={(v) => setColumnMap((m) => ({ ...m, [i]: v }))}>
                  <SelectTrigger className="w-44 rounded-xl h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ignore">Not used</SelectItem>
                    <SelectItem value="learnerName">Learner full name</SelectItem>
                    <SelectItem value="firstName">Learner first name</SelectItem>
                    <SelectItem value="surname">Learner surname</SelectItem>
                    <SelectItem value="assessmentName">Assessment name</SelectItem>
                    <SelectItem value="mark">Mark</SelectItem>
                    <SelectItem value="total">Total marks</SelectItem>
                    <SelectItem value="termPeriod">Term period</SelectItem>
                    <SelectItem value="subject">Subject</SelectItem>
                    <SelectItem value="category">Category</SelectItem>
                    <SelectItem value="assessmentDate">Assessment date</SelectItem>
                    <SelectItem value="topicsCovered">Topics covered</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </Card>

          <PreviewMini rawRows={rawRows} columnMap={columnMap} />

          <Button onClick={applyMapping} className="w-full h-12 rounded-2xl">
            Looks correct — continue <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

      {step === "review" && (
        <div className="space-y-3">
          <Card className="p-4 rounded-3xl shadow-soft">
            <p className="font-display text-lg font-semibold">Here is what I found in your file</p>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <Stat n={counts.ready} label="ready to import" tone="success" />
              <Stat n={counts.missing} label="not found in class" tone="warn" />
              <Stat n={counts.skipped} label="rows skipped" tone="muted" />
            </div>
          </Card>

          <RowsTable rowMatches={rowMatches} />

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 h-12 rounded-2xl" onClick={() => setStep("choose")}>Start over</Button>
            <Button
              className="flex-1 h-12 rounded-2xl"
              onClick={() => setStep(unmatchedNames.length > 0 ? "resolve" : "confirm")}
              disabled={counts.ready + counts.missing === 0}
            >
              Continue <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {step === "resolve" && (
        <div className="space-y-3">
          <Card className="p-4 rounded-3xl shadow-soft">
            <p className="font-display text-lg font-semibold">I found some names that are not in this class</p>
            <p className="text-sm text-muted-foreground mt-1">Tell me about each one before we import.</p>
          </Card>

          <ul className="space-y-2">
            {unmatchedNames.map((n) => (
              <Card key={n} className="p-3 rounded-2xl shadow-soft">
                <p className="font-medium text-sm">{n}</p>
                <div className="mt-2 space-y-1">
                  {([
                    ["stay", "They are still in my class — add them and import their mark"],
                    ["left", "They left the class — import their mark but do not add them to the class"],
                    ["skip", "Skip this mark — ignore this row"],
                  ] as const).map(([val, label]) => (
                    <label key={val} className="flex items-start gap-2 p-2 rounded-lg hover:bg-card-warm cursor-pointer">
                      <input
                        type="radio" name={`d-${n}`} className="mt-1"
                        checked={decisions[n] === val}
                        onChange={() => setDecisions((d) => ({ ...d, [n]: val }))}
                      />
                      <span className="text-sm">{label}</span>
                    </label>
                  ))}
                </div>
              </Card>
            ))}
          </ul>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 h-12 rounded-2xl" onClick={() => setStep("review")}>Back</Button>
            <Button className="flex-1 h-12 rounded-2xl" disabled={!allDecided} onClick={() => setStep("confirm")}>
              Continue with import <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {step === "confirm" && (
        <div className="space-y-3">
          <Card className="p-4 rounded-3xl shadow-soft">
            <p className="font-display text-lg font-semibold">Ready to import — here is what will happen</p>
            <ul className="mt-3 space-y-1 text-sm">
              <li>• {counts.ready + Object.values(decisions).filter((d) => d !== "skip").length} marks will be imported</li>
              <li>• {Object.values(decisions).filter((d) => d === "stay").length} learners will be added to your class</li>
              <li>• {Object.values(decisions).filter((d) => d === "left").length} learners marked as having left</li>
              <li>• {counts.skipped + Object.values(decisions).filter((d) => d === "skip").length} rows skipped</li>
            </ul>
          </Card>

          <RowsTable rowMatches={rowMatches} decisions={decisions} />

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 h-12 rounded-2xl" onClick={() => setStep(unmatchedNames.length > 0 ? "resolve" : "review")}>
              Go back
            </Button>
            <Button className="flex-1 h-12 rounded-2xl" disabled={saving} onClick={() => void runImport()}>
              Import marks
            </Button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-3">
          <Card className="p-4 rounded-3xl shadow-soft">
            <p className="font-display text-lg font-semibold">Done.</p>
            <p className="text-sm mt-1">Marks have been added to your records.</p>
            <p className="text-sm text-muted-foreground mt-2">
              Penny can now use these marks for report comments and term mark calculations.
            </p>
          </Card>
          <Button asChild className="w-full h-12 rounded-2xl">
            <Link to="/class/$classId" params={{ classId }}>View imported marks</Link>
          </Button>
          <Button variant="outline" className="w-full h-12 rounded-2xl" onClick={() => navigate({ to: "/class/$classId", params: { classId } })}>
            Back to class
          </Button>
        </div>
      )}
    </AppShell>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: "success" | "warn" | "muted" }) {
  const cls =
    tone === "success" ? "text-success-foreground bg-success/15"
    : tone === "warn" ? "text-warning-foreground bg-warning/15"
    : "text-muted-foreground bg-muted";
  return (
    <div className={`rounded-2xl p-3 ${cls}`}>
      <p className="text-xl font-display font-semibold leading-none">{n}</p>
      <p className="text-[11px] mt-1 leading-tight">{label}</p>
    </div>
  );
}

function RowsTable({
  rowMatches,
  decisions,
}: {
  rowMatches: { row: ParsedRow; matchedId: string | null }[];
  decisions?: Record<string, "left" | "stay" | "skip">;
}) {
  return (
    <Card className="rounded-3xl shadow-soft overflow-hidden">
      <div className="max-h-[40vh] overflow-y-auto divide-y divide-border">
        {rowMatches.map((m, idx) => {
          let status: { label: string; cls: string };
          if (!m.row.valid) status = { label: `⏭️ Skipped${m.row.reason ? ` — ${m.row.reason}` : ""}`, cls: "text-muted-foreground" };
          else if (m.matchedId) status = { label: "✅ Matched", cls: "text-success-foreground" };
          else {
            const dec = decisions?.[m.row.learnerName.trim()];
            if (dec === "stay") status = { label: "➕ Will be added", cls: "text-primary" };
            else if (dec === "left") status = { label: "📁 Imported as left", cls: "text-primary" };
            else if (dec === "skip") status = { label: "⏭️ Skipped", cls: "text-muted-foreground" };
            else status = { label: "⚠️ Not matched", cls: "text-warning-foreground" };
          }
          return (
            <div key={idx} className="px-3 py-2 text-xs flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="truncate font-medium text-sm">{m.row.learnerName || "(no name)"}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {m.row.assessmentName || "—"} · {m.row.mark ?? "—"} / {m.row.total ?? "—"}
                  {m.row.termPeriod ? ` · ${m.row.termPeriod}` : ""}
                </p>
              </div>
              <span className={`text-[11px] whitespace-nowrap ${status.cls}`}>{status.label}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function PreviewMini({ rawRows, columnMap }: { rawRows: unknown[][]; columnMap: Record<number, string> }) {
  const rows = rawRows.slice(1, 4);
  return (
    <Card className="rounded-3xl shadow-soft p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Live preview of first 3 rows</p>
      <div className="space-y-2">
        {rows.map((r, i) => {
          const summary: string[] = [];
          Object.entries(columnMap).forEach(([k, v]) => {
            if (v === "ignore") return;
            const val = r[Number(k)];
            if (val != null && String(val).trim()) summary.push(`${v}: ${String(val)}`);
          });
          return (
            <p key={i} className="text-xs text-muted-foreground truncate">
              <span className="text-foreground font-medium">Row {i + 2}:</span> {summary.join(" · ") || "—"}
            </p>
          );
        })}
      </div>
    </Card>
  );
}
