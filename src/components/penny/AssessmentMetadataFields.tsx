import { Link } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  ASSESSMENT_CATEGORIES, GRADE_OPTIONS,
  useAcademicYears, useTermPeriods,
} from "@/hooks/use-academic-year";

export interface AssessmentMetadata {
  academic_year_id: string | null;
  term_period_id: string | null;
  subject: string;
  grade: string;
  category: string;
  weighting: string;
  counts_towards_report: boolean;
}

interface Props {
  value: AssessmentMetadata;
  onChange: (next: AssessmentMetadata) => void;
}

const NONE = "__none__";

export function AssessmentMetadataFields({ value, onChange }: Props) {
  const { data: years = [] } = useAcademicYears();
  const { data: periods = [] } = useTermPeriods(value.academic_year_id);

  function set<K extends keyof AssessmentMetadata>(key: K, v: AssessmentMetadata[K]) {
    onChange({ ...value, [key]: v });
  }

  if (years.length === 0) {
    return (
      <div className="rounded-2xl bg-primary-soft border border-primary/20 p-4 text-sm">
        <p className="font-medium">Set up your academic year</p>
        <p className="text-muted-foreground text-xs mt-1">
          Add an academic year and term periods so every assessment can be organised by term.
        </p>
        <Link
          to="/settings/academic-year"
          className="inline-block mt-2 text-primary font-medium text-sm"
        >
          Set up now →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Academic year</Label>
          <Select
            value={value.academic_year_id ?? NONE}
            onValueChange={(v) => onChange({ ...value, academic_year_id: v === NONE ? null : v, term_period_id: null })}
          >
            <SelectTrigger className="h-11 rounded-xl mt-1"><SelectValue placeholder="Pick a year" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {years.map((y) => (
                <SelectItem key={y.id} value={y.id}>{y.name}{y.is_current ? " (current)" : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Term period</Label>
          <Select
            value={value.term_period_id ?? NONE}
            onValueChange={(v) => set("term_period_id", v === NONE ? null : v)}
            disabled={!value.academic_year_id || periods.length === 0}
          >
            <SelectTrigger className="h-11 rounded-xl mt-1">
              <SelectValue placeholder={periods.length === 0 ? "No periods" : "Pick a period"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {periods.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Subject</Label>
          <Input
            value={value.subject}
            onChange={(e) => set("subject", e.target.value)}
            placeholder="e.g. Mathematics"
            className="h-11 rounded-xl mt-1"
          />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Grade</Label>
          <Select value={value.grade || NONE} onValueChange={(v) => set("grade", v === NONE ? "" : v)}>
            <SelectTrigger className="h-11 rounded-xl mt-1"><SelectValue placeholder="Pick a grade" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {GRADE_OPTIONS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">Category</Label>
        <Select value={value.category || NONE} onValueChange={(v) => set("category", v === NONE ? "" : v)}>
          <SelectTrigger className="h-11 rounded-xl mt-1"><SelectValue placeholder="Pick a category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>None</SelectItem>
            {ASSESSMENT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">Weighting (optional)</Label>
        <Input
          type="number"
          inputMode="decimal"
          value={value.weighting}
          onChange={(e) => set("weighting", e.target.value)}
          placeholder="e.g. 30"
          className="h-11 rounded-xl mt-1"
        />
        <p className="text-[11px] text-muted-foreground mt-1">
          Leave blank to calculate a straight percentage.
        </p>
      </div>

      <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-3">
        <div>
          <p className="text-sm font-medium">Counts towards term mark</p>
          <p className="text-xs text-muted-foreground">Include this assessment in the term mark calculation.</p>
        </div>
        <Switch
          checked={value.counts_towards_report}
          onCheckedChange={(c) => set("counts_towards_report", c)}
        />
      </div>
    </div>
  );
}

export const EMPTY_ASSESSMENT_METADATA: AssessmentMetadata = {
  academic_year_id: null,
  term_period_id: null,
  subject: "",
  grade: "",
  category: "",
  weighting: "",
  counts_towards_report: false,
};
