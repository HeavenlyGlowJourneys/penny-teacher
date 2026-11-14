import { useEffect, useState } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ClipboardCheck, Mic, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { canUsePrepCheck } from "@/features/prep-check";
import { canUseOralAssessment } from "@/features/oral-assessment";
import { PennyWordmark } from "@/components/penny/Logo";
import { LegalFooter } from "@/components/penny/LegalFooter";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/tools/")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  head: () => ({
    meta: [
      { title: "Tools — Penny" },
      {
        name: "description",
        content: "Modular Penny tools for educators.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ToolsHubPage,
});

function ToolsHubPage() {
  const { data } = useAuthEmail();
  const email = data?.email;
  const oral = canUseOralAssessment(email);
  const prep = canUsePrepCheck(email);

  return (
    <div className="min-h-screen mx-auto max-w-2xl px-5 pb-16 pt-8 flex flex-col">
      <header className="mb-10 flex items-center justify-between gap-4">
        <Link to="/" className="inline-flex items-center">
          <PennyWordmark />
        </Link>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Tools
        </span>
      </header>

      <main className="flex-1">
        <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-soft">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary mb-4">
            <Wrench className="h-3.5 w-3.5" />
            Penny Tools
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">Tools</h1>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            Modular products on the Penny platform — shared auth and branding, independent product
            logic.
          </p>

          <ul className="mt-8 space-y-4">
            <li className="rounded-2xl border border-border/60 bg-background/50 p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <Mic className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-lg font-semibold">
                    Penny Oral Assessment Tool
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                    Verify authentic understanding with adaptive oral assessments — upload what you
                    already use.
                  </p>
                  {oral ? (
                    <Button asChild className="mt-4">
                      <Link to="/tools/oral-assessment">Open</Link>
                    </Button>
                  ) : (
                    <p className="mt-3 text-xs text-muted-foreground">Private beta — founder access</p>
                  )}
                </div>
              </div>
            </li>

            <li className="rounded-2xl border border-border/60 bg-background/50 p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <ClipboardCheck className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-lg font-semibold">Prep Check</h2>
                  <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                    AI curriculum planning checker for teachers and subject heads.
                  </p>
                  {prep ? (
                    <Button asChild variant="outline" className="mt-4">
                      <Link to="/tools/prep-check">Open</Link>
                    </Button>
                  ) : (
                    <p className="mt-3 text-xs text-muted-foreground">Private beta — founder access</p>
                  )}
                </div>
              </div>
            </li>
          </ul>
        </div>
      </main>

      <LegalFooter />
    </div>
  );
}

function useAuthEmail() {
  const [data, setData] = useState<{ email: string | null } | null>(null);
  useEffect(() => {
    void supabase.auth.getUser().then(({ data: { user } }) => {
      setData({ email: user?.email ?? null });
    });
  }, []);
  return { data };
}
