import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { FileUp, Loader2, Network } from "lucide-react";
import { toast } from "sonner";
import { PrepCheckShell } from "@/features/prep-check/components/PrepCheckShell";
import { extractAnyDocument } from "@/features/prep-check/planning-intelligence/utils/extract";
import { ingestPlanningDocument, listPlanningDocuments } from "@/features/prep-check/planning-intelligence/services/ingest.functions";
import {
  answerClarification,
  listOpenClarifications,
} from "@/features/prep-check/planning-intelligence/services/clarify.functions";
import {
  getPlanningGraph,
  listAcademicYears,
  setCurrentAcademicYear,
} from "@/features/prep-check/planning-intelligence/services/graph.functions";
import { ensurePrepCheckWorkspace } from "@/features/prep-check/services/config.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type YearRow = { id: string; label: string; is_current: boolean };
type DocRow = {
  id: string;
  file_name: string;
  extract_status: string;
  warning: string | null;
  created_at: string;
  prep_check_document_meta:
    | {
        document_type: string;
        subject_label: string | null;
        stage_label: string | null;
        term_label: string | null;
        period_label: string | null;
        confidence: number;
        needs_clarification: boolean;
        summary: string | null;
      }
    | Array<Record<string, unknown>>
    | null;
};
type ClarRow = {
  id: string;
  document_id: string;
  question: string;
  prep_check_documents?: { file_name: string };
};
type NodeRow = {
  id: string;
  parent_id: string | null;
  canonical_type: string;
  display_label: string;
};

function metaOf(doc: DocRow) {
  const m = doc.prep_check_document_meta;
  if (!m) return null;
  return Array.isArray(m) ? m[0] : m;
}

