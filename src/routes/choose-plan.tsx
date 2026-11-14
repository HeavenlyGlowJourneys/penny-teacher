// Post-signup plan selection. A teacher without an active paid subscription
// lands here — from a link in the TrialBanner during/after their 3-day
// trial, or (rarely, e.g. an expired-payment renewal) sent here by the
// _authenticated route guard — and stays here until they complete a
// PayFast checkout that the webhook activates.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Lock, AlertCircle, LogOut } from "lucide-react";
import { PennyWordmark } from "@/components/penny/Logo";
import { LegalFooter } from "@/components/penny/LegalFooter";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { STANDARD_PLAN_PRICE } from "@/lib/plans";
import { createPayfastCheckout } from "@/lib/payfast.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/choose-plan")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    cancelled: search.cancelled === true || search.cancelled === "true" ? true : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Add a payment method — Penny" },
      { name: "description", content: "Keep using Penny for R29/month." },
    ],
  }),
  component: ChoosePlanPage,
});

function ChoosePlanPage() {
  const navigate = useNavigate();
  const { cancelled } = Route.useSearch();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const checkout = useServerFn(createPayfastCheckout);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) navigate({ to: "/auth", replace: true });
      else setSignedIn(true);
    });
  }, [navigate]);

  useEffect(() => {
    if (!cancelled) return;
    toast.message("Payment cancelled — no charge was made. You can try again whenever you're ready.");
    void navigate({ to: "/choose-plan", search: {}, replace: true });
  }, [cancelled, navigate]);

  if (!signedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  async function handleConfirm() {
    setSubmitting(true);
    try {
      const res = await checkout({});
      // Build a self-posting form and redirect into PayFast.
      const form = document.createElement("form");
      form.method = "POST";
      form.action = res.url;
      form.style.display = "none";
      for (const [k, v] of Object.entries(res.fields)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = k;
        input.value = String(v);
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start checkout. Please try again.");
      setSubmitting(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen mx-auto max-w-md px-5 pb-16 pt-8 flex flex-col">
      <header className="mb-6 flex items-center justify-between">
        <PennyWordmark />
        <button
          onClick={signOut}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </header>

      <main className="flex-1">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary mb-3">
            <Sparkles className="h-3.5 w-3.5" /> One simple plan
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">
            Everything Penny does, one price
          </h1>
          <p className="mt-3 text-sm text-muted-foreground max-w-sm mx-auto">
            Voice mark capture, AI report comments, parent messages, and unlimited classes — all included.
          </p>
        </div>

        <div className="rounded-3xl bg-card p-6 shadow-soft flex flex-col">
          <h2 className="font-display text-xl font-semibold">Penny</h2>
          <div className="mt-4 flex items-baseline gap-1.5">
            <span className="font-display text-4xl font-semibold">R{STANDARD_PLAN_PRICE}</span>
            <span className="text-sm text-muted-foreground">/ month</span>
          </div>
          <Button
            onClick={() => setConfirmOpen(true)}
            className="w-full h-12 rounded-xl text-base mt-6"
          >
            Add payment method
          </Button>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Cancel with one tap — no penalties. Your data stays safe.
        </p>

        <div className="mt-8 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5" />
          Secure payment via PayFast · Cancel any time
        </div>
      </main>

      <LegalFooter />

      <Dialog
        open={confirmOpen}
        onOpenChange={(o) => {
          if (!o && !submitting) setConfirmOpen(false);
        }}
      >
        <DialogContent className="rounded-3xl max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-warning-foreground" />
              You are about to make a real payment
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed pt-2">
              This will charge{" "}
              <span className="font-semibold text-foreground">R{STANDARD_PLAN_PRICE.toFixed(2)}</span> to your card via PayFast for Penny, then every month after. Continue?
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 mt-2">
            <Button onClick={handleConfirm} disabled={submitting} className="h-11 rounded-xl">
              {submitting ? "Redirecting to PayFast…" : "Yes, proceed to payment"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={submitting}
              className="h-10 rounded-xl"
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
