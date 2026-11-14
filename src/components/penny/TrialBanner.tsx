// Persistent top banner for the trial period and the read-only grace
// period after it ends — mirrors the ReadOnlyBanner pattern from the
// sibling HGJ Business app. Renders nothing outside those two states.
import { Link } from "@tanstack/react-router";
import { AlertCircle, Clock } from "lucide-react";
import { useSubscription } from "@/hooks/use-subscription";

export function TrialBanner() {
  const sub = useSubscription();

  if (sub.isLoading) return null;

  if (sub.isTrialExpired) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        <span className="inline-flex items-center gap-2">
          <AlertCircle className="h-4 w-4 flex-none" />
          Your free trial has ended — you can still view your data, but adding or editing is paused.
        </span>
        <Link
          to="/choose-plan"
          className="shrink-0 rounded-full bg-destructive px-3 py-1.5 text-xs font-bold text-destructive-foreground"
        >
          Add payment method
        </Link>
      </div>
    );
  }

  if (sub.isTrialing && sub.trialDaysLeft !== null) {
    const dayLabel = sub.trialDaysLeft === 1 ? "1 day" : `${sub.trialDaysLeft} days`;
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 bg-primary-soft px-4 py-3 text-sm text-foreground">
        <span className="inline-flex items-center gap-2">
          <Clock className="h-4 w-4 flex-none text-primary" />
          Your free trial ends in {dayLabel} — no card needed until then.
        </span>
        <Link
          to="/choose-plan"
          className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground"
        >
          Add payment
        </Link>
      </div>
    );
  }

  return null;
}
