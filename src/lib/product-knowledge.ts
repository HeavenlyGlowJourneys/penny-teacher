/**
 * Shared product knowledge — single source of truth for website, emails, and
 * any future in-app help. Prefer importing from here over duplicating copy.
 */
import { STANDARD_PLAN_PRICE } from "@/lib/plans";

export const PRODUCT = {
  name: "Penny",
  legalName: "Penny Teacher",
  tagline: "Your AI teaching assistant",
  appUrl: "https://app.pennyteacher.co.za",
  siteUrl: "https://pennyteacher.co.za",
  supportEmail: "support@notify.pennyteacher.co.za",
  notifyEmail: "pennyteacherapp@gmail.com",
  priceZar: STANDARD_PLAN_PRICE,
  priceLabel: `R${STANDARD_PLAN_PRICE}`,
  billingFrequency: "month",
  trialDays: 3,
  planName: "Penny",
  currency: "ZAR",
} as const;

export const PRODUCT_FEATURES = [
  "Voice mark capture",
  "AI report comments",
  "Parent messages",
  "Unlimited classes",
  "Excel / CSV export",
  "POPIA-conscious design",
] as const;

export const FAQ_ITEMS: Array<{ q: string; a: string }> = [
  {
    q: "How much does Penny cost?",
    a: `Penny is ${PRODUCT.priceLabel} per month for the full product. There is one simple plan — everything is included.`,
  },
  {
    q: "Is there a free trial?",
    a: `Yes. Every new teacher gets a ${PRODUCT.trialDays}-day free trial with full access. No credit card is required to start.`,
  },
  {
    q: "What can Penny do?",
    a: "Penny helps South African teachers capture marks by voice, generate report comments and parent messages with AI, manage classes and assessments, and export results to Excel or CSV.",
  },
  {
    q: "Do I need a credit card for the trial?",
    a: "No. You can start your trial without a payment method. Add a card only when you are ready to continue after the trial.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel from Billing with one tap. You keep access until the end of your paid period. After that, learner data is marked for removal under POPIA and purged by a scheduled job — contact support if you need help sooner.",
  },
  {
    q: "How do I get support?",
    a: `Reply to any Penny email, or write to ${PRODUCT.supportEmail}. You can also send feedback from inside the app.`,
  },
  {
    q: "Where is my data stored and who can see it?",
    a: "Your classes and learners belong to your account only. Other teachers and schools cannot access your records. See the Privacy Policy for POPIA details.",
  },
];

export function formatTrialCopy(): string {
  return `${PRODUCT.trialDays}-day free trial`;
}

export function formatPriceCopy(): string {
  return `${PRODUCT.priceLabel}/${PRODUCT.billingFrequency}`;
}
