import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useSubscription } from "@/hooks/use-subscription";

/** Shared write-access guard for mutation entry points after trial expiry. */
export function useRequireWriteAccess() {
  const sub = useSubscription();
  const navigate = useNavigate();

  function requireWrite(actionLabel = "make changes"): boolean {
    if (sub.isLoading) return false;
    if (sub.canWrite) return true;
    toast.error(
      sub.isTrialExpired
        ? `Your trial has ended — add a payment method to ${actionLabel}.`
        : `Add a payment method to ${actionLabel}.`,
    );
    void navigate({ to: "/choose-plan" });
    return false;
  }

  return {
    ...sub,
    requireWrite,
  };
}
