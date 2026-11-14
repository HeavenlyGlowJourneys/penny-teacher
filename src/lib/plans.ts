// Plan catalogue and pricing — single source of truth used by the
// /choose-plan UI, billing page, PayFast checkout, and webhook amount
// verification. One plan, one price: R29/month, no annual option.

export type Plan = "trial" | "standard";

export const STANDARD_PLAN_PRICE = 29;

export const PLAN_LABELS: Record<Plan, string> = {
  trial: "Free trial",
  standard: "Penny",
};
