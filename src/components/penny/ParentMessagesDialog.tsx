import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { Loader2, RefreshCw, Copy, Sparkles, Download, Check, X } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  generateParentMessage, inferMessageType, normalisePronouns,
  type ParentMessageInput, type PronounSet,
} from "@/lib/ai-service";
import { supabase } from "@/integrations/supabase/client";
import { useParentMessageDrafts, upsertDraft } from "@/hooks/use-ai-drafts";
import { useTeacherSettings } from "@/hooks/use-teacher-settings";
import { TopicsGapPrompt } from "@/components/penny/TopicsGapPrompt";

const PRONOUN_OPTIONS: Array<{ value: PronounSet; label: string }> = [
  { value: "he/him", label: "He / Him" },
  { value: "she/her", label: "She / Her" },
  { value: "they/them", label: "They / Them" },
];
import { pct } from "@/lib/penny";

type LearnerLite = { id: string; name: string; pronouns: string | null };
type MarkLite = { mark: number | null; status: string; learner_id: string };

interface ParentMessagesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assessmentId: string;
  teacherId: string;
  assessmentName: string;
  assessmentDate: string;
  subject: string;
  totalMarks: number;
  topicsCovered: string | null;
  learners: LearnerLite[];
  marks: MarkLite[];
}

type GeneratedMessage = {
  learnerId: string;
  learnerName: string;
  pronounSet: PronounSet;
  mark: number;
  percentage: number;
  messageType: ParentMessageInput["messageType"];
  text: string;
  loading?: boolean;
  error?: string | null;
};

