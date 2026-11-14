import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Users, UserPlus, ClipboardList, Mic, CheckCircle2, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const STORAGE_PREFIX = "penny_onboarding_complete_";

type Counts = {
  classes: number;
  learners: number;
  assessments: number;
  marks: number;
  firstClassId: string | null;
  firstAssessmentId: string | null;
};

export function OnboardingChecklist({ userId }: { userId: string }) {
  const storageKey = `${STORAGE_PREFIX}${userId}`;
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [celebrated, setCelebrated] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setDismissed(window.localStorage.getItem(storageKey) === "1");
  }, [storageKey]);

  const { data, isLoading } = useQuery<Counts>({
    queryKey: ["onboarding-progress", userId],
    enabled: dismissed === false,
    queryFn: async () => {
      const [classesRes, learnersRes, assessRes, marksRes] = await Promise.all([
        supabase
          .from("classes")
          .select("id", { count: "exact" })
          .order("created_at", { ascending: true })
          .limit(1),
        supabase.from("learners").select("id", { count: "exact", head: true }),
        supabase
          .from("assessments")
          .select("id", { count: "exact" })
          .order("created_at", { ascending: true })
          .limit(1),
        supabase.from("marks").select("id", { count: "exact", head: true }).eq("status", "captured"),
      ]);
      return {
        classes: classesRes.count ?? 0,
        learners: learnersRes.count ?? 0,
        assessments: assessRes.count ?? 0,
        marks: marksRes.count ?? 0,
        firstClassId: classesRes.data?.[0]?.id ?? null,
        firstAssessmentId: assessRes.data?.[0]?.id ?? null,
      };
    },
  });

  const allDone =
    !!data && data.classes > 0 && data.learners > 0 && data.assessments > 0 && data.marks > 0;

  // If a teacher already has full data on very first load, mark complete silently.
  useEffect(() => {
    if (dismissed !== false) return;
    if (!data) return;
    if (allDone && !celebrated) {
      // If they've completed everything before ever seeing the card, dismiss instantly.
      // We use a heuristic: if we never showed celebration yet AND everything's done,
      // give a brief celebration then persist. But for existing teachers, we want silent.
      // Detect "existing teacher" as: has more than trivial data (multiple marks).
      if (data.marks > 3) {
        try {
          window.localStorage.setItem(storageKey, "1");
        } catch {
          // ignore
        }
        setDismissed(true);
        return;
      }
      setCelebrated(true);
      const t = window.setTimeout(() => {
        try {
          window.localStorage.setItem(storageKey, "1");
        } catch {
          // ignore
        }
        setDismissed(true);
      }, 3000);
      return () => window.clearTimeout(t);
    }
  }, [data, allDone, celebrated, dismissed, storageKey]);

  const steps = useMemo(() => {
    const c = data ?? { classes: 0, learners: 0, assessments: 0, marks: 0, firstClassId: null, firstAssessmentId: null };
    return [
      {
        key: "class",
        icon: Users,
        label: "Create your first class",
        done: c.classes > 0,
        cta: "Create a class",
        to: "/class/new" as const,
        params: undefined as undefined,
      },
      {
        key: "learners",
        icon: UserPlus,
        label: "Add your learners",
        done: c.learners > 0,
        cta: "Add learners",
        to: c.firstClassId ? ("/class/$classId" as const) : ("/class/new" as const),
        params: c.firstClassId ? { classId: c.firstClassId } : undefined,
      },
      {
        key: "assessment",
        icon: ClipboardList,
        label: "Create an assessment",
        done: c.assessments > 0,
        cta: "Create assessment",
        to: c.firstClassId ? ("/class/$classId" as const) : ("/class/new" as const),
        params: c.firstClassId ? { classId: c.firstClassId } : undefined,
      },
      {
        key: "marks",
        icon: Mic,
        label: "Capture marks by voice",
        done: c.marks > 0,
        cta: "Start capturing",
        to: c.firstAssessmentId
          ? ("/assessment/$assessmentId" as const)
          : c.firstClassId
            ? ("/class/$classId" as const)
            : ("/class/new" as const),
        params: c.firstAssessmentId
          ? { assessmentId: c.firstAssessmentId }
          : c.firstClassId
            ? { classId: c.firstClassId }
            : undefined,
      },
    ];
  }, [data]);

  const doneCount = steps.filter((s) => s.done).length;
  const totalSteps = 5;
  const displayedDone = allDone ? 5 : doneCount;
  const progressPct = (displayedDone / totalSteps) * 100;

  function dismiss() {
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // ignore
    }
    setDismissed(true);
  }

  if (dismissed !== false) return null;
  if (isLoading || !data) return null;

  if (celebrated && allDone) {
    return (
      <div className="mb-4 rounded-2xl bg-primary-soft border border-primary/20 p-5 text-center shadow-soft">
        <p className="font-display text-xl font-semibold">You're all set! ☕</p>
        <p className="text-sm text-muted-foreground mt-1">
          Go make yourself a coffee. Penny is ready when you are.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-2xl bg-card border border-primary/15 p-5 shadow-soft relative">
      <button
        onClick={dismiss}
        className="absolute top-3 right-3 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        aria-label="Skip onboarding"
      >
        Skip for now <X className="h-3 w-3" />
      </button>
      <div className="pr-16">
        <h2 className="font-display text-lg font-semibold">Welcome to Penny! Let's get you set up.</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Complete these steps to capture your first marks.
        </p>
      </div>
      <div className="mt-3">
        <p className="text-xs text-muted-foreground mb-1.5 tabular-nums">
          {displayedDone} of {totalSteps} steps complete
        </p>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>
      <ul className="mt-4 space-y-2">
        {steps.map((s) => {
          const Icon = s.icon;
          return (
            <li
              key={s.key}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
                s.done ? "bg-muted/40" : "bg-card-warm"
              }`}
            >
              <div
                className={`h-8 w-8 flex-none rounded-lg flex items-center justify-center ${
                  s.done ? "bg-primary/15 text-primary" : "bg-primary-soft text-primary"
                }`}
              >
                {s.done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <p
                className={`flex-1 text-sm ${
                  s.done ? "text-muted-foreground line-through" : "font-medium"
                }`}
              >
                {s.label}
              </p>
              {!s.done && (
                <Button asChild size="sm" className="rounded-full h-8 flex-none">
                  <Link to={s.to} params={s.params as never}>
                    {s.cta}
                  </Link>
                </Button>
              )}
            </li>
          );
        })}
        {allDone && (
          <li className="flex items-center gap-3 rounded-xl px-3 py-2.5 bg-primary-soft border border-primary/20">
            <div className="h-8 w-8 flex-none rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <p className="flex-1 text-sm font-medium">
              You're all set — Penny is ready to go!
            </p>
          </li>
        )}
      </ul>
    </div>
  );
}
