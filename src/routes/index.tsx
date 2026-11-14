import { createFileRoute, Link } from "@tanstack/react-router";
import { Mic, Sparkles, FileSpreadsheet, ShieldCheck, MessageSquare } from "lucide-react";
import { PennyWordmark } from "@/components/penny/Logo";
import { LegalFooter } from "@/components/penny/LegalFooter";
import { Button } from "@/components/ui/button";
import { formatPriceCopy, formatTrialCopy, PRODUCT } from "@/lib/product-knowledge";

const SITE_URL = PRODUCT.appUrl;
const OG_IMAGE = `${SITE_URL}/penny-logo.png?v=3`;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Penny – Built by a teacher" },
      { name: "description", content: "Voice-driven mark capture, AI report comments, and parent messages for teachers." },
      { property: "og:title", content: "Penny – Built by a teacher" },
      { property: "og:description", content: "Voice-driven mark capture, AI report comments, and parent messages for teachers." },
      { property: "og:url", content: SITE_URL },
      { property: "og:image", content: OG_IMAGE },
      { name: "twitter:image", content: OG_IMAGE },
    ],
    links: [{ rel: "canonical", href: SITE_URL }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "Penny",
          url: SITE_URL,
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "Penny",
          applicationCategory: "EducationalApplication",
          operatingSystem: "Web",
          description: "Voice-driven mark capture, AI report comments, and parent messages for teachers.",
          offers: {
            "@type": "Offer",
            price: String(PRODUCT.priceZar),
            priceCurrency: PRODUCT.currency,
          },
        }),
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen mx-auto max-w-md px-5 pb-16 pt-8 flex flex-col">
      <header className="flex items-center justify-between mb-12">
        <PennyWordmark />
        <Link to="/auth" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
          Sign in
        </Link>
      </header>

      <section className="flex-1 flex flex-col">
        <div className="inline-flex self-start items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary mb-6">
          <Sparkles className="h-3.5 w-3.5" /> Made for teachers
        </div>
        <h1 className="font-display text-[2.5rem] leading-[1.08] font-semibold tracking-tight">
          Built by a teacher.
          <br />
          <em className="text-primary italic">Designed to give teachers their time back.</em>
        </h1>
        <p className="mt-3 text-lg text-muted-foreground leading-relaxed">
          Capture marks faster than Excel.
        </p>
        <p className="mt-5 text-base text-muted-foreground leading-relaxed">
          Penny captures your marks by voice, organises your assessments by term, and writes your report comments for you.{" "}
          <em className="text-primary italic">Because marks don't capture themselves.</em>
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <Button asChild size="lg" className="h-14 text-base rounded-2xl shadow-warm">
            <Link to="/auth">Get started &rarr;</Link>
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {formatPriceCopy()} · {formatTrialCopy()}, no card required
          </p>
          <p className="text-center text-[10px] text-muted-foreground/80 leading-relaxed">
            🎙️ Voice capture works best on Chrome on Android or desktop.
          </p>
        </div>

        <h2 className="mt-12 mb-3 font-display text-xl font-semibold tracking-tight">What Penny does for you</h2>
        <div className="grid gap-3">
          <Feature icon={<Mic className="h-5 w-5" />} title="Voice mark capture" body='Say "Anna 15, John 18, Sarah absent." Penny captures the marks into your class.' />
          <Feature icon={<Sparkles className="h-5 w-5" />} title="AI Report Comments" body="Penny drafts a personalised report comment for every learner — in South African report format, UK spelling, and your own style." />
          <Feature icon={<MessageSquare className="h-5 w-5" />} title="Parent Messages" body="Generate a WhatsApp-ready message for every parent after each assessment. The right tone, every time." />
          <Feature icon={<FileSpreadsheet className="h-5 w-5" />} title="Excel-ready results" body="Export every assessment as a clean .xlsx in one tap — ready for your school's system." />
          <Feature icon={<ShieldCheck className="h-5 w-5" />} title="POPIA-minded" body="Your learners' data is private, encrypted, and yours to delete." />
        </div>
      </section>

      <LegalFooter />
    </div>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex gap-3 rounded-2xl bg-card p-4 shadow-soft">
      <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary-soft text-primary">
        {icon}
      </div>
      <div>
        <h3 className="font-display text-base font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground leading-snug">{body}</p>
      </div>
    </div>
  );
}
