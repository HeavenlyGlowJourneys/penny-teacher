import { createFileRoute, Link } from "@tanstack/react-router";
import { PennyWordmark } from "@/components/penny/Logo";
import { LegalFooter } from "@/components/penny/LegalFooter";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — Penny" },
      { name: "description", content: "The terms governing your use of Penny — the AI teaching assistant for South African classrooms." },
      { property: "og:title", content: "Terms of Service — Penny" },
      { property: "og:description", content: "The terms governing your use of Penny." },
      { property: "og:type", content: "article" },
      { property: "og:url", content: "https://app.pennyteacher.co.za/terms" },
    ],
    links: [{ rel: "canonical", href: "https://app.pennyteacher.co.za/terms" }],
  }),
  component: TermsPage,
});

function TermsPage() {
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
            Terms of Service
          </h1>
          <p className="text-sm text-muted-foreground mb-8">
            Last updated: {new Date().toLocaleDateString("en-ZA", { year: "numeric", month: "long", day: "numeric" })}
          </p>

          <div className="prose prose-sm max-w-none text-foreground">
            <TermsSection title="1. Acceptance of terms">
              By accessing or using Penny (the "Service"), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the Service. These terms apply to all teachers, schools, and other users.
            </TermsSection>

            <TermsSection title="2. Description of service">
              Penny is a voice-enabled teaching assistant that helps educators capture, manage, and export learner assessment marks. Features may include class management, voice capture, mark tracking, export to spreadsheet formats, and learner pronunciation training.
            </TermsSection>

            <TermsSection title="3. Eligibility and accounts">
              You must be authorised to act on behalf of a school or educational institution, or be an individual educator with the right to process learner data. You are responsible for maintaining the confidentiality of your account credentials and for all activity that occurs under your account.
            </TermsSection>

            <TermsSection title="4. Acceptable use">
              You agree to use the Service only for lawful educational purposes. You must not:
              <ul className="list-disc pl-5 space-y-1.5 mt-2">
                <li>Use the Service to process data you are not authorised to handle.</li>
                <li>Attempt to access, disrupt, or interfere with the Service or its infrastructure.</li>
                <li>Reverse-engineer, copy, or resell the Service without permission.</li>
                <li>Use the Service in a way that violates the rights of learners, parents, or other users.</li>
              </ul>
            </TermsSection>

            <TermsSection title="5. Data and content">
              You retain ownership of the data you enter into Penny. By using the Service, you grant us a limited licence to process that data solely to provide and improve the Service. You are responsible for ensuring that you have appropriate rights and consents to process learner data.
            </TermsSection>

            <TermsSection title="6. Accuracy of voice capture">
              Penny uses speech recognition to convert voice input into marks. While we continually improve accuracy, we do not guarantee that every capture will be perfect. You should review results before finalising them and use your professional judgement when recording assessment marks.
            </TermsSection>

            <TermsSection title="7. Service availability">
              We aim to keep the Service available at all times, but we do not guarantee uninterrupted access. We may suspend or terminate access for maintenance, security reasons, or violations of these terms.
            </TermsSection>

            <TermsSection title="8. Subscription and billing">
              Where paid plans are offered, fees and billing terms will be presented at the time of purchase. All fees are non-refundable except where required by law or as explicitly stated in a specific plan's terms.
            </TermsSection>

            <TermsSection title="9. Limitation of liability">
              To the fullest extent permitted by law, Penny and its operators are not liable for any indirect, incidental, or consequential damages arising from your use of the Service. Our total liability is limited to the amount you paid for the Service in the twelve months preceding the claim, or one hundred South African Rand if you were on a free trial.
            </TermsSection>

            <TermsSection title="10. Termination">
              You may stop using the Service at any time. We may suspend or terminate your account if you violate these terms or if required by law. Upon termination, your right to use the Service ceases immediately.
            </TermsSection>

            <TermsSection title="11. Changes to terms">
              We may update these Terms of Service from time to time. We will notify you of material changes through the app or by email. Your continued use of the Service after changes become effective constitutes acceptance of the revised terms.
            </TermsSection>

            <TermsSection title="12. Governing law">
              These terms are governed by the laws of the Republic of South Africa. Any dispute arising from these terms or the Service will be resolved in the courts of South Africa.
            </TermsSection>

            <TermsSection title="13. Contact us">
              If you have questions about these Terms of Service, please contact us through the application or by email at the address listed in your account settings.
            </TermsSection>
          </div>
        </div>
      </main>

      <LegalFooter />
    </div>
  );
}

function TermsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="font-display text-lg font-semibold mb-2">{title}</h2>
      <div className="text-sm text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}