export function ParentMessagesDialog({
  open, onOpenChange, assessmentId, teacherId,
  assessmentName, assessmentDate, subject,
  totalMarks, topicsCovered, learners, marks,
}: ParentMessagesDialogProps) {
  const [step, setStep] = useState<"confirm" | "review">("confirm");
  const [messages, setMessages] = useState<GeneratedMessage[]>([]);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  // Local override so freshly-saved topics flow straight into generation
  // without waiting for the parent screen to refetch.
  const [topicsOverride, setTopicsOverride] = useState<string | null>(null);
  useEffect(() => { setTopicsOverride(null); }, [assessmentId]);
  const effectiveTopics = topicsOverride ?? topicsCovered;

  const { data: existingDrafts = [] } = useParentMessageDrafts(open ? assessmentId : null);
  const { data: teacherSettings } = useTeacherSettings(teacherId);
  const learnerTerm = teacherSettings?.learner_term ?? "learner";

  async function persistDraft(m: GeneratedMessage, isEdited: boolean) {
    if (!m.text) return;
    try {
      await upsertDraft({
        teacherId, draftType: "parent_message",
        learnerId: m.learnerId, assessmentId,
        content: m.text, messageType: m.messageType, isEdited,
      });
    } catch { /* silent */ }
  }

  function loadPreviousMessages() {
    const byLearner = new Map(existingDrafts.map((d) => [d.learner_id, d]));
    const loaded: GeneratedMessage[] = eligible.map(({ learner, mark }) => {
      const p = pct(mark, totalMarks);
      const d = byLearner.get(learner.id);
      return {
        learnerId: learner.id, learnerName: learner.name,
        pronounSet: normalisePronouns(learner.pronouns),
        mark, percentage: p,
        messageType: (d?.message_type ?? inferMessageType(p)) as ParentMessageInput["messageType"],
        text: d?.content ?? "",
        error: d ? null : "No previous draft.",
      };
    });
    setMessages(loaded);
    setStep("review");
    toast.success(`Loaded ${existingDrafts.length} previous message${existingDrafts.length === 1 ? "" : "s"}.`);
  }

  // Eligible: captured mark with a numeric value.
  const eligible = learners
    .map((l) => {
      const m = marks.find((mk) => mk.learner_id === l.id);
      if (!m || m.status !== "captured" || typeof m.mark !== "number") return null;
      return { learner: l, mark: m.mark as number };
    })
    .filter((x): x is { learner: LearnerLite; mark: number } => !!x);

  function reset() {
    setStep("confirm");
    setMessages([]);
    setGenerating(false);
    setProgress({ done: 0, total: 0 });
  }

  function handleClose(o: boolean) {
    if (!o) reset();
    onOpenChange(o);
  }

  async function generateOne(learnerId: string, learnerName: string, pronounSet: PronounSet, mark: number): Promise<GeneratedMessage> {
    const percentage = pct(mark, totalMarks);
    const messageType = inferMessageType(percentage);
    const input: ParentMessageInput = {
      learnerName,
      pronounSet,
      parentName: null,
      assessmentName,
      subject,
      mark,
      total: totalMarks,
      percentage,
      topicsCovered: effectiveTopics,
      messageType,
      learnerTerm,
    };
    try {
      const res = await generateParentMessage({ data: input });
      return { learnerId, learnerName, pronounSet, mark, percentage, messageType, text: res.text };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong — nothing was lost. Try again.";
      return { learnerId, learnerName, pronounSet, mark, percentage, messageType, text: "", error: msg };
    }
  }

  async function handleGenerate() {
    if (eligible.length === 0) {
      toast.error("No marks captured yet. Capture marks first, then Penny can write your messages.");
      return;
    }
    setStep("review");
    setGenerating(true);
    setProgress({ done: 0, total: eligible.length });
    setMessages(
      eligible.map(({ learner, mark }) => {
        const p = pct(mark, totalMarks);
        return {
          learnerId: learner.id, learnerName: learner.name,
          pronounSet: normalisePronouns(learner.pronouns),
          mark, percentage: p, messageType: inferMessageType(p),
          text: "", loading: true,
        };
      }),
    );

    for (let i = 0; i < eligible.length; i++) {
      const { learner, mark } = eligible[i];
      const r = await generateOne(learner.id, learner.name, normalisePronouns(learner.pronouns), mark);
      setMessages((prev) => prev.map((m) => (m.learnerId === learner.id ? { ...r, loading: false } : m)));
      setProgress({ done: i + 1, total: eligible.length });
      void persistDraft(r, false);
    }
    setGenerating(false);
    toast.success("Messages ready for your class.");
  }

  async function handleRegenerate(learnerId: string) {
    const item = eligible.find((e) => e.learner.id === learnerId);
    if (!item) return;
    const cur = messages.find((m) => m.learnerId === learnerId);
    const pronounSet = cur?.pronounSet ?? normalisePronouns(item.learner.pronouns);
    setMessages((prev) => prev.map((m) => (m.learnerId === learnerId ? { ...m, loading: true, error: null } : m)));
    const r = await generateOne(item.learner.id, item.learner.name, pronounSet, item.mark);
    setMessages((prev) => prev.map((m) => (m.learnerId === learnerId ? { ...r, loading: false } : m)));
    void persistDraft(r, false);
  }

  async function handlePronounChange(learnerId: string, pronounSet: PronounSet) {
    const item = eligible.find((e) => e.learner.id === learnerId);
    const cur = messages.find((m) => m.learnerId === learnerId);
    if (!item || !cur || cur.pronounSet === pronounSet) return;
    void supabase.from("learners").update({ pronouns: pronounSet }).eq("id", learnerId);
    setMessages((prev) => prev.map((m) => (m.learnerId === learnerId ? { ...m, pronounSet, loading: true, error: null } : m)));
    const r = await generateOne(item.learner.id, item.learner.name, pronounSet, item.mark);
    setMessages((prev) => prev.map((m) => (m.learnerId === learnerId ? { ...r, loading: false } : m)));
    void persistDraft(r, false);
  }

  function handleEdit(learnerId: string, text: string) {
    setMessages((prev) => prev.map((m) => (m.learnerId === learnerId ? { ...m, text } : m)));
    const cur = messages.find((m) => m.learnerId === learnerId);
    if (cur) void persistDraft({ ...cur, text }, true);
  }

  function exportToExcel() {
    const rows = messages.map((m) => [
      m.learnerName, m.mark, m.percentage / 100, labelFor(m.messageType), m.text,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([
      ["Learner Name", "Mark", "Percentage", "Message Type", "Message"],
      ...rows,
    ]);
    for (let i = 0; i < rows.length; i++) {
      const addr = XLSX.utils.encode_cell({ r: i + 1, c: 2 });
      const cell = ws[addr];
      if (cell && typeof cell.v === "number") cell.z = "0%";
    }
    ws["!cols"] = [{ wch: 22 }, { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 70 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Parent Messages");
    const fname = `penny_parent_messages_${assessmentName.replace(/[^a-z0-9]+/gi, "_")}.xlsx`;
    XLSX.writeFile(wb, fname);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="rounded-3xl max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {step === "confirm" ? "Generate parent messages" : "Parent messages"}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {step === "confirm"
              ? "Penny will draft a personalised message for every learner with a captured mark."
              : generating
                ? `Writing messages for your class — one moment. (${progress.done}/${progress.total})`
                : "Review, edit and copy when you are ready."}
          </DialogDescription>
        </DialogHeader>

        {step === "confirm" ? (
          <div className="space-y-4 mt-2">
            <div className="rounded-2xl bg-card-warm p-4 text-sm space-y-1">
              <p className="font-medium">{assessmentName}</p>
              <p className="text-muted-foreground text-xs">
                {subject} · {new Date(assessmentDate).toLocaleDateString()}
              </p>
              <p className="text-muted-foreground text-xs">
                {eligible.length} learner{eligible.length === 1 ? "" : "s"} with marks
              </p>
            </div>
            {eligible.length === 0 ? (
              <p className="text-sm text-muted-foreground rounded-xl bg-muted p-3">
                No marks captured yet. Capture marks first, then Penny can write your messages.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Message tone is chosen automatically: <strong>celebration</strong> (80%+),
                {" "}<strong>encouragement</strong> (50–79%), <strong>intervention</strong> (below 50%).
              </p>
            )}
            <TopicsGapPrompt
              assessments={[{ id: assessmentId, name: assessmentName, topicsCovered: effectiveTopics }]}
              onSaved={(_id, text) => setTopicsOverride(text)}
            />
            {existingDrafts.length > 0 && (
              <div className="rounded-2xl bg-primary-soft border border-primary/20 p-3 text-sm">
                <p className="font-medium">You have previous messages for this assessment.</p>
                <div className="mt-2 flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1 rounded-lg" onClick={loadPreviousMessages}>
                    Load previous messages
                  </Button>
                  <Button variant="ghost" size="sm" className="flex-1 rounded-lg" onClick={handleGenerate}>
                    Generate fresh
                  </Button>
                </div>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <Button variant="ghost" className="flex-1 h-11 rounded-xl" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button
                className="flex-1 h-11 rounded-xl"
                onClick={handleGenerate}
                disabled={eligible.length === 0}
              >
                <Sparkles className="h-4 w-4 mr-1" /> Generate
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 mt-2">
            {messages.map((m) => (
              <MessageCard
                key={m.learnerId}
                msg={m}
                onEdit={(text) => handleEdit(m.learnerId, text)}
                onRegenerate={() => handleRegenerate(m.learnerId)}
                onPronounChange={(p) => handlePronounChange(m.learnerId, p)}
              />
            ))}
            {!generating && messages.length > 0 && (
              <div className="flex gap-2 pt-1">
                <Button variant="ghost" className="flex-1 h-11 rounded-xl" onClick={() => handleClose(false)}>
                  <X className="h-4 w-4 mr-1" /> Done
                </Button>
                <Button className="flex-1 h-11 rounded-xl" onClick={exportToExcel}>
                  <Download className="h-4 w-4 mr-1" /> Export all to Excel
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MessageCard({
  msg, onEdit, onRegenerate, onPronounChange,
}: {
  msg: GeneratedMessage;
  onEdit: (text: string) => void;
  onRegenerate: () => void;
  onPronounChange: (p: PronounSet) => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!msg.text) return;
    try {
      await navigator.clipboard.writeText(msg.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — try again.");
    }
  }

  const badgeClass = {
    celebration: "bg-success/20 text-success-foreground",
    encouragement: "bg-primary-soft text-primary",
    intervention: "bg-warning/30 text-warning-foreground",
  }[msg.messageType];

  const disabled = !!msg.loading;

  return (
    <div className="rounded-2xl bg-card p-4 shadow-soft">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold truncate">{msg.learnerName}</p>
          <p className="text-xs text-muted-foreground">
            {msg.mark} mark · {msg.percentage}%
          </p>
        </div>
        <span className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded-full ${badgeClass}`}>
          {labelFor(msg.messageType)}
        </span>
      </div>

      {msg.loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          Penny is thinking…
        </div>
      ) : msg.error ? (
        <div className="text-sm text-destructive bg-destructive/10 rounded-xl p-3">
          {msg.error}
          <Button variant="outline" size="sm" className="rounded-full mt-2" onClick={onRegenerate}>
            <RefreshCw className="h-3 w-3 mr-1" /> Try again
          </Button>
        </div>
      ) : (
        <>
          <Textarea
            value={msg.text}
            onChange={(e) => onEdit(e.target.value)}
            className="rounded-xl min-h-[100px] text-sm"
          />
          <div className="mt-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Pronouns</p>
            <div className="inline-flex rounded-full border bg-background p-0.5">
              {PRONOUN_OPTIONS.map((opt) => {
                const selected = msg.pronounSet === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={disabled}
                    onClick={() => onPronounChange(opt.value)}
                    className={`px-3 py-1 text-xs rounded-full transition-colors disabled:opacity-50 ${selected ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:text-foreground"}`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <Button variant="outline" size="sm" className="rounded-full" onClick={onRegenerate}>
              <RefreshCw className="h-3 w-3 mr-1" /> Regenerate
            </Button>
            <Button size="sm" className="rounded-full" onClick={handleCopy}>
              {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function labelFor(t: ParentMessageInput["messageType"]): string {
  return t === "celebration" ? "Celebration" : t === "encouragement" ? "Encouragement" : "Intervention";
}
