import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Mic, Plus, GraduationCap, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { OralAssessmentShell } from "@/features/oral-assessment/components/OralAssessmentShell";
import {
  deleteOralAssessment,
  listOralAssessments,
} from "@/features/oral-assessment/services/assessment.functions";
import { ensureOralAssessmentWorkspace } from "@/features/oral-assessment/services/workspace.functions";
import { Button } from "@/components/ui/button";
import type { OralAssessmentListItem, OralAssessmentStatus } from "@/features/oral-assessment/types";

function statusLabel(status: OralAssessmentStatus | string) {
  switch (status) {
    case "ready":
      return "Ready to review";
    case "published":
      return "Published";
    case "analysing":
      return "Generating…";
    case "failed":
      return "Failed";
    case "draft":
      return "Draft";
    case "archived":
      return "Archived";
    default:
      return status;
  }
}

export function LecturerDashboardPage() {
  const ensureWs = useServerFn(ensureOralAssessmentWorkspace);
  const list = useServerFn(listOralAssessments);
  const remove = useServerFn(deleteOralAssessment);
  const [items, setItems] = useState<OralAssessmentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        await ensureWs();
        const res = await list();
        setItems(res.assessments as OralAssessmentListItem[]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not load assessments");
      } finally {
        setLoading(false);
      }
    })();
  }, [ensureWs, list]);

  async function onDelete(item: OralAssessmentListItem) {
    const ok = window.confirm(
      `Delete “${item.title}”? This permanently removes the assessment, invitations, sessions, and uploaded files. This cannot be undone.`,
    );
    if (!ok) return;
    setDeletingId(item.id);
    try {
      await remove({ data: { assessmentId: item.id } });
      toast.success("Assessment deleted");
      setItems((prev) => prev.filter((a) => a.id !== item.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete assessment");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <OralAssessmentShell title="Oral Assessment">
      <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-soft">
        <div className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary mb-4">
          <Mic className="h-3.5 w-3.5" />
          Private beta
        </div>
        <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">
          Penny Oral Assessment Tool
        </h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          Upload an existing assessment. Penny generates an adaptive oral assessment so students can
          explain and defend their understanding — without redesigning your work.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild>
            <Link to="/tools/oral-assessment/create" className="inline-flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Create Oral Assessment
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/tools/oral-assessment/student" className="inline-flex items-center gap-2">
              <GraduationCap className="h-4 w-4" />
              Student view
            </Link>
          </Button>
        </div>

        <div className="mt-10">
          <h2 className="font-display text-lg font-semibold">Your assessments</h2>
          {loading ? (
            <p className="mt-4 text-sm text-muted-foreground inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </p>
          ) : items.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No oral assessments yet. Upload an existing PDF, DOCX, or assignment to begin.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="rounded-2xl border border-border/60 bg-background/50 p-4 hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      to="/tools/oral-assessment/$assessmentId"
                      params={{ assessmentId: item.id }}
                      className="min-w-0 flex-1"
                    >
                      <h3 className="font-medium hover:underline underline-offset-2">{item.title}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {statusLabel(item.status)}
                        {item.published_at
                          ? ` · Published ${new Date(item.published_at).toLocaleDateString()}`
                          : ""}
                      </p>
                    </Link>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        {item.status}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        disabled={deletingId === item.id}
                        onClick={() => void onDelete(item)}
                        aria-label={`Delete ${item.title}`}
                      >
                        {deletingId === item.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="mt-8 text-xs text-muted-foreground">
          <Link to="/tools" className="underline-offset-2 hover:underline">
            ← All Tools
          </Link>
        </p>
      </div>
    </OralAssessmentShell>
  );
}
