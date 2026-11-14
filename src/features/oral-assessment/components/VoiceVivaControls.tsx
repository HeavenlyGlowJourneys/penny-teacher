import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

export type VivaPhase =
  | "ready"
  | "speaking"
  | "listening"
  | "thinking"
  | "paused"
  | "unsupported"
  | "completed";

export function AudioLevelMeter({ level }: { level: number }) {
  const bars = 12;
  return (
    <div className="flex items-end justify-center gap-1 h-10" aria-hidden>
      {Array.from({ length: bars }).map((_, i) => {
        const threshold = (i + 1) / bars;
        const on = level >= threshold * 0.55;
        const h = 6 + (i / bars) * 28;
        return (
          <span
            key={i}
            className={`w-1.5 rounded-full transition-all duration-75 ${
              on ? "bg-primary" : "bg-border"
            }`}
            style={{ height: on ? `${h * (0.35 + level)}px` : "6px" }}
          />
        );
      })}
    </div>
  );
}

export function phaseLabel(phase: VivaPhase): string {
  switch (phase) {
    case "speaking":
      return "Penny is speaking";
    case "listening":
      return "Your turn — answer aloud";
    case "thinking":
      return "Next question…";
    case "paused":
      return "Continue when ready";
    case "ready":
      return "Ready when you are";
    case "unsupported":
      return "Voice not supported in this browser";
    case "completed":
      return "Assessment complete";
    default:
      return "";
  }
}

/**
 * Continuous viva controls: start, finish speaking, emergency end.
 * No Pause — pausing would let students consult AI mid-question.
 */
export function VoiceVivaControls({
  phase,
  onStart,
  onEndAssessment,
  onDoneSpeaking,
  disabled,
}: {
  phase: VivaPhase;
  onStart: () => void;
  onEndAssessment?: () => void;
  onDoneSpeaking?: () => void;
  disabled?: boolean;
}) {
  const showStart = phase === "ready" || phase === "paused" || phase === "unsupported";
  const showEnd =
    Boolean(onEndAssessment) &&
    phase !== "ready" &&
    phase !== "completed" &&
    phase !== "unsupported";

  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      {showStart ? (
        <Button
          type="button"
          disabled={disabled || phase === "unsupported"}
          onClick={onStart}
          className="inline-flex items-center gap-2 min-w-[140px]"
        >
          <Mic className="h-4 w-4" />
          {phase === "paused" ? "Continue" : "Start"}
        </Button>
      ) : null}
      {phase === "listening" && onDoneSpeaking ? (
        <Button type="button" variant="secondary" disabled={disabled} onClick={onDoneSpeaking}>
          I&apos;m done speaking
        </Button>
      ) : null}
      {showEnd ? (
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          onClick={onEndAssessment}
          className="inline-flex items-center gap-2 text-muted-foreground"
        >
          <Square className="h-3.5 w-3.5" />
          End assessment
        </Button>
      ) : null}
    </div>
  );
}
