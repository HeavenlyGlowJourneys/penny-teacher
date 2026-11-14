import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { OralAssessmentShell } from "@/features/oral-assessment/components/OralAssessmentShell";
import {
  AudioLevelMeter,
  VoiceVivaControls,
  phaseLabel,
  type VivaPhase,
} from "@/features/oral-assessment/components/VoiceVivaControls";
import { spokenBriefing } from "@/features/oral-assessment/engines/interview-engine";
import { useOralTts } from "@/features/oral-assessment/hooks/useOralTts";
import { useOralStt } from "@/features/oral-assessment/hooks/useOralStt";
import { useMicLevel } from "@/features/oral-assessment/hooks/useMicLevel";
import {
  beginInterviewQuestions,
  getInterviewSession,
  submitInterviewReply,
  updateInterviewSessionLifecycle,
} from "@/features/oral-assessment/services/interview.functions";
import { Button } from "@/components/ui/button";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function InterviewPage({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate();
  const load = useServerFn(getInterviewSession);
  const beginQuestions = useServerFn(beginInterviewQuestions);
  const reply = useServerFn(submitInterviewReply);
  const setLifecycle = useServerFn(updateInterviewSessionLifecycle);

  const tts = useOralTts();
  const stt = useOralStt({ silenceMs: 1800, lang: "en-GB" });

  const [title, setTitle] = useState("");
  const [durationMins, setDurationMins] = useState(15);
  const [sessionStatus, setSessionStatus] = useState("");
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [phase, setPhase] = useState<VivaPhase>("ready");
  const [loading, setLoading] = useState(true);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [textMode, setTextMode] = useState(false);
  const [textAnswer, setTextAnswer] = useState("");
  const [voiceUnsupported, setVoiceUnsupported] = useState(false);
  const [startedContinuous, setStartedContinuous] = useState(false);

  const phaseRef = useRef<VivaPhase>("ready");
  const runIdRef = useRef(0);
  const pausedQuestionRef = useRef<string | null>(null);
  const pausedRef = useRef(false);
  const listenRef = useRef<(runId: number) => void>(() => {});
  const textModeRef = useRef(false);
  const startedRef = useRef(false);

  const micActive = phase === "listening" && !textMode;
  const micLevel = useMicLevel(micActive);

  const setPhaseSafe = useCallback((p: VivaPhase) => {
    phaseRef.current = p;
    pausedRef.current = p === "paused";
    setPhase(p);
  }, []);

  const refreshMeta = useCallback(async () => {
    const res = await load({ data: { sessionId } });
    setTitle(res.assessment.title);
    setDurationMins(res.effectiveDurationMinutes ?? res.assessment.expected_duration_minutes);
    setSessionStatus(res.session.status);
    const lastExaminer = [...res.turns].reverse().find((t) => t.role === "examiner");
    if (lastExaminer) {
      setCurrentQuestion(lastExaminer.content);
      pausedQuestionRef.current = lastExaminer.content;
    } else {
      const system = res.turns.find((t) => t.role === "system");
      if (system) setCurrentQuestion(system.content);
    }
    return res;
  }, [load, sessionId]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await refreshMeta();
        if (["completed", "abandoned", "failed"].includes(res.session.status)) {
          setPhaseSafe("completed");
        } else if (res.session.status === "paused" || res.session.status === "in_progress") {
          setPhaseSafe("paused");
          setStatusNote(
            "Continue when you are ready. Leaving mid-viva is visible to your lecturer.",
          );
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not load session");
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshMeta, setPhaseSafe]);

  useEffect(() => {
    if (stt.errorMsg) setStatusNote(stt.errorMsg);
  }, [stt.errorMsg]);

  useEffect(() => {
    if (tts.state === "unsupported" || stt.state === "unsupported") {
      setVoiceUnsupported(true);
      setTextMode(true);
      textModeRef.current = true;
    }
  }, [tts.state, stt.state]);

  // Flag interruptions when the student leaves the tab mid-viva (anti-cheat signal).
  useEffect(() => {
    const onVis = () => {
      if (!startedRef.current) return;
      if (document.visibilityState !== "hidden") return;
      if (!["speaking", "listening", "thinking"].includes(phaseRef.current)) return;
      void setLifecycle({ data: { sessionId, status: "paused" } }).catch(() => {});
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [sessionId, setLifecycle]);

  useEffect(() => {
    return () => {
      runIdRef.current += 1;
      tts.cancel();
      stt.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const advanceAfterAnswer = useCallback(
    async (spoken: string, format: "speech" | "text", runId: number) => {
      if (runId !== runIdRef.current || pausedRef.current) return;
      setPhaseSafe("thinking");
      setStatusNote(null);
      setTextAnswer("");

      try {
        const res = await reply({
          data: {
            sessionId,
            content: spoken,
            responseFormat: format,
          },
        });

        if (res.done) {
          setPhaseSafe("completed");
          toast.success("Oral assessment complete");
          void navigate({
            to: "/tools/oral-assessment/report/$sessionId",
            params: { sessionId },
          });
          return;
        }

        const nextQ = res.examinerTurn?.content ?? "";
        setCurrentQuestion(nextQ);
        pausedQuestionRef.current = nextQ;
        if (runId !== runIdRef.current || pausedRef.current) return;

        if (textModeRef.current) {
          setPhaseSafe("listening");
          setStatusNote("Type your answer, then send.");
          return;
        }

        setPhaseSafe("speaking");
        await tts.speak(nextQ);
        if (runId !== runIdRef.current || pausedRef.current) return;
        await sleep(250);
        listenRef.current(runId);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not continue interview");
        setStatusNote("Connection issue — press Continue. Your lecturer may see this interruption.");
        setPhaseSafe("paused");
        void setLifecycle({ data: { sessionId, status: "paused" } }).catch(() => {});
      }
    },
    [navigate, reply, sessionId, setLifecycle, setPhaseSafe, tts],
  );

  listenRef.current = (runId: number) => {
    if (pausedRef.current || runId !== runIdRef.current) return;
    if (textModeRef.current) {
      setPhaseSafe("listening");
      setStatusNote("Type your answer, then send.");
      return;
    }
    setPhaseSafe("listening");
    setStatusNote(null);

    stt.start((spoken) => {
      void advanceAfterAnswer(spoken, "speech", runId);
    });
  };

  async function onStart() {
    if (!textModeRef.current && (tts.state === "unsupported" || stt.state === "unsupported")) {
      setTextMode(true);
      textModeRef.current = true;
      setVoiceUnsupported(true);
      setStatusNote("Voice not available — typed answers only for this browser.");
    }

    const runId = ++runIdRef.current;
    const resuming =
      pausedRef.current || sessionStatus === "paused" || sessionStatus === "in_progress";
    setStatusNote(null);
    pausedRef.current = false;
    startedRef.current = true;
    setStartedContinuous(true);

    try {
      void setLifecycle({ data: { sessionId, status: "in_progress" } }).catch(() => {});
      setSessionStatus("in_progress");

      if (resuming && (pausedQuestionRef.current || currentQuestion)) {
        const q = pausedQuestionRef.current || currentQuestion;
        if (textModeRef.current) {
          setCurrentQuestion(q);
          setPhaseSafe("listening");
          setStatusNote("Type your answer, then send.");
          return;
        }
        setPhaseSafe("speaking");
        await tts.speak(q);
        if (runId !== runIdRef.current || pausedRef.current) return;
        await sleep(250);
        listenRef.current(runId);
        return;
      }

      const spoken = spokenBriefing({ title, expectedDurationMinutes: durationMins });
      if (textModeRef.current) {
        setCurrentQuestion(spoken);
        setPhaseSafe("thinking");
      } else {
        setPhaseSafe("speaking");
        await tts.speak(spoken);
        if (runId !== runIdRef.current || pausedRef.current) return;
        await sleep(300);
        if (runId !== runIdRef.current || pausedRef.current) return;
        setPhaseSafe("thinking");
      }

      const begun = await beginQuestions({ data: { sessionId } });
      const firstQ = begun.examinerTurn.content;
      setCurrentQuestion(firstQ);
      pausedQuestionRef.current = firstQ;

      if (runId !== runIdRef.current || pausedRef.current) return;

      if (textModeRef.current) {
        setPhaseSafe("listening");
        setStatusNote("Type your answer, then send.");
        return;
      }

      setPhaseSafe("speaking");
      await tts.speak(firstQ);
      if (runId !== runIdRef.current || pausedRef.current) return;
      await sleep(250);
      listenRef.current(runId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start interview");
      setPhaseSafe("paused");
      setStatusNote("Something went wrong — press Continue to try again.");
    }
  }

  async function onEndAssessment() {
    if (
      !window.confirm(
        "End this viva now? Your lecturer will see that it was stopped early, and you may need a new invite to try again.",
      )
    ) {
      return;
    }
    runIdRef.current += 1;
    tts.cancel();
    stt.stop();
    try {
      await setLifecycle({ data: { sessionId, status: "abandoned" } });
      setSessionStatus("abandoned");
      setPhaseSafe("completed");
      toast.message("Assessment ended");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not end assessment");
    }
  }

  function onDoneSpeaking() {
    stt.commitNow();
  }

  async function onSendText() {
    const content = textAnswer.trim();
    if (!content) {
      toast.error("Type an answer first");
      return;
    }
    const runId = ++runIdRef.current;
    pausedRef.current = false;
    await advanceAfterAnswer(content, "text", runId);
  }

  if (loading) {
    return (
      <OralAssessmentShell title="Interview">
        <p className="text-sm text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </p>
      </OralAssessmentShell>
    );
  }

  const closed =
    phase === "completed" || ["completed", "abandoned", "failed"].includes(sessionStatus);
  const inProgress = phase === "listening" || phase === "speaking" || phase === "thinking";

  return (
    <OralAssessmentShell title="Interview">
      <nav className="mb-4 text-xs uppercase tracking-wide text-muted-foreground print:hidden">
        <Link to="/tools/oral-assessment" className="hover:text-foreground">
          Oral Assessment
        </Link>
        <span className="mx-2">/</span>
        <span>Oral viva</span>
      </nav>

      <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-soft flex flex-col min-h-[70vh]">
        <div className="text-center">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Continuous oral viva · about {durationMins} min
            {textMode ? " · typed answers" : ""}
          </p>
          <h1 className="font-display text-2xl font-semibold tracking-tight mt-1">{title}</h1>
        </div>

        <div className="mt-8 rounded-3xl bg-background/70 border border-border/50 px-5 py-8 sm:px-8 text-center">
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-4">
            {phase === "ready" ? "Before we begin" : "Current question"}
          </p>
          <p className="font-display text-xl sm:text-2xl leading-snug whitespace-pre-wrap">
            {currentQuestion ||
              "When you are ready, press Start below. Stay in this tab until you finish."}
          </p>
        </div>

        {!closed && (phase === "ready" || phase === "paused") ? (
          <div className="mt-6 flex flex-col items-center gap-3 print:hidden">
            <Button
              type="button"
              size="lg"
              onClick={() => void onStart()}
              className="min-w-[180px] text-base"
            >
              {phase === "paused" ? "Continue" : "Start"}
            </Button>
            <p className="text-xs text-muted-foreground text-center max-w-sm">
              {phase === "paused"
                ? "Continue the viva from where you left off."
                : "Penny will speak the briefing, then ask the first question."}
            </p>
          </div>
        ) : null}

        <div className="mt-8 flex flex-col items-center gap-3 print:hidden">
          <div
            className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium ${
              phase === "listening"
                ? "bg-primary-soft text-primary"
                : phase === "speaking"
                  ? "bg-amber-50 text-amber-900"
                  : phase === "thinking"
                    ? "bg-muted text-muted-foreground"
                    : "bg-muted/60 text-muted-foreground"
            }`}
            aria-live="polite"
          >
            {(phase === "speaking" || phase === "thinking") && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            {phase === "listening" && !textMode && (
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
              </span>
            )}
            {phaseLabel(closed ? "completed" : phase)}
          </div>

          {phase === "listening" && !textMode ? <AudioLevelMeter level={micLevel} /> : null}

          {statusNote ? (
            <p className="text-xs text-amber-800 text-center max-w-md">{statusNote}</p>
          ) : null}

          {voiceUnsupported ? (
            <p className="text-xs text-muted-foreground text-center max-w-md">
              This browser does not support voice. Use typed answers, or switch to Chrome/Edge for
              the spoken viva.
            </p>
          ) : null}
        </div>

        {!closed && textMode && inProgress ? (
          <div className="mt-6 space-y-3 print:hidden">
            <label
              className="text-[10px] uppercase tracking-wide text-muted-foreground"
              htmlFor="text-answer"
            >
              Your answer
            </label>
            <textarea
              id="text-answer"
              rows={4}
              value={textAnswer}
              onChange={(e) => setTextAnswer(e.target.value)}
              disabled={phase === "thinking"}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Type your answer…"
            />
            <Button
              disabled={phase === "thinking" || !textAnswer.trim()}
              onClick={() => void onSendText()}
            >
              {phase === "thinking" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send answer"}
            </Button>
          </div>
        ) : null}

        {!closed ? (
          <div className="mt-8 print:hidden">
            {/* Start/Continue is shown above next to the briefing; keep mid-viva controls here. */}
            {phase !== "ready" && phase !== "paused" ? (
              !textMode ? (
                <VoiceVivaControls
                  phase={phase}
                  onStart={() => void onStart()}
                  onEndAssessment={() => void onEndAssessment()}
                  onDoneSpeaking={onDoneSpeaking}
                />
              ) : (
                <div className="flex flex-wrap justify-center gap-2">
                  {startedContinuous || inProgress ? (
                    <Button variant="ghost" onClick={() => void onEndAssessment()}>
                      End assessment
                    </Button>
                  ) : null}
                </div>
              )
            ) : (
              <div className="flex flex-wrap justify-center gap-2">
                {startedContinuous ? (
                  <Button variant="ghost" onClick={() => void onEndAssessment()}>
                    End assessment
                  </Button>
                ) : null}
              </div>
            )}
            <p className="mt-4 text-center text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
              This is a continuous conversation. Stay on this page until you finish. Leaving the
              tab or ending early is flagged for your lecturer. Prefer Chrome or Edge with a
              microphone.
            </p>
          </div>
        ) : (
          <div className="mt-8 flex justify-center print:hidden">
            <Button asChild>
              <Link to="/tools/oral-assessment/report/$sessionId" params={{ sessionId }}>
                View report
              </Link>
            </Button>
          </div>
        )}
      </div>
    </OralAssessmentShell>
  );
}