export function PrepCheckLibraryPage() {
  const search = useSearch({ from: "/tools/prep-check/library" });
  const scopeSubjectId = search.subjectId as string | undefined;
  const scopeStageId = search.stageId as string | undefined;

  const ensureWs = useServerFn(ensurePrepCheckWorkspace);
  const listYears = useServerFn(listAcademicYears);
  const setCurrentYear = useServerFn(setCurrentAcademicYear);
  const ingest = useServerFn(ingestPlanningDocument);
  const listDocs = useServerFn(listPlanningDocuments);
  const listClar = useServerFn(listOpenClarifications);
  const answerClar = useServerFn(answerClarification);
  const loadGraph = useServerFn(getPlanningGraph);
  const fileRef = useRef<HTMLInputElement>(null);

  const [years, setYears] = useState<YearRow[]>([]);
  const [yearId, setYearId] = useState("");
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [clars, setClars] = useState<ClarRow[]>([]);
  const [nodes, setNodes] = useState<NodeRow[]>([]);
  const [terminology, setTerminology] = useState<Array<{ canonical_key: string; display_label: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (selectedYear?: string) => {
    await ensureWs();
    const y = (await listYears()) as YearRow[];
    setYears(y);
    const current = selectedYear || y.find((r) => r.is_current)?.id || y[0]?.id || "";
    setYearId(current);
    if (!current) {
      setDocs([]);
      setClars([]);
      setNodes([]);
      return;
    }
    const [d, c, g] = await Promise.all([
      listDocs({
        data: {
          academicYearId: current,
          subjectId: scopeSubjectId,
          stageId: scopeStageId,
        },
      }) as Promise<DocRow[]>,
      listClar({ data: { academicYearId: current } }) as Promise<ClarRow[]>,
      loadGraph({
        data: {
          academicYearId: current,
          subjectId: scopeSubjectId ?? null,
          stageId: scopeStageId ?? null,
        },
      }) as Promise<{
        nodes: NodeRow[];
        terminology: Array<{ canonical_key: string; display_label: string }>;
      }>,
    ]);
    setDocs(d);
    setClars(c);
    setNodes(g.nodes);
    setTerminology(g.terminology);
  }, [ensureWs, listYears, listDocs, listClar, loadGraph, scopeSubjectId, scopeStageId]);

  useEffect(() => {
    void (async () => {
      try {
        await refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not load library");
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

  async function onYearChange(id: string) {
    setYearId(id);
    setBusy(true);
    try {
      await setCurrentYear({ data: { academicYearId: id } });
      await refresh(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not switch year");
    } finally {
      setBusy(false);
    }
  }

  async function onFiles(fileList: FileList | null) {
    if (!fileList?.length || !yearId) return;
    setBusy(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required.");

      for (const file of Array.from(fileList)) {
        setStatus(`Extracting ${file.name}…`);
        const payloads = await extractAnyDocument(file);
        for (const p of payloads) {
          setStatus(`Classifying ${p.fileName}…`);
          let storagePath: string | null = null;
          try {
            const path = `${user.id}/years/${yearId}/${Date.now()}-${p.fileName.replace(/[^\w.\-]+/g, "_")}`;
            if (payloads.length === 1 && file.name === p.fileName) {
              const { error } = await supabase.storage.from("prep-check").upload(path, file, {
                upsert: false,
              });
              if (!error) storagePath = path;
            }
          } catch {
            /* non-fatal */
          }

          await ingest({
            data: {
              academicYearId: yearId,
              fileName: p.fileName,
              mimeType: p.mimeType ?? null,
              text: p.text,
              kind: p.kind,
              warning: p.warning,
              storagePath,
              visionBase64: p.visionBase64,
              visionMime: p.visionMime,
              forceSubjectId: scopeSubjectId,
              forceStageId: scopeStageId,
            },
          });
          if (p.warning) toast.message(p.warning);
        }
      }
      toast.success("Documents ingested into the planning model");
      await refresh(yearId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ingest failed");
    } finally {
      setBusy(false);
      setStatus("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onAnswer(id: string) {
    const answer = answers[id]?.trim();
    if (!answer) return;
    setBusy(true);
    try {
      await answerClar({ data: { clarificationId: id, answer } });
      toast.success("Thanks — classification updated");
      setAnswers((a) => {
        const next = { ...a };
        delete next[id];
        return next;
      });
      await refresh(yearId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not apply answer");
    } finally {
      setBusy(false);
    }
  }

  function termLabel(canonical: string) {
    return terminology.find((t) => t.canonical_key === canonical)?.display_label ?? canonical;
  }

  const roots = nodes.filter((n) => !n.parent_id || !nodes.some((x) => x.id === n.parent_id));
  function renderTree(node: NodeRow): ReactNode {
    const children = nodes.filter((n) => n.parent_id === node.id);
    return (
      <li key={node.id} className="mt-1">
        <span className="text-foreground">
          {node.display_label}
          <span className="text-xs text-muted-foreground ml-2">
            ({termLabel(node.canonical_type) !== node.canonical_type
              ? termLabel(node.canonical_type)
              : node.canonical_type})
          </span>
        </span>
        {children.length ? (
          <ul className="ml-4 border-l border-border/50 pl-3">{children.map((c) => renderTree(c))}</ul>
        ) : null}
      </li>
    );
  }

  if (loading) {
    return (
      <PrepCheckShell title="Prep Check">
        <p className="text-sm text-muted-foreground">Loading planning library…</p>
      </PrepCheckShell>
    );
  }

  return (
    <PrepCheckShell title="Prep Check">
      <div className="space-y-8">
        <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-soft">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
            <Link to="/tools/prep-check" className="hover:text-foreground">
              Prep Check
            </Link>
            <span className="mx-1.5">/</span>
            Library
          </p>
          <h1 className="font-display text-2xl font-semibold">Planning library</h1>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            Upload any planning documents — Penny classifies them and builds your school-year
            planning model.
            {scopeSubjectId || scopeStageId
              ? " Filtered to the selected subject / grade workspace."
              : ""}
          </p>
          <div className="mt-4 max-w-xs space-y-1.5">
            <Label>Academic year</Label>
            <Select value={yearId} onValueChange={(v) => void onYearChange(v)} disabled={busy}>
              <SelectTrigger>
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y.id} value={y.id}>
                    {y.label}
                    {y.is_current ? " (current)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-soft space-y-4">
          <h2 className="font-display text-lg font-semibold">Upload documents</h2>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            accept=".docx,.doc,.xlsx,.xls,.txt,.md,.csv,.json,.zip,.pdf,.pptx,.ppt,image/*"
            disabled={busy}
            onChange={(e) => void onFiles(e.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={busy || !yearId}
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
                Choose files or ZIP
              </>
            )}
          </Button>
          {status ? <p className="text-xs text-muted-foreground">{status}</p> : null}
        </div>

        {clars.length > 0 ? (
          <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-soft space-y-4">
            <h2 className="font-display text-lg font-semibold">Clarifications needed</h2>
            <ul className="space-y-4">
              {clars.map((c) => (
                <li key={c.id} className="rounded-2xl border border-border/60 p-4 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {c.prep_check_documents?.file_name ?? "Document"}
                  </p>
                  <p className="text-sm text-foreground">{c.question}</p>
                  <div className="flex flex-wrap gap-2 items-end">
                    <Input
                      className="max-w-md"
                      placeholder="Your answer"
                      value={answers[c.id] ?? ""}
                      onChange={(e) => setAnswers((a) => ({ ...a, [c.id]: e.target.value }))}
                      disabled={busy}
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy || !answers[c.id]?.trim()}
                      onClick={() => void onAnswer(c.id)}
                    >
                      Apply
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-soft space-y-4">
          <h2 className="font-display text-lg font-semibold">Documents</h2>
          {docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents in this year yet.</p>
          ) : (
            <ul className="space-y-3">
              {docs.map((d) => {
                const m = metaOf(d) as {
                  document_type?: string;
                  subject_label?: string | null;
                  stage_label?: string | null;
                  term_label?: string | null;
                  period_label?: string | null;
                  confidence?: number;
                  needs_clarification?: boolean;
                  summary?: string | null;
                } | null;
                return (
                  <li key={d.id} className="rounded-2xl border border-border/50 p-3 text-sm">
                    <p className="font-medium text-foreground">{d.file_name}</p>
                    {m ? (
                      <p className="mt-1 text-muted-foreground">
                        {m.document_type}
                        {m.subject_label ? ` · ${m.subject_label}` : ""}
                        {m.stage_label ? ` · ${m.stage_label}` : ""}
                        {m.term_label ? ` · ${m.term_label}` : ""}
                        {m.period_label ? ` · ${m.period_label}` : ""}
                        {" · "}
                        {Math.round(Number(m.confidence ?? 0))}%
                        {m.needs_clarification ? " · needs clarification" : ""}
                      </p>
                    ) : null}
                    {m?.summary ? (
                      <p className="mt-1 text-xs text-muted-foreground">{m.summary}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-soft space-y-4">
          <h2 className="font-display text-lg font-semibold inline-flex items-center gap-2">
            <Network className="h-5 w-5" />
            Planning hierarchy
          </h2>
          {nodes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Hierarchy appears after documents are classified and linked.
            </p>
          ) : (
            <ul className="text-sm">{roots.map((r) => renderTree(r))}</ul>
          )}
        </div>
      </div>
    </PrepCheckShell>
  );
}
