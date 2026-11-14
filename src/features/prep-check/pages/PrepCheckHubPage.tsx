import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardCheck, FolderOpen, Settings2, Upload } from "lucide-react";
import { PrepCheckShell } from "@/features/prep-check/components/PrepCheckShell";
import { listResponsibilitySubjects } from "@/features/prep-check/services/responsibilities.functions";
import { Button } from "@/components/ui/button";
import type { PrepCheckToolMeta } from "@/features/prep-check/types";

const TOOLS: PrepCheckToolMeta[] = [
  {
    id: "pack_review",
    title: "Planning model review",
    description:
      "Build your school-year planning model from any documents, then run Prep Check or Subject Head Review against relationships across the year.",
    available: true,
  },
];

type ResponsibilitySubject = { id: string; name: string; gradeCount: number };

export function PrepCheckHubPage() {
  const loadSubjects = useServerFn(listResponsibilitySubjects);
  const [subjects, setSubjects] = useState<ResponsibilitySubject[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        setSubjects((await loadSubjects()) as ResponsibilitySubject[]);
      } catch {
        setSubjects([]);
      }
    })();
  }, [loadSubjects]);

  return (
    <PrepCheckShell title="Prep Check">
      <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-soft">
        <div className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary mb-4">
          <ClipboardCheck className="h-3.5 w-3.5" />
          Private beta
        </div>
        <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">
          Prep Check
        </h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          AI curriculum planning checker powered by a Planning Intelligence Engine — Penny organises
          your school&apos;s planning structure, then reviews how the pieces connect.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild>
            <Link
              to="/tools/prep-check/library"
              search={{}}
              className="inline-flex items-center gap-2"
            >
              <FolderOpen className="h-4 w-4" />
              Planning library
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/tools/prep-check/config" className="inline-flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              Configure school &amp; stages
            </Link>
          </Button>
        </div>

        {subjects.length ? (
          <div className="mt-8">
            <h2 className="font-display text-lg font-semibold">Your subjects</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Open a subject to see planning progress for every grade you lead.
            </p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {subjects.map((s) => (
                <li key={s.id}>
                  <Link
                    to="/tools/prep-check/subject/$subjectId"
                    params={{ subjectId: s.id }}
                    className="block rounded-2xl border border-border/60 bg-background/50 p-4 transition-colors hover:border-primary/60"
                  >
                    <p className="font-medium text-foreground">{s.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {s.gradeCount
                        ? `${s.gradeCount} grade${s.gradeCount === 1 ? "" : "s"}`
                        : "No grades assigned yet"}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <ul className="mt-8 space-y-4">
          {TOOLS.map((tool) => (
            <li
              key={tool.id}
              className="rounded-2xl border border-border/60 bg-background/50 p-4 sm:p-5"
            >
              <h2 className="font-display text-lg font-semibold">{tool.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                {tool.description}
              </p>
              {tool.available ? (
                <Button asChild className="mt-4">
                  <Link
                    to="/tools/prep-check/review"
                    search={{}}
                    className="inline-flex items-center gap-2"
                  >
                    <Upload className="h-4 w-4" />
                    Start review
                  </Link>
                </Button>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">Coming soon</p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </PrepCheckShell>
  );
}
