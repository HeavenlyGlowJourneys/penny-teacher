// Subscription state hook. The /_authenticated route guard is the actual
// access gate — this hook drives in-app feature gating and the trial
// banner. One plan, one price — every account either has full write access
// or is in the read-only trial-expired grace state (enforced for real at
// the RLS layer via has_write_access(), not just here client-side).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PLAN_LABELS, type Plan } from "@/lib/plans";

export type { Plan };
export { PLAN_LABELS };

export type Status = "active" | "expired" | "cancelled";

export interface SubscriptionState {
  plan: Plan | null;
  status: Status | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  dataDeletionScheduledAt: string | null;
  firstPaymentCompleted: boolean;
  isActive: boolean;
  isExpired: boolean;
  isCancelled: boolean;
  /** True while the subscription is cancelled but the paid period hasn't ended. */
  hasGraceAccess: boolean;
  /** True while on the trial plan and trial_ends_at hasn't passed yet. */
  isTrialing: boolean;
  /** True once the trial plan's window has passed with no payment made. */
  isTrialExpired: boolean;
  trialDaysLeft: number | null;
  /** Any access to the app at all — full or read-only. */
  hasAnyAccess: boolean;
  /** Full read/write access — false during the trial-expired grace period. */
  canWrite: boolean;
  classCount: number;
  canAddClass: boolean;
  canUseVoiceCapture: boolean;
  canUseTermStructure: boolean;
  canUseAIFeatures: boolean;
  canExportExcel: boolean;
  isLoading: boolean;
}

export function useSubscription(): SubscriptionState {
  const { data: sub, isLoading: subLoading } = useQuery({
    queryKey: ["subscription"],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return null;
      const { data, error } = await supabase
        .from("subscriptions")
        .select(
          "plan, status, current_period_start, current_period_end, trial_ends_at, data_deletion_scheduled_at, first_payment_completed",
        )
        .eq("teacher_id", uid)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });

  const { data: classCountData, isLoading: countLoading } = useQuery({
    queryKey: ["classes-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("classes")
        .select("id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 10_000,
  });

  const plan = (sub?.plan ?? null) as Plan | null;
  const status = (sub?.status ?? null) as Status | null;
  const currentPeriodEnd = sub?.current_period_end ?? null;
  const trialEndsAt = sub?.trial_ends_at ?? null;
  const dataDeletionScheduledAt = sub?.data_deletion_scheduled_at ?? null;
  const firstPaymentCompleted = !!sub?.first_payment_completed;

  const isActive = status === "active";
  const isExpired = status === "expired";
  const isCancelled = status === "cancelled";
  const periodEndMs = currentPeriodEnd ? new Date(currentPeriodEnd).getTime() : 0;
  const hasGraceAccess = isCancelled && periodEndMs > Date.now();

  const trialEndsAtMs = trialEndsAt ? new Date(trialEndsAt).getTime() : 0;
  const isTrialPlan = plan === "trial";
  const isTrialing = isActive && isTrialPlan && trialEndsAtMs > Date.now();
  const isTrialExpired = isActive && isTrialPlan && trialEndsAtMs > 0 && trialEndsAtMs <= Date.now();
  const trialDaysLeft = isTrialing
    ? Math.max(0, Math.ceil((trialEndsAtMs - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  const hasAnyAccess = isActive || hasGraceAccess;
  const canWrite = hasAnyAccess && !isTrialExpired;

  const classCount = classCountData ?? 0;

  return {
    plan,
    status,
    currentPeriodEnd,
    trialEndsAt,
    dataDeletionScheduledAt,
    firstPaymentCompleted,
    isActive,
    isExpired,
    isCancelled,
    hasGraceAccess,
    isTrialing,
    isTrialExpired,
    trialDaysLeft,
    hasAnyAccess,
    canWrite,
    classCount,
    canAddClass: canWrite,
    canUseVoiceCapture: canWrite,
    canUseTermStructure: canWrite,
    canUseAIFeatures: canWrite,
    // View/search/export are never gated — only creating or editing is.
    canExportExcel: hasAnyAccess,
    isLoading: subLoading || countLoading,
  };
}
