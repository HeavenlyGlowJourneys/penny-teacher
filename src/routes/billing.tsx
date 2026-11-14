import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { CreditCard, Receipt, ShieldCheck, AlertCircle, Clock } from "lucide-react";
import { PennyWordmark } from "@/components/penny/Logo";
import { LegalFooter } from "@/components/penny/LegalFooter";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useSubscription, PLAN_LABELS } from "@/hooks/use-subscription";
import { STANDARD_PLAN_PRICE } from "@/lib/plans";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { scheduleCancellation } from "@/lib/subscription.functions";

export const Route = createFileRoute("/billing")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Billing — Penny" },
      { name: "description", content: "Manage your Penny subscription and billing details." },
      { property: "og:title", content: "Billing — Penny" },
      { property: "og:description", content: "Subscription and billing information for your Penny account." },
    ],
  }),
  component: BillingPage,
});

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  expired: "Expired",
  cancelled: "Cancelled",
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return iso;
  }
}

function BillingPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const sub = useSubscription();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [popiaOpen, setPopiaOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const cancelFn = useServerFn(scheduleCancellation);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) navigate({ to: "/auth" });
      else setSignedIn(true);
    });
  }, [navigate]);

  if (!signedIn || sub.isLoading) {
    return (
      <div className="min-h-screen mx-auto max-w-2xl px-5 pb-16 pt-8">
        <header className="mb-10"><PennyWordmark /></header>
        <p className="text-sm text-muted-foreground">Loading your billing…</p>
      </div>
    );
  }

  const plan = sub.plan;
  const planLabel = plan ? PLAN_LABELS[plan] : "—";
  const statusLabel = sub.status ? STATUS_LABEL[sub.status] : "—";
  const isPaid = plan === "standard" && sub.status === "active";
  const isCancelledWithGrace = sub.isCancelled && sub.hasGraceAccess;

  async function handleConfirmCancel() {
    setSubmitting(true);
    try {
      const res = await cancelFn({});
      toast.success(
        `Cancellation scheduled. Your data will be removed on ${formatDate(res.dataDeletionScheduledAt)}.`,
      );
      setPopiaOpen(false);
      qc.invalidateQueries({ queryKey: ["subscription"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen mx-auto max-w-2xl px-5 pb-16 pt-8 flex flex-col">
      <header className="mb-10">
        <Link to="/" className="inline-flex items-center">
          <PennyWordmark />
        </Link>
      </header>

      <main className="flex-1">
        <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-warm">
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mb-2">
            Billing
          </h1>
          <p className="text-sm text-muted-foreground mb-8">
            Manage your subscription and payment method.
          </p>

          <div className="space-y-6">
            <BillingSection icon={<CreditCard className="h-5 w-5" />} title="Current plan">
              <p className="text-sm leading-relaxed">
                <span className="font-medium text-foreground">{planLabel}</span>
                <span className="text-muted-foreground"> · {statusLabel}</span>
              </p>
              {isPaid && sub.currentPeriodEnd && (
                <p className="text-sm text-muted-foreground mt-1">
                  Current period ends <span className="font-medium text-foreground">{formatDate(sub.currentPeriodEnd)}</span>.
                </p>
              )}
              {sub.isTrialing && sub.trialEndsAt && (
                <p className="mt-2 inline-flex items-start gap-1.5 text-sm text-foreground">
                  <Clock className="h-4 w-4 mt-0.5 text-primary" />
                  Your free trial ends {formatDate(sub.trialEndsAt)} — no card needed until then.
                </p>
              )}
              {sub.isTrialExpired && (
                <p className="mt-2 inline-flex items-start gap-1.5 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 mt-0.5" />
                  Your trial has ended. Add a payment method to keep adding and editing.
                </p>
              )}
              {isCancelledWithGrace && sub.dataDeletionScheduledAt && (
                <p className="mt-2 inline-flex items-start gap-1.5 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 mt-0.5" />
                  Cancellation scheduled — learner data is marked for removal on {formatDate(sub.dataDeletionScheduledAt)}. Contact support if you need this done sooner.
                </p>
              )}
              {sub.isExpired && (
                <p className="mt-2 inline-flex items-start gap-1.5 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 mt-0.5" />
                  Your subscription has expired. Add a payment method to keep using Penny.
                </p>
              )}
            </BillingSection>

            <BillingSection icon={<Receipt className="h-5 w-5" />} title="Next billing">
              {isPaid ? (
                <p className="text-sm leading-relaxed">
                  Next charge: <span className="font-medium text-foreground">R{STANDARD_PLAN_PRICE.toFixed(2)}</span>
                  {sub.currentPeriodEnd ? <> on {formatDate(sub.currentPeriodEnd)}</> : null}.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  No upcoming charges.
                </p>
              )}
            </BillingSection>

            <BillingSection icon={<ShieldCheck className="h-5 w-5" />} title="Payment security">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Penny uses PayFast for PCI-compliant payment processing. We never store your full card details on our servers. Billing is in South African Rand (ZAR).
              </p>
            </BillingSection>
          </div>

          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            {!isPaid ? (
              <Button asChild className="h-12 rounded-xl text-base">
                <Link to="/choose-plan">Add payment method</Link>
              </Button>
            ) : (
              !sub.isCancelled && (
                <Button
                  variant="ghost"
                  className="h-12 rounded-xl text-base text-destructive hover:text-destructive"
                  onClick={() => setPopiaOpen(true)}
                >
                  Cancel subscription
                </Button>
              )
            )}
          </div>
        </div>
      </main>

      <LegalFooter />

      {/* POPIA cancellation warning */}
      <Dialog open={popiaOpen} onOpenChange={(o) => !submitting && setPopiaOpen(o)}>
        <DialogContent className="rounded-3xl max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Before you go</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed pt-2 space-y-3">
              <p>
                Under POPIA, Penny should not keep learner records longer than needed once your subscription ends.
              </p>
              <p>
                Your data will be marked for removal 30 days after cancellation. A scheduled purge removes learner records after that window — contact support if you need help sooner.
              </p>
              <p>
                You keep access until the end of your paid period. You are always welcome back — start a new subscription anytime.
              </p>
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 mt-2">
            <Button onClick={() => setPopiaOpen(false)} disabled={submitting} className="h-11 rounded-xl">
              Keep my subscription
            </Button>
            <Button
              onClick={handleConfirmCancel}
              disabled={submitting}
              variant="destructive"
              className="h-11 rounded-xl"
            >
              {submitting ? "Cancelling…" : "I understand — cancel anyway"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BillingSection({
  icon, title, children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex gap-4">
      <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary-soft text-primary">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="font-display text-lg font-semibold mb-1">{title}</h2>
        {children}
      </div>
    </section>
  );
}
