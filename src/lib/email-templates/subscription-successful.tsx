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
import { EMAIL_BILLING_URL, EMAIL_DASHBOARD_URL } from "@/lib/email-config";
import { PRODUCT, formatPriceCopy } from "@/lib/product-knowledge";
import type { TemplateEntry } from "./registry";

interface Props {
  planName?: string;
  amountLabel?: string;
  renewsAt?: string;
}

const SubscriptionSuccessfulEmail = ({
  planName = PRODUCT.planName,
  amountLabel = formatPriceCopy(),
  renewsAt,
}: Props) => {
  const renewLabel = renewsAt
    ? new Date(renewsAt).toLocaleDateString("en-ZA", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "in one month";

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Your Penny subscription is active</Preview>
      <Body style={main}>
        <Container style={container}>
          <PennyEmailHeader />
          <Heading style={h1}>You are subscribed.</Heading>
          <Text style={text}>
            Thank you for supporting Penny. Your <strong>{planName}</strong> plan is active
            at <strong>{amountLabel}</strong>.
          </Text>
          <Text style={text}>
            Billing renews automatically on <strong>{renewLabel}</strong> unless you cancel.
            You can manage billing anytime in the app.
          </Text>
          <Button style={button} href={EMAIL_BILLING_URL}>
            Manage subscription
          </Button>
          <Text style={text}>
            Or jump straight back to teaching from your{" "}
            <a href={EMAIL_DASHBOARD_URL} style={{ color: "#4A6B4A" }}>
              dashboard
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
  component: SubscriptionSuccessfulEmail,
  subject: "Your Penny subscription is confirmed",
  displayName: "Subscription successful",
  previewData: {
    planName: "Penny",
    amountLabel: "R29/month",
    renewsAt: new Date(Date.now() + 30 * 864e5).toISOString(),
  },
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
