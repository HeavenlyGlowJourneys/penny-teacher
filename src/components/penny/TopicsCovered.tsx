import { useEffect, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useVoice } from "@/hooks/use-voice";

interface TopicsCoveredProps {
  value: string;
  onChange: (next: string) => void;
}

/**
 * Topics Covered input — type or dictate. Voice transcription is appended
 * to existing text so the teacher can mix typing and speaking, and edit
 * the result before saving. Re-uses the existing useVoice hook; no new
 * speech implementation.
 */
export function TopicsCovered({ value, onChange }: TopicsCoveredProps) {
  const [baseAtStart, setBaseAtStart] = useState("");

  const { state, interim, start, stop } = useVoice((finalText) => {
    onChange(((baseAtStart ? baseAtStart + " " : "") + finalText).trim());
    setBaseAtStart((b) => (b ? b + " " : "") + finalText);
  });

  const listening = state === "listening";
  const unsupported = state === "unsupported";

  useEffect(() => () => { if (listening) stop(); }, [listening, stop]);

  function toggleMic() {
    if (listening) { stop(); return; }
    setBaseAtStart(value.trim());
    start();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <Label htmlFor="topics" className="text-xs uppercase tracking-wide text-muted-foreground">
          Topics covered
        </Label>
        {!unsupported && (
          <Button
            type="button"
            size="sm"
            variant={listening ? "default" : "outline"}
            onClick={toggleMic}
            className="h-8 rounded-full px-3 text-xs"
          >
            {listening ? <MicOff className="h-3.5 w-3.5 mr-1" /> : <Mic className="h-3.5 w-3.5 mr-1" />}
            {listening ? "Stop" : "Say it"}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground -mt-1">
        What did this assessment cover? Penny will use this for report comments and parent messages later.
      </p>
      <Textarea
        id="topics"
        value={value + (listening && interim ? ` ${interim}` : "")}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          listening
            ? "Listening… tell me what topics this assessment covered."
            : "e.g. Equivalent fractions, simplifying fractions, adding fractions with different denominators"
        }
        className="min-h-[96px] rounded-xl"
      />
      {unsupported && (
        <p className="text-[11px] text-muted-foreground">
          Voice input isn't supported in this browser — type your topics above.
        </p>
      )}
    </div>
  );
}
