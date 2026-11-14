import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Mic } from "lucide-react";
import { toast } from "sonner";
import { OralAssessmentShell } from "@/features/oral-assessment/components/OralAssessmentShell";
import {
  listStudentInvitations,
  startInterviewFromInvite,
} from "@/features/oral-assessment/services/interview.functions";
import { Button } from "@/components/ui/button";

type InvitationRow = {
  id: string;
  assessment_id: string;
  status: string;
  invite_token: string;
  assessment: { id: string; title: string; status: string } | null;
  openSession: { id: string; status: string } | null;
};

type OpenSessionRow = {
  id: string;
  assessment_id: string;
  status: string;
  updated_at: string;
  assessment: { id: string; title: string; status: string } | null;
};

export function StudentDashboardPage() {
  const navigate = useNavigate();
  const listInvites = useServerFn(listStudentInvitations);
  const startFromInvite = useServerFn(startInterviewFromInvite);
  const [invites, setInvites] = useState<InvitationRow[]>([]);
  const [openSessions, setOpenSessions] = useState<OpenSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await listInvites();
        setInvites(res.invitations);
        setOpenSessions(res.openSessions ?? []);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not load invitations");
      } finally {
        setLoading(false);
      }
    })();
  }, [listInvites]);

  async function onStart(inv: InvitationRow) {
    setBusyId(inv.id);
    try {
      if (inv.openSession) {
        void navigate({
          to: "/tools/oral-assessment/interview/$sessionId",
          params: { sessionId: inv.openSession.id },
        });
        return;
      }
      const res = await startFromInvite({ data: { token: inv.invite_token } });
      void navigate({
        to: "/tools/oral-assessment/interview/$sessionId",
        params: { sessionId: res.sessionId },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start assessment");
    } finally {
      setBusyId(null);
    }
  }

  function onContinueSession(sessionId: string) {
    void navigate({
      to: "/tools/oral-assessment/interview/$sessionId",
      params: { sessionId },
    });
  }

  return (
    <OralAssessmentShell title="Student">
      <nav className="mb-4 text-xs uppercase tracking-wide text-muted-foreground">
        <Link to="/tools/oral-assessment" className="hover:text-foreground">
          Oral Assessment
        </Link>
        <span className="mx-2">/</span>
        <span>Student</span>
      </nav>

      <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-soft">
        <div className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary mb-4">
          <Mic className="h-3.5 w-3.5" />
          Student dashboard
        </div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Your oral assessments</h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          Start when ready. The viva is a continuous conversation — stay in the tab until you
          finish. Leaving early is visible to your lecturer.
        </p>

        {loading ? (
          <p className="mt-6 text-sm text-muted-foreground inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </p>
        ) : (
          <>
            {openSessions.length > 0 ? (
              <section className="mt-6">
                <h2 className="font-display text-lg font-semibold">Continue</h2>
                <ul className="mt-3 space-y-3">
                  {openSessions.map((s) => (
                    <li
                      key={s.id}
                      className="rounded-2xl border border-primary/30 bg-primary-soft/30 p-4 flex flex-wrap items-center justify-between gap-3"
                    >
                      <div>
                        <p className="font-medium">{s.assessment?.title ?? "Assessment"}</p>
                        <p className="text-xs text-muted-foreground mt-1 capitalize">
                          {s.status.replace(/_/g, " ")} · saved{" "}
                          {new Date(s.updated_at).toLocaleString()}
                        </p>
                      </div>
                      <Button onClick={() => onContinueSession(s.id)}>Continue</Button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {invites.length === 0 ? (
              <p className="mt-6 text-sm text-muted-foreground">
                No invitations yet. Open the link from your lecturer&apos;s email, or ask them to
                invite this account&apos;s email address.
              </p>
            ) : (
              <section className={openSessions.length ? "mt-8" : "mt-6"}>
                <h2 className="font-display text-lg font-semibold">Invitations</h2>
                <ul className="mt-3 space-y-3">
                  {invites.map((inv) => {
                    const hasOpen = Boolean(inv.openSession);
                    const available =
                      inv.assessment && ["ready", "published"].includes(inv.assessment.status);
                    return (
                      <li
                        key={inv.id}
                        className="rounded-2xl border border-border/60 bg-background/50 p-4 flex flex-wrap items-center justify-between gap-3"
                      >
                        <div>
                          <p className="font-medium">{inv.assessment?.title ?? "Assessment"}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Invite · {inv.status}
                            {hasOpen ? ` · ${inv.openSession!.status}` : ""}
                          </p>
                        </div>
                        {available ? (
                          <Button
                            disabled={busyId === inv.id}
                            onClick={() => void onStart(inv)}
                          >
                            {busyId === inv.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : hasOpen ? (
                              "Continue"
                            ) : (
                              "Start Assessment"
                            )}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">Not available yet</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </OralAssessmentShell>
  );
}
