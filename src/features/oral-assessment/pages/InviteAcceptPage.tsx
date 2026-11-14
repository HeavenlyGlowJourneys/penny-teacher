import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Mic } from "lucide-react";
import { toast } from "sonner";
import { OralAssessmentShell } from "@/features/oral-assessment/components/OralAssessmentShell";
import {
  acceptOralInviteByToken,
  startInterviewFromInvite,
} from "@/features/oral-assessment/services/interview.functions";
import { Button } from "@/components/ui/button";

type InviteInfo = Awaited<ReturnType<typeof acceptOralInviteByToken>>;

export function InviteAcceptPage({ token }: { token: string }) {
  const navigate = useNavigate();
  const accept = useServerFn(acceptOralInviteByToken);
  const start = useServerFn(startInterviewFromInvite);
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await accept({ data: { token } });
        setInfo(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not accept invitation");
      } finally {
        setLoading(false);
      }
    })();
  }, [accept, token]);

  async function onStart() {
    setBusy(true);
    try {
      const res = await start({ data: { token } });
      void navigate({
        to: "/tools/oral-assessment/interview/$sessionId",
        params: { sessionId: res.sessionId },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start assessment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <OralAssessmentShell title="Invitation">
      <nav className="mb-4 text-xs uppercase tracking-wide text-muted-foreground">
        <Link to="/tools/oral-assessment/student" className="hover:text-foreground">
          Student
        </Link>
        <span className="mx-2">/</span>
        <span>Invite</span>
      </nav>

      <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-soft">
        <div className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary mb-4">
          <Mic className="h-3.5 w-3.5" />
          Oral assessment invite
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Accepting invitation…
          </p>
        ) : error ? (
          <>
            <h1 className="font-display text-2xl font-semibold tracking-tight">Invitation issue</h1>
            <p className="mt-2 text-sm text-destructive leading-relaxed">{error}</p>
            <Button asChild variant="outline" className="mt-6">
              <Link to="/tools/oral-assessment/student">Go to student dashboard</Link>
            </Button>
          </>
        ) : info ? (
          <>
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              {info.assessmentTitle}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              Invitation {info.status}. Sign in with the invited email, then start when you are
              ready. Prefer Chrome or Edge with a microphone.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {info.canStart ? (
                <Button disabled={busy} onClick={() => void onStart()}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start Assessment"}
                </Button>
              ) : (
                <span className="text-sm text-muted-foreground">
                  Assessment status: {info.assessmentStatus}. Not available yet.
                </span>
              )}
              <Button asChild variant="outline">
                <Link to="/tools/oral-assessment/student">All invitations</Link>
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </OralAssessmentShell>
  );
}
