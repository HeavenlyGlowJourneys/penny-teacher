import { createFileRoute, Link } from "@tanstack/react-router";
import { PennyWordmark } from "@/components/penny/Logo";
import { LegalFooter } from "@/components/penny/LegalFooter";
import { FAQ_ITEMS, PRODUCT, formatPriceCopy, formatTrialCopy } from "@/lib/product-knowledge";

export const Route = createFileRoute("/faq")({
  head: () => ({
    meta: [
      { title: "Help & FAQ — Penny" },
      {
        name: "description",
        content: `Answers about Penny pricing (${formatPriceCopy()}), ${formatTrialCopy()}, features, and support.`,
      },
    ],
    links: [{ rel: "canonical", href: "https://app.pennyteacher.co.za/faq" }],
  }),
  component: FaqPage,
});

function FaqPage() {
  return (
    <div className="min-h-screen mx-auto max-w-2xl px-5 pb-16 pt-8 flex flex-col">
      <header className="mb-10">
        <Link to="/" className="inline-flex items-center">
          <PennyWordmark />
        </Link>
      </header>

      <main className="flex-1">
        <div className="rounded-3xl bg-card p-6 sm:p-8 shadow-soft">
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mb-2">
            Help &amp; FAQ
          </h1>
          <p className="text-sm text-muted-foreground mb-8">
            {PRODUCT.tagline}. {formatTrialCopy()}, then {formatPriceCopy()}.
          </p>

          <div className="space-y-6">
            {FAQ_ITEMS.map((item) => (
              <section key={item.q}>
                <h2 className="font-display text-lg font-semibold text-foreground">{item.q}</h2>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{item.a}</p>
              </section>
            ))}
          </div>

          <p className="mt-10 text-sm text-muted-foreground">
            Still stuck? Email{" "}
            <a className="text-primary hover:underline" href={`mailto:${PRODUCT.supportEmail}`}>
              {PRODUCT.supportEmail}
            </a>{" "}
            or use Feedback inside the app.
          </p>
        </div>
      </main>

      <LegalFooter />
    </div>
  );
}
