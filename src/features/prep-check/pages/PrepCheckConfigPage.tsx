import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PrepCheckShell } from "@/features/prep-check/components/PrepCheckShell";
import {
  getPrepCheckConfig,
  updatePrepCheckSchoolConfig,
  updatePrepCheckSubject,
  updatePrepCheckStage,
  updatePrepCheckCognitive,
} from "@/features/prep-check/services/config.functions";
import {
  classifyConfigDocument,
  type ConfigClassifyResult,
} from "@/features/prep-check/services/classify-config.functions";
import { extractConfigDocument } from "@/features/prep-check/utils/extract-document";
import {
  createAcademicYear,
  getTerminology,
  listAcademicYears,
  updateTerminology,
} from "@/features/prep-check/planning-intelligence/services/graph.functions";
import {
  getResponsibilities,
  setResponsibilities,
} from "@/features/prep-check/services/responsibilities.functions";
import { DEFAULT_TERMINOLOGY } from "@/features/prep-check/planning-intelligence/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

function scopeKey(subjectId: string, stageId: string) {
  return `${subjectId}:${stageId}`;
}

const SCHOOL_FIELDS: { key: string; label: string }[] = [
  { key: "curriculum_frameworks", label: "Curriculum frameworks" },
  { key: "annual_teaching_plans", label: "Annual teaching plans" },
  { key: "assessment_policy", label: "Assessment policies" },
  { key: "homework_policy", label: "Homework policies" },
  { key: "department_policy", label: "Department policies" },
  { key: "moderation_checklist", label: "Moderation checklists" },
  { key: "school_improvement_goals", label: "School improvement goals" },
  { key: "planning_expectations", label: "Planning expectations" },
];

function appendText(existing: string, addition: string): string {
  const a = addition.trim();
  if (!a) return existing ?? "";
  const e = (existing ?? "").trim();
  if (!e) return a;
  if (e.includes(a)) return e;
  return `${e}\n\n${a}`;
}

function matchByName(
  rows: Record<string, unknown>[],
  name: string,
): Record<string, unknown> | undefined {
  const n = name.trim().toLowerCase();
  return (
    rows.find((r) => String(r.name ?? "").trim().toLowerCase() === n) ||
    rows.find((r) => String(r.name ?? "").toLowerCase().includes(n) || n.includes(String(r.name ?? "").toLowerCase()))
  );
}

