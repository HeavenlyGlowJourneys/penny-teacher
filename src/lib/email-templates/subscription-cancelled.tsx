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
import { EMAIL_PRICING_URL } from "@/lib/email-config";
import type { TemplateEntry } from "./registry";

const CHOOSE_PLAN = "https://app.pennyteacher.co.za/choose-plan";

interface Props {
  accessUntil?: string;
}

const SubscriptionCancelledEmail = ({ accessUntil }: Props) => {
  const untilLabel = accessUntil
    ? new Date(accessUntil).toLocaleDateString("en-ZA", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "the end of your current billing period";

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Your Penny subscription has been cancelled</Preview>
      <Body style={main}>
        <Container style={container}>
          <PennyEmailHeader />
          <Heading style={h1}>Cancellation confirmed.</Heading>
          <Text style={text}>
            Your recurring billing has been stopped. You keep full access until{" "}
            <strong>{untilLabel}</strong>.
          </Text>
          <Text style={text}>
            After that, you can re-subscribe any time. Your data follows our POPIA retention
            window — see Billing in the app for details.
          </Text>
          <Button style={button} href={CHOOSE_PLAN}>
            Re-subscribe to Penny
          </Button>
          <Text style={text}>
            Compare what is included on{" "}
            <a href={EMAIL_PRICING_URL} style={{ color: "#4A6B4A" }}>
              pricing
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
  component: SubscriptionCancelledEmail,
  subject: "Your Penny subscription has been cancelled",
  displayName: "Subscription cancelled",
  previewData: { accessUntil: new Date(Date.now() + 20 * 864e5).toISOString() },
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
