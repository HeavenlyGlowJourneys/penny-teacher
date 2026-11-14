// Floating "Feedback" button + dialog. Mounted inside the authenticated
// layout so it appears on every signed-in page (never on marketing,
// /auth, or /choose-plan).
import { useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { MessageCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useSubscription, PLAN_LABELS } from "@/hooks/use-subscription";
import { sendFeedback } from "@/lib/feedback.functions";

type Category = "Bug" | "Suggestion" | "Feature request" | "Compliment";
type Stage = "form" | "success" | "error";

function detectBrowser(): string {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  let browser = "Unknown browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = "Safari";
  let os = "Unknown OS";
  if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Linux/.test(ua)) os = "Linux";
  return `${browser} on ${os}`;
}

export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>("Bug");
  const [message, setMessage] = useState("");
  const [stage, setStage] = useState<Stage>("form");
  const [submitting, setSubmitting] = useState(false);
  const location = useLocation();
  const sub = useSubscription();
  const send = useServerFn(sendFeedback);

  const disabled = submitting || message.trim().length < 10;

  function reset() {
    setCategory("Bug");
    setMessage("");
    setStage("form");
    setSubmitting(false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    setSubmitting(true);
    try {
      await send({
        data: {
          category,
          message: message.trim(),
          page: location.pathname,
          browser: detectBrowser(),
          plan: sub.plan ? PLAN_LABELS[sub.plan] : "unknown",
          appVersion: "1.0.0",
        },
      });
      setStage("success");
    } catch {
      setStage("error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        aria-label="Send feedback"
        className="fixed bottom-24 right-4 z-[60] inline-flex items-center gap-2 rounded-full bg-primary/90 px-4 py-2 text-sm font-medium text-primary-foreground shadow-warm backdrop-blur transition-colors hover:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <MessageCircle className="h-4 w-4" />
        Feedback
      </button>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) reset();
        }}
      >
        <DialogContent className="sm:max-w-md">
          {stage === "form" && (
            <form onSubmit={onSubmit} className="space-y-4">
              <DialogHeader>
                <DialogTitle>Drop us a note</DialogTitle>
                <DialogDescription>
                  Anything on your mind — a bug, an idea, or a kind word. We read every one.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2">
                <Label>What's this about?</Label>
                <RadioGroup
                  value={category}
                  onValueChange={(v) => setCategory(v as Category)}
                  className="grid grid-cols-2 gap-2"
                >
                  {(["Bug", "Suggestion", "Feature request", "Compliment"] as Category[]).map(
                    (c) => (
                      <label
                        key={c}
                        className="flex cursor-pointer items-center gap-2 rounded-xl border border-input bg-card px-3 py-2 text-sm shadow-soft has-[button[data-state=checked]]:border-primary has-[button[data-state=checked]]:bg-primary/5"
                      >
                        <RadioGroupItem value={c} />
                        <span>{c}</span>
                      </label>
                    ),
                  )}
                </RadioGroup>
              </div>

              <div className="space-y-2">
                <Label htmlFor="feedback-message">Your message</Label>
                <Textarea
                  id="feedback-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us what's on your mind..."
                  rows={5}
                  required
                  minLength={10}
                />
                <p className="text-xs text-muted-foreground">
                  {message.trim().length < 10
                    ? `A few more words — at least 10 characters (${message.trim().length}/10).`
                    : "Thanks — that's plenty to go on."}
                </p>
              </div>

              <DialogFooter>
                <Button type="submit" disabled={disabled}>
                  {submitting ? "Sending…" : "Send feedback"}
                </Button>
              </DialogFooter>
            </form>
          )}

          {stage === "success" && (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle>Thank you</DialogTitle>
                <DialogDescription>
                  Got it — thank you. Your feedback helps make Penny better for every teacher.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button onClick={() => setOpen(false)}>Close</Button>
              </DialogFooter>
            </div>
          )}

          {stage === "error" && (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle>That didn't go through</DialogTitle>
                <DialogDescription>
                  Something went wrong — sorry about that. You can always email us directly at{" "}
                  <a
                    href="mailto:pennyteacherapp@gmail.com"
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    pennyteacherapp@gmail.com
                  </a>
                  .
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setStage("form")}>
                  Try again
                </Button>
                <Button onClick={() => setOpen(false)}>Close</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
