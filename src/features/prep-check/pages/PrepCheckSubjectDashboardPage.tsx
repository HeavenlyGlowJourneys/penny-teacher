import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, FileUp, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { PrepCheckShell } from "@/features/prep-check/components/PrepCheckShell";
import {
  getSubjectDashboard,
  type GradeProgress,
} from "@/features/prep-check/services/responsibilities.functions";
import { extractAnyDocument } from "@/features/prep-check/planning-intelligence/utils/extract";
import { ingestPlanningDocument } from "@/features/prep-check/planning-intelligence/services/ingest.functions";
import { ensurePrepCheckWorkspace } from "@/features/prep-check/services/config.functions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function PrepCheckSubjectDashboardPage() {
  const { subjectId } = useParams({ from: "/tools/prep-check/subject/$subjectId" });
  const ensureWs = useServerFn(ensurePrepCheckWorkspace);
  const loadDash = useServerFn(getSubjectDashboard);
  const ingest = useServerFn(ingestPlanningDocument);
  const fileRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [yearId, setYearId] = useState("");
  const [grades, setGrades] = useState<GradeProgress[]>([]);
  const [siblings, setSiblings] = useState<Array<{ id: string; name: string }>>([]);
  const [uploadStageId, setUploadStageId] = useState("");

  const refresh = useCallback(async () => {
    await ensureWs();
    const data = (await loadDash({ data: { subjectId } })) as {
      academicYearId: string;
      subject: { id: string; name: string };
      grades: GradeProgress[];
      siblingSubjects: Array<{ id: string; name: string }>;
    };
    setYearId(data.academicYearId);
    setSubjectName(data.subject.name);
    setGrades(data.grades);
    setSiblings(data.siblingSubjects);
    if (!uploadStageId && data.grades[0]) setUploadStageId(data.grades[0].stageId);
  }, [ensureWs, loadDash, subjectId, uploadStageId]);

  useEffect(() => {
    void (async () => {
      try {
        await refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not load subject");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per subjectId
  }, [subjectId]);

  async function onMultiUpload(files: FileList | null) {
    if (!files?.length || !yearId || !uploadStageId) {
      toast.error("Choose a grade for this upload.");
      return;
    }
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        setStatus(`Extracting ${file.name}…`);
        const payloads = await extractAnyDocument(file);
        for (const p of payloads) {
          setStatus(`Organising ${p.fileName} into ${grades.find((g) => g.stageId === uploadStageId)?.stageName ?? "grade"}…`);
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
              forceSubjectId: subjectId,
              forceStageId: uploadStageId,
            },
          });
        }
      }
      toast.success("Uploaded into grade planning workspace");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      setStatus("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (loading) {
    return (
      <PrepCheckShell title="Prep Check">
        <p className="text-sm text-muted-foreground">Loading subject…</p>
      </PrepCheckShell>
    );
  }

  return (
    <PrepCheckShell title="Prep Check">
      <div className="space-y-8">
        <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-soft space-y-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            <Link to="/tools/prep-check" className="hover:text-foreground">
              Prep Check
            </Link>
            <span className="mx-1.5">/</span>
            Subject
          </p>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">
                {subjectName}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed max-w-xl">
                Manage every grade you are responsible for in this subject. Each grade keeps its
                own planning hierarchy and reviews.
              </p>
            </div>
            {siblings.length > 1 ? (
              <div className="space-y-1.5 min-w-[180px]">
                <Label>Switch subject</Label>
                <Select
                  value={subjectId}
                  onValueChange={(id) => {
                    window.location.href = `/tools/prep-check/subject/${id}`;
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {siblings.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            {grades.map((g) => (
              <span
                key={g.stageId}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary"
              >
                {g.documentCount > 0 || g.lastReview?.status === "ready" ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : null}
                {g.stageName}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-soft space-y-4">
          <h2 className="font-display text-lg font-semibold">Multi-grade upload</h2>
          <p className="text-sm text-muted-foreground">
            Upload planning for one grade at a time in this session — switch the grade between
            uploads. Files are classified into that grade&apos;s hierarchy automatically.
          </p>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1.5 min-w-[160px]">
              <Label>Grade for this upload</Label>
              <Select value={uploadStageId} onValueChange={setUploadStageId} disabled={busy}>
                <SelectTrigger>
                  <SelectValue placeholder="Grade" />
                </SelectTrigger>
                <SelectContent>
                  {grades.map((g) => (
                    <SelectItem key={g.stageId} value={g.stageId}>
                      {g.stageName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              accept=".zip,.docx,.doc,.xlsx,.xls,.txt,.md,.csv,.pdf,.pptx,.ppt,image/*,application/zip"
              disabled={busy}
              onChange={(e) => void onMultiUpload(e.target.files)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={busy || !uploadStageId}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Working…
                </>
              ) : (
                <>
                  <FileUp className="h-4 w-4" />
                  Upload files / ZIP
                </>
              )}
            </Button>
          </div>
          {status ? <p className="text-xs text-muted-foreground">{status}</p> : null}
        </div>

        <div className="space-y-4">
          <h2 className="font-display text-lg font-semibold px-1">Grades</h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {grades.map((g) => (
              <li
                key={g.stageId}
                className="rounded-3xl bg-card p-5 sm:p-6 shadow-soft space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display text-lg font-semibold">{g.stageName}</h3>
                  {g.lastReview?.status === "ready" ? (
                    <span className="text-xs text-primary font-medium">
                      {g.lastReview.overall_rating ?? "Reviewed"}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">No review yet</span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {g.documentCount} document{g.documentCount === 1 ? "" : "s"} · {g.nodeCount}{" "}
                  planning node{g.nodeCount === 1 ? "" : "s"}
                  {g.clarificationCount
                    ? ` · ${g.clarificationCount} clarification${g.clarificationCount === 1 ? "" : "s"}`
                    : ""}
                </p>
                {g.planningTypes.length ? (
                  <p className="text-xs text-muted-foreground">
                    Present: {g.planningTypes.slice(0, 8).join(", ")}
                    {g.planningTypes.length > 8 ? "…" : ""}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Planning hierarchy empty</p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button asChild size="sm" variant="outline">
                    <Link
                      to="/tools/prep-check/library"
                      search={{ subjectId, stageId: g.stageId }}
                    >
                      Open library
                    </Link>
                  </Button>
                  <Button asChild size="sm">
                    <Link
                      to="/tools/prep-check/review"
                      search={{ subjectId, stageId: g.stageId }}
                      className="inline-flex items-center gap-1.5"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Review grade
                    </Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {grades.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No grades linked yet. Set your areas of responsibility in{" "}
              <Link to="/tools/prep-check/config" className="underline underline-offset-2">
                Configuration
              </Link>
              .
            </p>
          ) : null}
        </div>
      </div>
    </PrepCheckShell>
  );
}
