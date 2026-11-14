// Landing page after PayFast redirects the teacher back to the app.
// Polls the subscriptions row for up to 15 seconds because the webhook
// may activate the subscription a beat after the redirect arrives.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { PennyWordmark } from "@/components/penny/Logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { PLAN_LABELS, type Plan } from "@/lib/plans";

export const Route = createFileRoute("/payment-success")({
  ssr: false,
  head: () => ({ meta: [{ title: "Welcome to Penny" }] }),
  component: PaymentSuccessPage,
});

function PaymentSuccessPage() {
  const navigate = useNavigate();
  const [activated, setActivated] = useState<{ plan: Plan } | null>(null);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const start = Date.now();
    let polls = 0;

    async function tick() {
      if (cancelled) return;
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        navigate({ to: "/auth", replace: true });
        return;
      }
      const { data } = await supabase
        .from("subscriptions")
        .select("plan, status, first_payment_completed")
        .eq("teacher_id", u.user.id)
        .maybeSingle();
      if (cancelled) return;
      // Trial rows are also status=active — only treat paid activation as success.
      const paid =
        data?.status === "active" &&
        data?.plan === "standard" &&
        !!data?.first_payment_completed;
      if (paid) {
        setActivated({ plan: data.plan as Plan });
        return;
      }
      polls += 1;
      if (polls >= 2) setSlow(true);
      if (Date.now() - start >= 15_000) {
        navigate({ to: "/dashboard", replace: true });
        return;
      }
      setTimeout(tick, 2000);
    }
    tick();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="min-h-screen mx-auto max-w-md px-5 pt-12 pb-10 flex flex-col items-center text-center">
      <PennyWordmark />
      <div className="mt-12 rounded-3xl bg-card p-8 shadow-warm w-full">
        {activated ? (
          <>
            <CheckCircle2 className="h-14 w-14 text-primary mx-auto" />
            <h1 className="font-display text-3xl font-semibold mt-4">You're in! 🎉</h1>
            <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
              Welcome to {PLAN_LABELS[activated.plan]}. Your account is ready — let's give you your time back.
            </p>
            <Button asChild className="w-full h-12 rounded-xl text-base mt-6">
              <Link to="/dashboard">Go to my dashboard</Link>
            </Button>
          </>
        ) : (
          <>
            <div className="mx-auto h-14 w-14 rounded-full border-4 border-primary border-t-transparent animate-spin" />
            <h1 className="font-display text-2xl font-semibold mt-4">
              {slow ? "Just setting up your account" : "Confirming your payment"}
            </h1>
            <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
              This will only take a moment — we're confirming with PayFast.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
