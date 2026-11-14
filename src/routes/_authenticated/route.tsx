import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { FeedbackButton } from "@/components/penny/FeedbackButton";
import { TrialBanner } from "@/components/penny/TrialBanner";
import { ensureOnboardingEmails } from "@/lib/onboarding-email.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });

    const { data: sub } = await supabase
      .from("subscriptions")
      .select("status, current_period_end")
      .eq("teacher_id", data.user.id)
      .maybeSingle();

    const periodEndMs = sub?.current_period_end ? new Date(sub.current_period_end).getTime() : 0;
    const hasGraceAccess = sub?.status === "cancelled" && periodEndMs > Date.now();
    const hasAccess = sub?.status === "active" || hasGraceAccess;
    if (!hasAccess) throw redirect({ to: "/choose-plan" });

    return { user: data.user };
  },
  component: AuthenticatedShell,
});

function AuthenticatedShell() {
  const sendOnboarding = useServerFn(ensureOnboardingEmails);

  useEffect(() => {
    // Fire-and-forget: welcome + trial emails once (idempotent server-side).
    void sendOnboarding({}).catch((err) => {
      console.warn("[onboarding-email]", err);
    });
  }, [sendOnboarding]);

  return (
    <>
      <TrialBanner />
      <Outlet />
      <FeedbackButton />
    </>
  );
}
