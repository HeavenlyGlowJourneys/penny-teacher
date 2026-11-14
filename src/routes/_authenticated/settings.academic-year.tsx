import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, X, Check, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/penny/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  QUICK_START_STRUCTURES,
  useAcademicYears,
  useTermPeriods,
} from "@/hooks/use-academic-year";

export const Route = createFileRoute("/_authenticated/settings/academic-year")({
  head: () => ({ meta: [{ title: "Academic year – Penny" }] }),
  component: AcademicYearSetup,
});

type PeriodDraft = { id?: string; name: string; start_date: string; end_date: string };

function AcademicYearSetup() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: years = [], isLoading } = useAcademicYears();

  const [step, setStep] = useState<"year" | "structure" | "done">("year");
  const [selectedYearId, setSelectedYearId] = useState<string | null>(null);
  const [yearName, setYearName] = useState(String(new Date().getFullYear()));
  const [periods, setPeriods] = useState<PeriodDraft[]>([]);
  const [busy, setBusy] = useState(false);

  const { data: existingPeriods = [] } = useTermPeriods(selectedYearId);

  async function createYear() {
    const name = yearName.trim();
    if (!name) { toast.error("Give your year a name"); return; }
    setBusy(true);
    try {
      // Only set as current if no current year exists.
      const hasCurrent = years.some((y) => y.is_current);
      const { data, error } = await supabase
        .from("academic_years")
        .insert({ teacher_id: user.id, name, is_current: !hasCurrent })
        .select("id").single();
      if (error) throw error;
      setSelectedYearId(data.id);
      setPeriods([]);
      qc.invalidateQueries({ queryKey: ["academic-years"] });
      setStep("structure");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create year");
    } finally {
      setBusy(false);
    }
  }

  function pickQuickStart(key: string) {
    const names = QUICK_START_STRUCTURES[key] ?? [""];
    setPeriods(names.map((n) => ({ name: n, start_date: "", end_date: "" })));
  }

  function addPeriod() {
    setPeriods((p) => [...p, { name: "", start_date: "", end_date: "" }]);
  }
  function updatePeriod(i: number, patch: Partial<PeriodDraft>) {
    setPeriods((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }
  function removePeriod(i: number) {
    setPeriods((p) => p.filter((_, j) => j !== i));
  }
  function move(i: number, dir: -1 | 1) {
    setPeriods((p) => {
      const next = [...p];
      const j = i + dir;
      if (j < 0 || j >= next.length) return p;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function savePeriods() {
    if (!selectedYearId) return;
    const cleaned = periods.filter((p) => p.name.trim());
    if (cleaned.length === 0) {
      toast.error("Add at least one period or pick a structure above");
      return;
    }
    setBusy(true);
    try {
      // Replace strategy: delete existing and insert fresh, ordered.
      if (existingPeriods.length > 0) {
        const { error: delErr } = await supabase
          .from("term_periods")
          .delete()
          .eq("academic_year_id", selectedYearId);
        if (delErr) throw delErr;
      }
      const rows = cleaned.map((p, i) => ({
        teacher_id: user.id,
        academic_year_id: selectedYearId,
        name: p.name.trim(),
        sort_order: i,
        start_date: p.start_date || null,
        end_date: p.end_date || null,
      }));
      const { error } = await supabase.from("term_periods").insert(rows);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["term-periods"] });
      setStep("done");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function setCurrent(yearId: string) {
    try {
      // Clear current on all then set the chosen one — partial unique index allows this.
      await supabase.from("academic_years").update({ is_current: false }).eq("teacher_id", user.id);
      const { error } = await supabase.from("academic_years").update({ is_current: true }).eq("id", yearId);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["academic-years"] });
      toast.success("Current year updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update");
    }
  }

  function editExistingYear(id: string, name: string) {
    setSelectedYearId(id);
    setYearName(name);
    // Seed period drafts from existing periods on next render via effect — keep simple.
    // Fetch fresh and seed:
    void supabase
      .from("term_periods")
      .select("id, name, sort_order, start_date, end_date")
      .eq("academic_year_id", id)
      .order("sort_order")
      .then(({ data }) => {
        setPeriods(
          (data ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            start_date: p.start_date ?? "",
            end_date: p.end_date ?? "",
          })),
        );
        setStep("structure");
      });
  }

  return (
    <AppShell back="/settings" title="Academic year">
      {step === "year" && (
        <div className="space-y-6 pb-12">
          <div>
            <h2 className="font-display text-xl font-semibold">What year are you setting up?</h2>
            <p className="text-sm text-muted-foreground mt-1">
              You can add as many years as you like. One is your current year.
            </p>
          </div>

          <div className="rounded-2xl bg-card p-4 shadow-soft space-y-3">
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Year name</Label>
              <Input
                value={yearName}
                onChange={(e) => setYearName(e.target.value)}
                placeholder="e.g. 2026"
                className="h-12 rounded-xl mt-1"
              />
            </div>
            <Button onClick={createYear} disabled={busy} className="w-full h-12 rounded-xl">
              {busy ? "Creating…" : "Next"}
            </Button>
          </div>

          {isLoading ? null : years.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-2 px-1">
                Your years
              </p>
              <ul className="rounded-2xl bg-card shadow-soft divide-y divide-border overflow-hidden">
                {years.map((y) => (
                  <li key={y.id} className="flex items-center gap-2 px-4 py-3">
                    <span className="flex-1 font-medium">{y.name}</span>
                    {y.is_current && (
                      <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-primary-soft text-primary font-semibold">
                        Current
                      </span>
                    )}
                    {!y.is_current && (
                      <button
                        onClick={() => void setCurrent(y.id)}
                        className="text-xs text-muted-foreground hover:text-primary"
                        title="Set as current"
                      >
                        <Star className="h-4 w-4" />
                      </button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => editExistingYear(y.id, y.name)}>
                      Edit periods
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {step === "structure" && (
        <div className="space-y-5 pb-32">
          <div>
            <h2 className="font-display text-xl font-semibold">How does your school structure the year?</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Every school is different. Build the structure that works for yours.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {Object.keys(QUICK_START_STRUCTURES).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => pickQuickStart(k)}
                className="rounded-2xl border-2 border-border bg-card p-3 text-left text-sm hover:border-primary hover:bg-primary-soft transition-colors"
              >
                {k}
              </button>
            ))}
          </div>

          {periods.length === 0 ? (
            <div className="rounded-2xl bg-card p-6 text-center shadow-soft text-sm text-muted-foreground">
              No periods yet — add your first one or choose a structure above.
            </div>
          ) : (
            <div className="space-y-2">
              {periods.map((p, i) => (
                <div key={i} className="rounded-2xl bg-card p-3 shadow-soft space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col">
                      <button
                        type="button"
                        onClick={() => move(i, -1)}
                        className="text-xs text-muted-foreground hover:text-foreground px-1"
                        aria-label="Move up"
                      >▲</button>
                      <button
                        type="button"
                        onClick={() => move(i, 1)}
                        className="text-xs text-muted-foreground hover:text-foreground px-1"
                        aria-label="Move down"
                      >▼</button>
                    </div>
                    <Input
                      value={p.name}
                      onChange={(e) => updatePeriod(i, { name: e.target.value })}
                      placeholder={`Period ${i + 1}`}
                      className="h-11 rounded-xl flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => removePeriod(i)}
                      className="p-2 text-muted-foreground hover:text-destructive"
                      aria-label="Remove period"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="date"
                      value={p.start_date}
                      onChange={(e) => updatePeriod(i, { start_date: e.target.value })}
                      className="h-10 rounded-lg text-sm"
                    />
                    <Input
                      type="date"
                      value={p.end_date}
                      onChange={(e) => updatePeriod(i, { end_date: e.target.value })}
                      className="h-10 rounded-lg text-sm"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <Button type="button" variant="outline" onClick={addPeriod} className="w-full h-12 rounded-xl">
            <Plus className="h-4 w-4 mr-1" /> Add another period
          </Button>

          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md">
            <Button onClick={savePeriods} disabled={busy} className="w-full h-14 rounded-2xl text-base shadow-warm">
              {busy ? "Saving…" : "Save my structure"}
            </Button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-5 text-center pb-12">
          <div className="rounded-3xl bg-primary-soft p-8">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground mb-3">
              <Check className="h-7 w-7" />
            </div>
            <h2 className="font-display text-xl font-semibold">Your year is set up.</h2>
            <p className="text-sm text-muted-foreground mt-2">
              Now every assessment can be organised by term, exam, or whatever works for you.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Button onClick={() => navigate({ to: "/dashboard" })} className="h-12 rounded-xl">
              Back to your classes
            </Button>
            <Button variant="outline" onClick={() => { setStep("year"); setSelectedYearId(null); }} className="h-12 rounded-xl">
              Set up another year
            </Button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
