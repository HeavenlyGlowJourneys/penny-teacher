import { createFileRoute, Link } from "@tanstack/react-router";
import { PennyWordmark } from "@/components/penny/Logo";
import { LegalFooter } from "@/components/penny/LegalFooter";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Penny" },
      { name: "description", content: "How Penny collects, uses, and protects learner and teacher data — POPIA-minded and built for South African classrooms." },
      { property: "og:title", content: "Privacy Policy — Penny" },
      { property: "og:description", content: "How Penny collects, uses, and protects learner and teacher data." },
      { property: "og:type", content: "article" },
      { property: "og:url", content: "https://app.pennyteacher.co.za/privacy" },
    ],
    links: [{ rel: "canonical", href: "https://app.pennyteacher.co.za/privacy" }],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
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
            Privacy Policy
          </h1>
          <p className="text-sm text-muted-foreground mb-8">
            Last updated: {new Date().toLocaleDateString("en-ZA", { year: "numeric", month: "long", day: "numeric" })}
          </p>

          <div className="prose prose-sm max-w-none text-foreground">
            <PolicySection title="1. Introduction">
              Penny ("we", "us", or "our") is an AI teaching assistant that helps educators capture assessment marks and manage learner results. This Privacy Policy explains how we collect, use, store, and protect your information when you use our application.
            </PolicySection>

            <PolicySection title="2. Information we collect">
              <ul className="list-disc pl-5 space-y-1.5">
                <li><strong>Account information:</strong> Your name, email address, school affiliation, and authentication details.</li>
                <li><strong>Learner data:</strong> Learner names, pronunciation recordings, class rosters, assessment marks, and attendance information you upload or capture.</li>
                <li><strong>Voice data:</strong> Audio transcripts generated when you use voice capture. We do not store raw audio unless you explicitly record learner pronunciations.</li>
                <li><strong>Usage data:</strong> App interactions, error logs, and performance metrics to help us improve the service.</li>
              </ul>
            </PolicySection>

            <PolicySection title="3. How we use your information">
              We use the information we collect to:
              <ul className="list-disc pl-5 space-y-1.5 mt-2">
                <li>Provide, maintain, and improve the Penny service.</li>
                <li>Match voice input to learners and capture assessment results accurately.</li>
                <li>Generate exports and reports you request.</li>
                <li>Communicate with you about your account, updates, and support requests.</li>
                <li>Detect and prevent abuse or technical issues.</li>
              </ul>
            </PolicySection>

            <PolicySection title="4. Data storage and security">
              Your data is stored in secure cloud infrastructure with encryption in transit and at rest. We implement access controls, audit logging, and regular security reviews. While we take reasonable precautions, no internet service is completely secure, and we cannot guarantee absolute protection.
            </PolicySection>

            <PolicySection title="5. Data sharing">
              We do not sell your personal information or learner data. We only share data with:
              <ul className="list-disc pl-5 space-y-1.5 mt-2">
                <li>Service providers who perform functions on our behalf (hosting, authentication, error reporting).</li>
                <li>Other users in your school or organisation only when you explicitly choose to share content.</li>
                <li>Authorities when required by law or to protect our rights.</li>
              </ul>
            </PolicySection>

            <PolicySection title="6. Your rights">
              Depending on your location, you may have the right to access, correct, delete, or export your data. South African users have rights under the Protection of Personal Information Act (POPIA). Contact us at any time to exercise these rights.
            </PolicySection>

            <PolicySection title="7. Children's data">
              Penny is designed for use by teachers and schools. Learner data is processed at the direction of the educational institution. We rely on schools to obtain appropriate consent for processing learner information where required.
            </PolicySection>

            <PolicySection title="8. Retention">
              We keep your data for as long as your account is active or as needed to provide the service. You can delete your account and associated data at any time. Some information may be retained in backups for a limited period after deletion.
            </PolicySection>

            <PolicySection title="9. Changes to this policy">
              We may update this Privacy Policy from time to time. We will notify you of material changes through the app or by email.
            </PolicySection>

            <PolicySection title="10. Contact us">
              If you have questions about this Privacy Policy or your data, please contact our support team through the application or email the address listed in your account settings.
            </PolicySection>
          </div>
        </div>
      </main>

      <LegalFooter />
    </div>
  );
}

function PolicySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="font-display text-lg font-semibold mb-2">{title}</h2>
      <div className="text-sm text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}
