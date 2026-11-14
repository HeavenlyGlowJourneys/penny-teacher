import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/penny/AppShell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  useTeacherSettings, useSaveTeacherSettings, SENTENCE_BUCKET_LABEL,
  type CommentLengthSentences, type CommentLengthType, type LearnerTerm,
} from "@/hooks/use-teacher-settings";

export const Route = createFileRoute("/_authenticated/settings/preferences")({
  head: () => ({ meta: [{ title: "School preferences – Penny" }] }),
  component: PreferencesPage,
});

const BUCKETS: CommentLengthSentences[] = ["short", "medium", "long", "extended"];

function PreferencesPage() {
  const { user } = Route.useRouteContext();
  const { data: settings } = useTeacherSettings(user.id);
  const save = useSaveTeacherSettings();

  const [lengthType, setLengthType] = useState<CommentLengthType>("sentences");
  const [sentences, setSentences] = useState<CommentLengthSentences>("medium");
  const [words, setWords] = useState<string>("");
  const [learnerTerm, setLearnerTerm] = useState<LearnerTerm>("learner");

  useEffect(() => {
    if (!settings) return;
    setLengthType(settings.comment_length_type);
    setSentences(settings.comment_length_sentences);
    setWords(settings.comment_length_words != null ? String(settings.comment_length_words) : "");
    setLearnerTerm(settings.learner_term);
  }, [settings]);

  const wordsUsed = lengthType === "words";

  async function handleSave() {
    let wordCount: number | null = null;
    if (wordsUsed) {
      const n = parseInt(words, 10);
      if (!Number.isFinite(n) || n < 50 || n > 500) {
        toast.error("Enter a word limit between 50 and 500.");
        return;
      }
      wordCount = n;
    }
    try {
      await save.mutateAsync({
        teacherId: user.id,
        comment_length_type: lengthType,
        comment_length_sentences: sentences,
        comment_length_words: wordCount,
        learner_term: learnerTerm,
      });
      toast.success("School preferences saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save preferences.");
    }
  }

  return (
    <AppShell back="/settings" title="School preferences">
      <div className="space-y-6 pb-16">
        <div className="rounded-3xl bg-card p-5 shadow-soft space-y-4">
          <div>
            <h2 className="font-display text-lg font-semibold">How does your school refer to pupils?</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Penny will use this term everywhere in the app and in AI-generated content.
            </p>
          </div>
          <div className="space-y-2">
            {(["learner", "student"] as const).map((t) => {
              const selected = learnerTerm === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setLearnerTerm(t)}
                  className={`w-full text-left rounded-xl border p-3 transition-colors ${
                    selected ? "border-primary bg-primary-soft" : "border-input bg-background hover:bg-accent"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-4 w-4 rounded-full border-2 flex-shrink-0 ${selected ? "border-primary bg-primary" : "border-muted-foreground/40"}`} />
                    <span className="text-sm font-medium">{t === "learner" ? "Learners" : "Students"}</span>
                    {t === "learner" && <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">Default</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-3xl bg-card p-5 shadow-soft space-y-5">
          <div>
            <h2 className="font-display text-lg font-semibold">How long are your report comments?</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Penny will use this when drafting report comments. You can override it for a single session on the Report comments screen.
            </p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Option A — By sentences</p>
            <div className="space-y-2">
              {BUCKETS.map((b) => {
                const selected = !wordsUsed && sentences === b;
                return (
                  <button
                    key={b}
                    type="button"
                    onClick={() => { setLengthType("sentences"); setSentences(b); }}
                    className={`w-full text-left rounded-xl border p-3 transition-colors ${
                      selected ? "border-primary bg-primary-soft" : "border-input bg-background hover:bg-accent"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`h-4 w-4 rounded-full border-2 flex-shrink-0 ${selected ? "border-primary bg-primary" : "border-muted-foreground/40"}`} />
                      <span className="text-sm font-medium">{SENTENCE_BUCKET_LABEL[b]}</span>
                      {b === "medium" && <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">Default</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl bg-card-warm p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium">Option B — My school uses a word limit</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Overrides the sentence option when turned on.
                </p>
              </div>
              <Switch
                checked={wordsUsed}
                onCheckedChange={(v) => setLengthType(v ? "words" : "sentences")}
              />
            </div>
            {wordsUsed && (
              <div>
                <Label htmlFor="word-cap" className="text-sm font-medium">Maximum words per comment</Label>
                <Input
                  id="word-cap"
                  type="number"
                  min={50}
                  max={500}
                  placeholder="e.g. 200"
                  value={words}
                  onChange={(e) => setWords(e.target.value)}
                  className="mt-1 rounded-xl h-11"
                />
                <p className="text-xs text-muted-foreground mt-1">Between 50 and 500 words.</p>
              </div>
            )}
          </div>

          <Button
            onClick={handleSave}
            disabled={save.isPending}
            className="w-full h-12 rounded-2xl text-base shadow-warm"
          >
            {save.isPending ? "Saving…" : "Save preferences"}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