export function PrepCheckConfigPage() {
  const load = useServerFn(getPrepCheckConfig);
  const saveSchool = useServerFn(updatePrepCheckSchoolConfig);
  const saveSubject = useServerFn(updatePrepCheckSubject);
  const saveStage = useServerFn(updatePrepCheckStage);
  const saveCognitive = useServerFn(updatePrepCheckCognitive);
  const classifyDoc = useServerFn(classifyConfigDocument);
  const loadYears = useServerFn(listAcademicYears);
  const createYear = useServerFn(createAcademicYear);
  const loadTerms = useServerFn(getTerminology);
  const saveTerms = useServerFn(updateTerminology);
  const loadResponsibilities = useServerFn(getResponsibilities);
  const saveResponsibilities = useServerFn(setResponsibilities);
  const fileRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [school, setSchool] = useState<Record<string, string>>({});
  const [subjects, setSubjects] = useState<Record<string, unknown>[]>([]);
  const [stages, setStages] = useState<Record<string, unknown>[]>([]);
  const [cognitive, setCognitive] = useState({
    level1_pct: 50,
    level2_pct: 35,
    level3_pct: 15,
  });
  const [activeSubject, setActiveSubject] = useState<string | null>(null);
  const [activeStage, setActiveStage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [suggestion, setSuggestion] = useState<ConfigClassifyResult | null>(null);
  const [years, setYears] = useState<Array<{ id: string; label: string; is_current: boolean }>>([]);
  const [newYearLabel, setNewYearLabel] = useState("");
  const [terminology, setTerminology] = useState<
    Array<{ canonical_key: string; display_label: string }>
  >(DEFAULT_TERMINOLOGY.map((t) => ({ canonical_key: t.canonical_key, display_label: t.display_label })));
  const [scopes, setScopes] = useState<Set<string>>(new Set());

  useEffect(() => {
    void (async () => {
      try {
        const [cfg, y, terms, resp] = await Promise.all([
          load() as Promise<{
            school: Record<string, string> | null;
            subjects: Record<string, unknown>[];
            stages: Record<string, unknown>[];
            cognitive: Record<string, unknown> | null;
          }>,
          loadYears() as Promise<Array<{ id: string; label: string; is_current: boolean }>>,
          loadTerms() as Promise<Array<{ canonical_key: string; display_label: string }>>,
          loadResponsibilities() as Promise<Array<{ subject_id: string; stage_id: string }>>,
        ]);
        const s = (cfg.school ?? {}) as Record<string, string>;
        setSchool(s);
        setSubjects(cfg.subjects);
        setStages(cfg.stages);
        setActiveSubject((cfg.subjects[0]?.id as string) ?? null);
        setActiveStage((cfg.stages[0]?.id as string) ?? null);
        setYears(y);
        setScopes(new Set((resp ?? []).map((r) => scopeKey(r.subject_id, r.stage_id))));
        if (terms?.length) {
          setTerminology(
            terms.map((t) => ({
              canonical_key: t.canonical_key,
              display_label: t.display_label,
            })),
          );
        }
        if (cfg.cognitive) {
          setCognitive({
            level1_pct: Number(cfg.cognitive.level1_pct ?? 50),
            level2_pct: Number(cfg.cognitive.level2_pct ?? 35),
            level3_pct: Number(cfg.cognitive.level3_pct ?? 15),
          });
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not load config");
      } finally {
        setLoading(false);
      }
    })();
  }, [load, loadYears, loadTerms, loadResponsibilities]);

  const subject = subjects.find((s) => s.id === activeSubject);
  const stage = stages.find((s) => s.id === activeStage);

  async function onSaveSchool() {
    setSaving(true);
    try {
      const payload: Record<string, string> = {};
      for (const f of SCHOOL_FIELDS) payload[f.key] = school[f.key] ?? "";
      await saveSchool({ data: payload } as never);
      toast.success("School configuration saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onSaveSubject() {
    if (!subject) return;
    setSaving(true);
    try {
      await saveSubject({
        data: {
          id: subject.id as string,
          name: String(subject.name ?? ""),
          teaching_expectations: String(subject.teaching_expectations ?? ""),
          assessment_expectations: String(subject.assessment_expectations ?? ""),
          review_criteria: String(subject.review_criteria ?? ""),
          examples: String(subject.examples ?? ""),
        },
      });
      toast.success("Subject saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onSaveStage() {
    if (!stage) return;
    setSaving(true);
    try {
      await saveStage({
        data: {
          id: stage.id as string,
          name: String(stage.name ?? ""),
          learner_development: String(stage.learner_development ?? ""),
          pacing: String(stage.pacing ?? ""),
          cognitive_ability: String(stage.cognitive_ability ?? ""),
          assessment_difficulty: String(stage.assessment_difficulty ?? ""),
          classroom_experience: String(stage.classroom_experience ?? ""),
        },
      });
      toast.success("Stage saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onSaveCognitive() {
    setSaving(true);
    try {
      await saveCognitive({ data: cognitive });
      toast.success("Cognitive profile saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onSaveTerminology() {
    setSaving(true);
    try {
      await saveTerms({ data: { items: terminology } });
      toast.success("Planning terminology saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function toggleScope(subjectId: string, stageId: string) {
    setScopes((prev) => {
      const next = new Set(prev);
      const key = scopeKey(subjectId, stageId);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function onSaveResponsibilities() {
    setSaving(true);
    try {
      const items = [...scopes].map((key) => {
        const [subjectId, stageId] = key.split(":");
        return { subjectId, stageId };
      });
      await saveResponsibilities({ data: { items } });
      toast.success("Areas of responsibility saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onCreateYear() {
    const label = newYearLabel.trim();
    if (!label) return;
    setSaving(true);
    try {
      await createYear({ data: { label, setCurrent: true } });
      setNewYearLabel("");
      const y = (await loadYears()) as Array<{ id: string; label: string; is_current: boolean }>;
      setYears(y);
      toast.success("Academic year created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create year");
    } finally {
      setSaving(false);
    }
  }

  async function onConfigFile(file: File | null) {
    if (!file) return;
    setClassifying(true);
    setSuggestion(null);
    try {
      const extracted = await extractConfigDocument(file);
      if (extracted.warning) toast.message(extracted.warning);
      const result = (await classifyDoc({
        data: {
          fileName: file.name,
          documentText: extracted.text,
          subjectNames: subjects.map((s) => String(s.name ?? "")),
          stageNames: stages.map((s) => String(s.name ?? "")),
        },
      })) as ConfigClassifyResult;
      setSuggestion(result);
      toast.success(`Classified as: ${result.documentType}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not analyse document");
    } finally {
      setClassifying(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function applySuggestion() {
    if (!suggestion) return;

    setSchool((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(suggestion.schoolUpdates)) {
        next[k] = appendText(next[k] ?? "", v);
      }
      return next;
    });

    setSubjects((all) =>
      all.map((row) => {
        const hit = suggestion.subjectUpdates.find((u) => matchByName([row], u.subjectName));
        if (!hit) return row;
        const next = { ...row };
        for (const [k, v] of Object.entries(hit.fields)) {
          next[k] = appendText(String(row[k] ?? ""), v);
        }
        return next;
      }),
    );

    setStages((all) =>
      all.map((row) => {
        const hit = suggestion.stageUpdates.find((u) => matchByName([row], u.stageName));
        if (!hit) return row;
        const next = { ...row };
        for (const [k, v] of Object.entries(hit.fields)) {
          next[k] = appendText(String(row[k] ?? ""), v);
        }
        return next;
      }),
    );

    // Focus first matched subject/stage for visibility
    for (const u of suggestion.subjectUpdates) {
      const m = matchByName(subjects, u.subjectName);
      if (m?.id) {
        setActiveSubject(String(m.id));
        break;
      }
    }
    for (const u of suggestion.stageUpdates) {
      const m = matchByName(stages, u.stageName);
      if (m?.id) {
        setActiveStage(String(m.id));
        break;
      }
    }

    toast.success("Suggestions applied to the form — review and Save each section.");
    setSuggestion(null);
  }

  if (loading) {
    return (
      <PrepCheckShell title="Prep Check">
        <p className="text-sm text-muted-foreground">Loading configuration…</p>
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
            Configuration
          </p>
          <h1 className="font-display text-2xl font-semibold">School &amp; curriculum config</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Everything is editable. Nothing is hard-coded into the review engine.
          </p>
        </div>

        <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-soft space-y-4">
          <h2 className="font-display text-lg font-semibold">Academic year</h2>
          <p className="text-sm text-muted-foreground">
            Planning memory is scoped to an academic year.
            {years.length
              ? ` Current: ${years.find((y) => y.is_current)?.label ?? years[0]?.label}.`
              : ""}
          </p>
          <ul className="text-sm text-muted-foreground list-disc pl-5">
            {years.map((y) => (
              <li key={y.id}>
                {y.label}
                {y.is_current ? " (current)" : ""}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="space-y-1.5">
              <Label htmlFor="new-year">New year label</Label>
              <Input
                id="new-year"
                placeholder="e.g. 2026"
                value={newYearLabel}
                onChange={(e) => setNewYearLabel(e.target.value)}
              />
            </div>
            <Button disabled={saving || !newYearLabel.trim()} onClick={() => void onCreateYear()}>
              Create &amp; set current
            </Button>
          </div>
        </div>

        <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-soft space-y-4">
          <h2 className="font-display text-lg font-semibold">Planning terminology</h2>
          <p className="text-sm text-muted-foreground">
            Schools define their own words. Internally Penny uses stable keys; the UI and reports
            show your labels.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {terminology.map((t) => (
              <div key={t.canonical_key} className="space-y-1.5">
                <Label>
                  {t.canonical_key.replace(/_/g, " ")}
                </Label>
                <Input
                  value={t.display_label}
                  onChange={(e) =>
                    setTerminology((all) =>
                      all.map((row) =>
                        row.canonical_key === t.canonical_key
                          ? { ...row, display_label: e.target.value }
                          : row,
                      ),
                    )
                  }
                />
              </div>
            ))}
          </div>
          <Button disabled={saving} onClick={() => void onSaveTerminology()}>
            Save terminology
          </Button>
        </div>

        <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-soft space-y-4">
          <h2 className="font-display text-lg font-semibold">Areas of responsibility</h2>
          <p className="text-sm text-muted-foreground">
            Tick every subject and grade you are responsible for. Each combination gets its own
            planning hierarchy and progress dashboard.
          </p>
          {subjects.length && stages.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="p-2 text-left font-medium text-muted-foreground">Subject</th>
                    {stages.map((st) => (
                      <th
                        key={String(st.id)}
                        className="p-2 text-center font-medium text-muted-foreground"
                      >
                        {String(st.name)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {subjects.map((sub) => (
                    <tr key={String(sub.id)} className="border-t border-border/50">
                      <td className="p-2 text-foreground">{String(sub.name)}</td>
                      {stages.map((st) => {
                        const subjectId = String(sub.id);
                        const stageId = String(st.id);
                        return (
                          <td key={stageId} className="p-2 text-center">
                            <Checkbox
                              className="mx-auto"
                              aria-label={`${String(sub.name)} — ${String(st.name)}`}
                              checked={scopes.has(scopeKey(subjectId, stageId))}
                              onCheckedChange={() => toggleScope(subjectId, stageId)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Add subjects and stages first.</p>
          )}
          <Button disabled={saving} onClick={() => void onSaveResponsibilities()}>
            Save responsibilities
          </Button>
        </div>

        <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-soft space-y-4">
          <h2 className="font-display text-lg font-semibold">Upload a policy or curriculum document</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Upload any common format (Word, Excel, text, ZIP, PDF/PPT with limited extraction). Prep
            Check will suggest which config fields it belongs in — you review, then apply.
          </p>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".docx,.doc,.xlsx,.xls,.txt,.md,.csv,.json,.zip,.pdf,.pptx,.ppt,image/*"
            disabled={classifying}
            onChange={(e) => void onConfigFile(e.target.files?.[0] ?? null)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={classifying}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2"
          >
            {classifying ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analysing…
              </>
            ) : (
              <>
                <FileUp className="h-4 w-4" />
                Choose document
              </>
            )}
          </Button>

          {suggestion ? (
            <div className="rounded-2xl border border-border/60 bg-background/50 p-4 space-y-3 text-sm">
              <div>
                <p className="font-medium text-foreground">{suggestion.documentType}</p>
                <p className="mt-1 text-muted-foreground">{suggestion.summary}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Confidence {Math.round(suggestion.confidence)}%
                </p>
              </div>
              {Object.keys(suggestion.schoolUpdates).length > 0 ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    School fields
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                    {Object.keys(suggestion.schoolUpdates).map((k) => (
                      <li key={k}>{SCHOOL_FIELDS.find((f) => f.key === k)?.label ?? k}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {suggestion.subjectUpdates.length > 0 ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Subjects
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                    {suggestion.subjectUpdates.map((u) => (
                      <li key={u.subjectName}>
                        {u.subjectName}: {Object.keys(u.fields).join(", ")}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {suggestion.stageUpdates.length > 0 ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Stages
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                    {suggestion.stageUpdates.map((u) => (
                      <li key={u.stageName}>
                        {u.stageName}: {Object.keys(u.fields).join(", ")}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {suggestion.notes.length > 0 ? (
                <p className="text-xs text-muted-foreground">{suggestion.notes.join(" · ")}</p>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button type="button" onClick={applySuggestion}>
                  Apply to form (append)
                </Button>
                <Button type="button" variant="outline" onClick={() => setSuggestion(null)}>
                  Discard
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-soft space-y-4">
          <h2 className="font-display text-lg font-semibold">School configuration</h2>
          {SCHOOL_FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={f.key}>{f.label}</Label>
              <Textarea
                id={f.key}
                rows={3}
                value={school[f.key] ?? ""}
                onChange={(e) => setSchool((prev) => ({ ...prev, [f.key]: e.target.value }))}
              />
            </div>
          ))}
          <Button disabled={saving} onClick={() => void onSaveSchool()}>
            Save school config
          </Button>
        </div>

        <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-soft space-y-4">
          <h2 className="font-display text-lg font-semibold">Subjects</h2>
          <div className="flex flex-wrap gap-2">
            {subjects.map((s) => (
              <Button
                key={String(s.id)}
                size="sm"
                variant={activeSubject === s.id ? "default" : "outline"}
                onClick={() => setActiveSubject(s.id as string)}
              >
                {String(s.name)}
              </Button>
            ))}
          </div>
          {subject ? (
            <div className="space-y-3 pt-2">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  value={String(subject.name ?? "")}
                  onChange={(e) =>
                    setSubjects((all) =>
                      all.map((s) => (s.id === subject.id ? { ...s, name: e.target.value } : s)),
                    )
                  }
                />
              </div>
              {(
                [
                  ["teaching_expectations", "Teaching expectations"],
                  ["assessment_expectations", "Assessment expectations"],
                  ["review_criteria", "Review criteria"],
                  ["examples", "Examples"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <Label>{label}</Label>
                  <Textarea
                    rows={3}
                    value={String(subject[key] ?? "")}
                    onChange={(e) =>
                      setSubjects((all) =>
                        all.map((s) => (s.id === subject.id ? { ...s, [key]: e.target.value } : s)),
                      )
                    }
                  />
                </div>
              ))}
              <Button disabled={saving} onClick={() => void onSaveSubject()}>
                Save subject
              </Button>
            </div>
          ) : null}
        </div>

        <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-soft space-y-4">
          <h2 className="font-display text-lg font-semibold">Stages</h2>
          <div className="flex flex-wrap gap-2">
            {stages.map((s) => (
              <Button
                key={String(s.id)}
                size="sm"
                variant={activeStage === s.id ? "default" : "outline"}
                onClick={() => setActiveStage(s.id as string)}
              >
                {String(s.name)}
              </Button>
            ))}
          </div>
          {stage ? (
            <div className="space-y-3 pt-2">
              {(
                [
                  ["learner_development", "Expected learner development"],
                  ["pacing", "Expected pacing"],
                  ["cognitive_ability", "Expected cognitive ability"],
                  ["assessment_difficulty", "Expected assessment difficulty"],
                  ["classroom_experience", "Expected classroom experience"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <Label>{label}</Label>
                  <Textarea
                    rows={3}
                    value={String(stage[key] ?? "")}
                    onChange={(e) =>
                      setStages((all) =>
                        all.map((s) => (s.id === stage.id ? { ...s, [key]: e.target.value } : s)),
                      )
                    }
                  />
                </div>
              ))}
              <Button disabled={saving} onClick={() => void onSaveStage()}>
                Save stage
              </Button>
            </div>
          ) : null}
        </div>

        <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-soft space-y-4">
          <h2 className="font-display text-lg font-semibold">Cognitive level targets</h2>
          <p className="text-xs text-muted-foreground">Must total 100%.</p>
          <div className="grid grid-cols-3 gap-3">
            {(
              [
                ["level1_pct", "Level 1 %"],
                ["level2_pct", "Level 2 %"],
                ["level3_pct", "Level 3 %"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="space-y-1.5">
                <Label>{label}</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={cognitive[key]}
                  onChange={(e) =>
                    setCognitive((c) => ({ ...c, [key]: Number(e.target.value) || 0 }))
                  }
                />
              </div>
            ))}
          </div>
          <Button disabled={saving} onClick={() => void onSaveCognitive()}>
            Save cognitive profile
          </Button>
        </div>
      </div>
    </PrepCheckShell>
  );
}
