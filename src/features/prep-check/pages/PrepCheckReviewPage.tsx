import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { FileArchive, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PrepCheckShell } from "@/features/prep-check/components/PrepCheckShell";
import { PrepCheckReportView } from "@/features/prep-check/reports/PrepCheckReportView";
import { getPrepCheckConfig, ensurePrepCheckWorkspace } from "@/features/prep-check/services/config.functions";
import { runPrepCheckReview } from "@/features/prep-check/services/review.functions";
import { extractAnyDocument } from "@/features/prep-check/planning-intelligence/utils/extract";
import { ingestPlanningDocument } from "@/features/prep-check/planning-intelligence/services/ingest.functions";
import { listAcademicYears } from "@/features/prep-check/planning-intelligence/services/graph.functions";
import type { PrepCheckReport, PrepCheckWorkflow } from "@/features/prep-check/types";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function PrepCheckReviewPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/tools/prep-check/review" });
  const ensureWs = useServerFn(ensurePrepCheckWorkspace);
  const loadConfig = useServerFn(getPrepCheckConfig);
  const listYears = useServerFn(listAcademicYears);
  const ingest = useServerFn(ingestPlanningDocument);
  const runReview = useServerFn(runPrepCheckReview);
  const inputRef = useRef<HTMLInputElement>(null);

  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([]);
  const [stages, setStages] = useState<{ id: string; name: string }[]>([]);
  const [years, setYears] = useState<{ id: string; label: string; is_current: boolean }[]>([]);
  const [yearId, setYearId] = useState("");
  const [workflow, setWorkflow] = useState<PrepCheckWorkflow>("teacher_prep");
  const [subjectId, setSubjectId] = useState<string>("");
  const [stageId, setStageId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [report, setReport] = useState<PrepCheckReport | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [manifestCount, setManifestCount] = useState(0);

  useEffect(() => {
    void (async () => {
      try {
        await ensureWs();
        const [cfg, y] = await Promise.all([
          loadConfig() as unknown as Promise<{
            subjects: { id: string; name: string }[];
            stages: { id: string; name: string }[];
          }>,
          listYears() as Promise<{ id: string; label: string; is_current: boolean }[]>,
        ]);
        setSubjects(
          cfg.subjects.map((s) => ({ id: String(s.id), name: String(s.name) })),
        );
        setStages(cfg.stages.map((s) => ({ id: String(s.id), name: String(s.name) })));
        setYears(y);
        setYearId(y.find((r) => r.is_current)?.id || y[0]?.id || "");
        setSubjectId(search.subjectId ?? (cfg.subjects[0] ? String(cfg.subjects[0].id) : ""));
        setStageId(search.stageId ?? (cfg.stages[0] ? String(cfg.stages[0].id) : ""));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not load config");
      }
    })();
  }, [ensureWs, loadConfig, listYears, search.subjectId, search.stageId]);

  async function runGraphReview(opts?: {
    extraCorpus?: string;
    manifest?: Array<{ path: string; size: number; kind: string; extractedChars: number }>;
    warnings?: string[];
    zipStoragePath?: string | null;
    title?: string;
  }) {
    if (!yearId) throw new Error("Select an academic year first.");
    setStatus("Analysing planning model…");
    const result = (await runReview({
      data: {
        workflow,
        subjectId: subjectId || null,
        stageId: stageId || null,
        academicYearId: yearId,
        title: opts?.title ?? "Planning model review",
        extraCorpus: opts?.extraCorpus,
        manifest: opts?.manifest,
        warnings: opts?.warnings,
        zipStoragePath: opts?.zipStoragePath ?? null,
      },
    })) as { reviewId: string; report: PrepCheckReport };

    setReport(result.report);
    setReviewId(result.reviewId);
    setStatus("");
    toast.success("Review ready");
    void navigate({
      to: "/tools/prep-check/report/$reviewId",
      params: { reviewId: result.reviewId },
    });
  }

  async function onAnalyseExisting() {
    setBusy(true);
    setReport(null);
    setReviewId(null);
    try {
      await runGraphReview();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Review failed");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function onFilesSelected(file: File | null) {
    if (!file || !yearId) return;
    if (file.size > 50 * 1024 * 1024) {
      toast.error("Upload must be under 50 MB.");
      return;
    }

    setBusy(true);
    setReport(null);
    setReviewId(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required.");

      setStatus("Extracting and organising into planning model…");
      const payloads = await extractAnyDocument(file);
      setManifestCount(payloads.length);
      const warnings: string[] = [];
      const manifest = payloads.map((p) => ({
        path: p.fileName,
        size: p.text.length,
        kind: p.kind,
        extractedChars: p.text.length,
      }));

      let zipStoragePath: string | null = null;
      if (file.name.toLowerCase().endsWith(".zip")) {
        const path = `${user.id}/years/${yearId}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
        const { error: upErr } = await supabase.storage.from("prep-check").upload(path, file, {
          contentType: "application/zip",
          upsert: false,
        });
        if (!upErr) zipStoragePath = path;
      }

      for (const p of payloads) {
        setStatus(`Classifying ${p.fileName}…`);
        if (p.warning) warnings.push(p.warning);
        await ingest({
          data: {
            academicYearId: yearId,
            fileName: p.fileName,
            mimeType: p.mimeType ?? null,
            text: p.text,
            kind: p.kind,
            warning: p.warning,
            visionBase64: p.visionBase64,
            visionMime: p.visionMime,
            forceSubjectId: subjectId || undefined,
            forceStageId: stageId || undefined,
          },
        });
      }

      await runGraphReview({
        extraCorpus: payloads.map((p) => `## ${p.fileName}\n${p.text}`).join("\n\n").slice(0, 60_000),
        manifest,
        warnings,
        zipStoragePath,
        title: file.name.replace(/\.zip$/i, "") || "Planning model review",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Review failed");
      setStatus("");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <PrepCheckShell title="Prep Check">
      <div className="space-y-6">
        <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-soft space-y-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
              <Link to="/tools/prep-check" className="hover:text-foreground transition-colors">
                Prep Check
              </Link>
              <span className="mx-1.5">/</span>
              Review
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">
              Planning model review
            </h1>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              Reviews run against your year-long planning graph. Upload more documents anytime —
              Penny organises them. Or analyse what is already in the{" "}
              <Link
                to="/tools/prep-check/library"
                search={{ subjectId: subjectId || undefined, stageId: stageId || undefined }}
                className="underline underline-offset-2"
              >
                Library
              </Link>
              .
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Academic year</Label>
              <Select value={yearId} onValueChange={setYearId} disabled={busy}>
                <SelectTrigger>
                  <SelectValue placeholder="Year" />
                </SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y.id} value={y.id}>
                      {y.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Workflow</Label>
              <Select
                value={workflow}
                onValueChange={(v) => setWorkflow(v as PrepCheckWorkflow)}
                disabled={busy}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="teacher_prep">Teacher Prep Check</SelectItem>
                  <SelectItem value="subject_head_review">Subject Head Review</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Select value={subjectId} onValueChange={setSubjectId} disabled={busy}>
                <SelectTrigger>
                  <SelectValue placeholder="Subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Stage</Label>
              <Select value={stageId} onValueChange={setStageId} disabled={busy}>
                <SelectTrigger>
                  <SelectValue placeholder="Stage" />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button disabled={busy || !yearId} onClick={() => void onAnalyseExisting()}>
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Working…
                </>
              ) : (
                "Analyse existing model"
              )}
            </Button>
          </div>

          <div className="rounded-2xl border border-dashed border-border bg-background/40 px-6 py-12 text-center">
            <FileArchive className="mx-auto h-10 w-10 text-muted-foreground/70" />
            <p className="mt-4 text-sm font-medium text-foreground">
              Or upload more documents / a ZIP
            </p>
            <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
              Files are ingested into the planning model first, then reviewed as a connected graph.
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".zip,.docx,.doc,.xlsx,.xls,.txt,.md,.csv,.pdf,.pptx,.ppt,image/*,application/zip"
              className="hidden"
              disabled={busy}
              onChange={(e) => void onFilesSelected(e.target.files?.[0] ?? null)}
            />
            <Button
              className="mt-6"
              variant="outline"
              disabled={busy || !yearId}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Working…
                </>
              ) : (
                <>
                  <FileUp className="h-4 w-4" />
                  Choose files
                </>
              )}
            </Button>
            {status ? <p className="mt-3 text-xs text-muted-foreground">{status}</p> : null}
            {manifestCount > 0 && !busy ? (
              <p className="mt-2 text-xs text-muted-foreground">{manifestCount} files processed</p>
            ) : null}
          </div>
        </div>

        {report && reviewId ? (
          <PrepCheckReportView
            report={report}
            title="Latest review"
            workflowLabel={
              workflow === "teacher_prep" ? "Teacher Prep Check" : "Subject Head Review"
            }
          />
        ) : null}
      </div>
    </PrepCheckShell>
  );
}
