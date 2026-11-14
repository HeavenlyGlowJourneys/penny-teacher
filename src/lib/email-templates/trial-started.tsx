import * as React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from "@react-email/components";
import { PennyEmailFooter, PennyEmailHeader } from "@/lib/email-templates/PennyEmailFooter";
import { EMAIL_DASHBOARD_URL, EMAIL_PRICING_URL } from "@/lib/email-config";
import { PRODUCT, formatPriceCopy, formatTrialCopy } from "@/lib/product-knowledge";
import type { TemplateEntry } from "./registry";

interface Props {
  trialEndsAt?: string;
}

const TrialStartedEmail = ({ trialEndsAt }: Props) => {
  const endsLabel = trialEndsAt
    ? new Date(trialEndsAt).toLocaleDateString("en-ZA", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : `in ${PRODUCT.trialDays} days`;

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Your {formatTrialCopy()} has started</Preview>
      <Body style={main}>
        <Container style={container}>
          <PennyEmailHeader />
          <Heading style={h1}>Your free trial is on.</Heading>
          <Text style={text}>
            You have full access to Penny for {PRODUCT.trialDays} days — no card required.
            Your trial ends on <strong>{endsLabel}</strong>.
          </Text>
          <Text style={text}>
            After that, continue for {formatPriceCopy()} with everything included. You can
            add a payment method any time from Billing.
          </Text>
          <Button style={button} href={EMAIL_DASHBOARD_URL}>
            Start capturing marks
          </Button>
          <Text style={text}>
            Curious about pricing? See{" "}
            <a href={EMAIL_PRICING_URL} style={{ color: "#4A6B4A" }}>
              plans &amp; pricing
            </a>
            .
          </Text>
          <PennyEmailFooter />
        </Container>
      </Body>
    </Html>
  );
};

export const template = {
  component: TrialStartedEmail,
  subject: `Your ${PRODUCT.trialDays}-day Penny trial has started`,
  displayName: "Trial started",
  previewData: { trialEndsAt: new Date(Date.now() + 3 * 864e5).toISOString() },
} satisfies TemplateEntry;

const main = { backgroundColor: "#ffffff", fontFamily: '"Plus Jakarta Sans", Arial, sans-serif' };
const container = { padding: "20px 25px", maxWidth: "520px" };
const h1 = { fontSize: "22px", fontWeight: "bold" as const, color: "#4A6B4A", margin: "0 0 20px" };
const text = { fontSize: "14px", color: "#55575d", lineHeight: "1.5", margin: "0 0 16px" };
const button = {
  backgroundColor: "#4A6B4A",
  color: "#ffffff",
  fontSize: "14px",
  borderRadius: "8px",
  padding: "12px 20px",
  textDecoration: "none",
  marginBottom: "16px",
};
