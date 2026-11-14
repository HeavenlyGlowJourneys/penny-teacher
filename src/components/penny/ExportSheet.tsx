import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, FileText, FileType, ClipboardCheck, Users, User, Library, Check, Loader2, ChevronRight, Download, Lock } from "lucide-react";
import { toast } from "sonner";
import {
  runExport, FORMAT_REGISTRY,
  type ExportSource, type ExportSourceKind, type ExportFormat,
} from "@/lib/export";

type Step = "what" | "format" | "working" | "done";

type Option = {
  kind: ExportSourceKind;
  label: string;
  description: string;
  Icon: typeof ClipboardCheck;
  enabled: boolean;
};

interface ExportSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Each context passes only the options it can fulfil.
  assessmentId?: string;
  classId?: string;
  learnerId?: string;
  teacherId?: string;
  // Hide the picker and jump straight to a specific source.
  defaultKind?: ExportSourceKind;
  // Plan gating — when true, Excel is shown as a locked upgrade prompt.
  xlsxLocked?: boolean;
}

export function ExportSheet({
  open, onOpenChange,
  assessmentId, classId, learnerId, teacherId,
  defaultKind,
  xlsxLocked = false,
}: ExportSheetProps) {
  const [step, setStep] = useState<Step>(defaultKind ? "format" : "what");
  const [kind, setKind] = useState<ExportSourceKind | null>(defaultKind ?? null);
  const [format, setFormat] = useState<ExportFormat>(xlsxLocked ? "csv" : "xlsx");
  const [error, setError] = useState<string | null>(null);

  const options: Option[] = [
    { kind: "assessment", label: "Current Assessment", description: "Just the marks for the assessment you're viewing.", Icon: ClipboardCheck, enabled: !!assessmentId },
    { kind: "class",      label: "Entire Class",       description: "Every learner and every assessment for this class.", Icon: Users, enabled: !!classId },
    { kind: "learner",    label: "Individual Learner", description: "One learner's full history and progress.", Icon: User, enabled: !!learnerId },
    { kind: "everything", label: "Everything",         description: "All your classes, learners and assessments.", Icon: Library, enabled: !!teacherId },
  ];

  function reset() {
    setStep(defaultKind ? "format" : "what");
    setKind(defaultKind ?? null);
    setFormat(xlsxLocked ? "csv" : "xlsx");
    setError(null);
  }
  function close() { onOpenChange(false); setTimeout(reset, 200); }

  function pickKind(k: ExportSourceKind) {
    setKind(k);
    const csv = FORMAT_REGISTRY.csv;
    if (xlsxLocked) {
      setFormat(csv?.supports?.(k) !== false ? "csv" : "csv");
    } else {
      const xlsx = FORMAT_REGISTRY.xlsx;
      setFormat(xlsx ? "xlsx" : (csv?.supports?.(k) ? "csv" : "xlsx"));
    }
    setStep("format");
  }

  async function start() {
    if (!kind) return;
    const source: ExportSource | null =
      kind === "assessment" && assessmentId ? { kind, assessmentId }
      : kind === "class" && classId         ? { kind, classId }
      : kind === "learner" && learnerId     ? { kind, learnerId }
      : kind === "everything" && teacherId  ? { kind, teacherId }
      : null;
    if (!source) { setError("That export isn't available here."); return; }

    setStep("working");
    setError(null);
    try {
      await runExport(source, format);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
      setStep("format");
      toast.error("Export failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="rounded-3xl max-w-md">
        {step === "what" && (
          <>
            <DialogHeader>
              <DialogTitle className="font-display text-2xl">What would you like to export?</DialogTitle>
              <DialogDescription>
                Penny helps you keep your records — your data is always yours to take with you.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 mt-1">
              {options.map((o) => (
                <button
                  key={o.kind}
                  type="button"
                  disabled={!o.enabled}
                  onClick={() => pickKind(o.kind)}
                  className="w-full text-left flex items-center gap-3 rounded-2xl p-3 bg-card-warm hover:bg-primary-soft transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="h-10 w-10 flex-none rounded-xl bg-primary-soft text-primary flex items-center justify-center">
                    <o.Icon className="h-5 w-5" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold leading-tight">{o.label}</span>
                    <span className="block text-xs text-muted-foreground mt-0.5">{o.description}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-none" />
                </button>
              ))}
            </div>
          </>
        )}

        {step === "format" && kind && (
          <>
            <DialogHeader>
              <DialogTitle className="font-display text-2xl">Choose your format</DialogTitle>
              <DialogDescription>
                Excel keeps everything organised in tabs. CSV is best for a single table.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 mt-1">
              {xlsxLocked ? (
                <Link
                  to="/pricing"
                  onClick={close}
                  className="flex items-center gap-3 rounded-2xl border border-dashed border-border bg-card-warm/60 p-3 hover:bg-primary-soft transition-colors"
                >
                  <span className="h-10 w-10 flex-none rounded-xl bg-muted text-muted-foreground flex items-center justify-center">
                    <Lock className="h-4 w-4" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold leading-tight">Excel (.xlsx)</span>
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      Excel export unlocks once your trial is active or you have paid access. Tap to continue.
                    </span>
                  </span>
                </Link>
              ) : (
                <FormatRow id="xlsx" label="Excel (.xlsx)" sublabel="Recommended" Icon={FileSpreadsheet}
                  selected={format === "xlsx"} onSelect={() => setFormat("xlsx")} available />
              )}
              <FormatRow id="csv" label="CSV (.csv)" sublabel={
                FORMAT_REGISTRY.csv.supports?.(kind) === false
                  ? "Best for one assessment or learner"
                  : "Plain text, opens anywhere"
              } Icon={FileText}
                selected={format === "csv"} onSelect={() => setFormat("csv")}
                available={FORMAT_REGISTRY.csv.supports?.(kind) !== false} />
              <FormatRow id="pdf" label="PDF" sublabel="Coming soon" Icon={FileType}
                selected={false} onSelect={() => {}} available={false} />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive mt-2">{error}</p>
            )}
            <div className="flex gap-2 mt-3">
              {!defaultKind && (
                <Button variant="ghost" onClick={() => setStep("what")} className="flex-1">Back</Button>
              )}
              <Button onClick={start} className="flex-1 shadow-warm">
                <Download className="h-4 w-4 mr-1.5" /> Export
              </Button>
            </div>
          </>
        )}

        {step === "working" && (
          <div className="py-10 text-center">
            <div className="mx-auto h-14 w-14 rounded-full bg-primary-soft text-primary flex items-center justify-center mb-4">
              <Loader2 className="h-7 w-7 animate-spin" />
            </div>
            <p className="font-display text-xl font-semibold">Preparing your export…</p>
            <p className="text-sm text-muted-foreground mt-1">Gathering learners, marks and class stats.</p>
          </div>
        )}

        {step === "done" && (
          <div className="py-8 text-center">
            <div className="mx-auto h-14 w-14 rounded-full bg-success/15 text-success-foreground flex items-center justify-center mb-4">
              <Check className="h-7 w-7" />
            </div>
            <p className="font-display text-xl font-semibold">Your export is ready.</p>
            <p className="text-sm text-muted-foreground mt-1">
              The file has been saved to your downloads.
            </p>
            <Button onClick={close} className="mt-5 w-full">Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FormatRow({
  id, label, sublabel, Icon, selected, onSelect, available,
}: {
  id: string; label: string; sublabel: string;
  Icon: typeof FileSpreadsheet;
  selected: boolean; onSelect: () => void; available: boolean;
}) {
  return (
    <button
      key={id}
      type="button"
      onClick={onSelect}
      disabled={!available}
      className={
        "w-full text-left flex items-center gap-3 rounded-2xl p-3 border-2 transition-colors " +
        (selected ? "border-primary bg-primary-soft" : "border-border bg-card") +
        (available ? " hover:bg-card-warm cursor-pointer" : " opacity-50 cursor-not-allowed")
      }
    >
      <span className="h-10 w-10 flex-none rounded-xl bg-card-warm text-foreground flex items-center justify-center">
        <Icon className="h-5 w-5" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-semibold leading-tight">{label}</span>
        <span className="block text-xs text-muted-foreground mt-0.5">{sublabel}</span>
      </span>
      {selected && <Check className="h-5 w-5 text-primary flex-none" />}
    </button>
  );
}
