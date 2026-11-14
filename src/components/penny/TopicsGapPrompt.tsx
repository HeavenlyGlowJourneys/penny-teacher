// Prompt teachers to fill in missing topics_covered for assessments before
// generating report comments or parent messages. Only renders assessments
// with no topics recorded — those already recorded stay untouched. Saves
// topics to the database so future runs remember them.

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Mic, MicOff, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useVoice } from "@/hooks/use-voice";
import { supabase } from "@/integrations/supabase/client";

export type TopicsGapItem = {
  id: string;
  name: string;
  topicsCovered: string | null;
};

interface Props {
  assessments: TopicsGapItem[];
  /** Called with the assessment id and the saved topics text after a successful DB write. */
  onSaved: (assessmentId: string, topics: string) => void;
}

export function TopicsGapPrompt({ assessments, onSaved }: Props) {
  const missing = useMemo(
    () => assessments.filter((a) => !a.topicsCovered || a.topicsCovered.trim().length === 0),
    [assessments],
  );

  if (missing.length === 0) return null;

  return (
    <div className="rounded-2xl border border-input bg-card-warm p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold">
          {missing.length} assessment{missing.length === 1 ? "" : "s"} {missing.length === 1 ? "has" : "have"} no topics recorded.
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Add details to improve your comments. Optional — leave blank and Penny will work from marks alone.
        </p>
      </div>
      <div className="space-y-2">
        {missing.map((a) => (
          <TopicsGapRow key={a.id} item={a} onSaved={onSaved} />
        ))}
      </div>
    </div>
  );
}

function TopicsGapRow({ item, onSaved }: { item: TopicsGapItem; onSaved: (id: string, text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const { state, interim, start, stop } = useVoice((finalText) => {
    setText((prev) => (prev.trim() ? `${prev.trim()} ${finalText}` : finalText));
  });
  const listening = state === "listening";
  const supported = state !== "unsupported";

  async function handleSave() {
    const value = text.trim();
    if (!value) return;
    setSaving(true);
    const { error } = await supabase
      .from("assessments")
      .update({ topics_covered: value })
      .eq("id", item.id);
    setSaving(false);
    if (error) {
      toast.error("Couldn't save topics — try again.");
      return;
    }
    setSaved(true);
    toast.success("Topics saved — Penny will use these for future comments too.");
    onSaved(item.id, value);
    setTimeout(() => setOpen(false), 400);
  }

  if (saved) {
    return (
      <div className="rounded-xl border border-primary/40 bg-primary-soft/40 px-3 py-2.5 flex items-center gap-2 text-sm">
        <Check className="h-4 w-4 text-primary" />
        <span className="truncate">{item.name}</span>
        <span className="ml-auto text-xs text-muted-foreground">Topics saved</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-input bg-background">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="min-w-0 flex-1">
          <span className="text-sm font-medium truncate block">{item.name} — no topics recorded</span>
        </span>
        <span className="flex items-center gap-2 shrink-0 text-xs">
          <span className="rounded-full bg-warning/25 text-warning-foreground px-2 py-0.5 font-medium">
            No topics recorded
          </span>
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <span className="inline-flex items-center gap-1 text-primary font-medium">
              Add topics <ChevronDown className="h-4 w-4" />
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-3 border-t border-input/60 space-y-2">
          <div>
            <p className="text-sm font-medium">What did your class cover in this assessment?</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              (optional — helps Penny write more specific comments)
            </p>
          </div>
          <div className="flex items-start gap-2">
            {supported && (
              <Button
                type="button"
                size="sm"
                variant={listening ? "default" : "outline"}
                className="rounded-full h-9"
                onClick={() => (listening ? stop() : start())}
              >
                {listening ? <MicOff className="h-3.5 w-3.5 mr-1" /> : <Mic className="h-3.5 w-3.5 mr-1" />}
                {listening ? "Listening…" : "Tap and speak"}
              </Button>
            )}
          </div>
          {listening && interim && (
            <p className="text-xs text-muted-foreground italic">{interim}…</p>
          )}
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. We covered equivalent fractions, mixed numbers, and improper fractions"
            className="rounded-xl min-h-[90px] text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-full"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="rounded-full"
              onClick={handleSave}
              disabled={!text.trim() || saving}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
              Save topics
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
