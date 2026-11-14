import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { PennyWordmark } from "@/components/penny/Logo";
import { LegalFooter } from "@/components/penny/LegalFooter";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useSubscription } from "@/hooks/use-subscription";
import { STANDARD_PLAN_PRICE } from "@/lib/plans";

export const Route = createFileRoute("/pricing")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Pricing — Penny" },
      { name: "description", content: "One simple price for Penny — voice mark capture, AI report comments, and parent messages. R29/month, 3-day free trial, no card required." },
      { property: "og:title", content: "Pricing — Penny" },
      { property: "og:description", content: "R29/month, everything included. 3-day free trial, no card required." },
      { property: "og:url", content: "https://app.pennyteacher.co.za/pricing" },
    ],
    links: [{ rel: "canonical", href: "https://app.pennyteacher.co.za/pricing" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Product",
          name: "Penny",
          description: "AI teaching assistant for capturing marks by voice, writing report comments, and drafting parent messages.",
          brand: { "@type": "Brand", name: "Penny" },
          offers: {
            "@type": "Offer",
            name: "Penny",
            price: String(STANDARD_PLAN_PRICE),
            priceCurrency: "ZAR",
            url: "https://app.pennyteacher.co.za/pricing",
          },
        }),
      },
    ],
  }),
  component: PricingPage,
});

const FEATURES = [
  "Unlimited classes",
  "Voice mark capture",
  "Term structure",
  "AI report comments",
  "AI parent messages",
  "Excel & CSV exports",
];

function PricingPage() {
  const navigate = useNavigate();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const sub = useSubscription();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setSignedIn(!!data.user));
  }, []);

  function handleSelect() {
    if (!signedIn) {
      navigate({ to: "/auth" });
      return;
    }
    if (sub.status === "active" && sub.plan === "standard") {
      navigate({ to: "/billing" });
      return;
    }
    navigate({ to: "/choose-plan" });
  }

  const isCurrentPaidPlan = !!signedIn && sub.status === "active" && sub.plan === "standard";

  return (
    <div className="min-h-screen mx-auto max-w-md px-5 pb-16 pt-8 flex flex-col">
      <header className="mb-10">
        <Link to="/" className="inline-flex items-center">
          <PennyWordmark />
        </Link>
      </header>

      <main className="flex-1">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary mb-4">
            <Sparkles className="h-3.5 w-3.5" /> Simple pricing
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">
            One price, everything included
          </h1>
          <p className="mt-3 text-base text-muted-foreground">
            3-day free trial, no card required.
          </p>
        </div>

        <div className="rounded-3xl bg-card p-6 shadow-soft flex flex-col">
          <h2 className="font-display text-xl font-semibold">Penny</h2>
          <p className="text-sm text-muted-foreground mt-1">For teachers who want it all, simply.</p>
          <div className="mt-4 mb-1">
            <span className="font-display text-4xl font-semibold tracking-tight">R{STANDARD_PLAN_PRICE}</span>
            <span className="text-sm text-muted-foreground ml-1">/ month</span>
          </div>
          <ul className="space-y-2.5 my-6">
            {FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-2 text-sm">
                <Check className="h-4 w-4 text-primary mt-0.5 flex-none" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <Button
            onClick={handleSelect}
            disabled={isCurrentPaidPlan}
            className="w-full h-12 rounded-xl text-base"
          >
            {isCurrentPaidPlan ? "Current plan" : signedIn ? "Choose plan" : "Get started"}
          </Button>
        </div>

        <div className="mt-10 rounded-2xl bg-card p-6 shadow-soft">
          <h2 className="font-display text-lg font-semibold mb-2">Questions?</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            All plans include South African hosting, encryption in transit and at rest, and the ability to delete your data at any time. Read our{" "}
            <Link to="/terms" className="text-primary hover:underline">Terms of Service</Link>{" "}
            for billing details.
          </p>
        </div>
      </main>

      <LegalFooter />
    </div>
  );
}
