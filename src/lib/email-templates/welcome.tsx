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
import {
  EMAIL_DASHBOARD_URL,
  EMAIL_FAQ_URL,
  EMAIL_SUPPORT_ADDRESS,
} from "@/lib/email-config";
import { PRODUCT, PRODUCT_FEATURES } from "@/lib/product-knowledge";
import type { TemplateEntry } from "./registry";

interface Props {
  teacherName?: string;
}

const WelcomeEmail = ({ teacherName }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Welcome to Penny — let's give you your time back</Preview>
    <Body style={main}>
      <Container style={container}>
        <PennyEmailHeader />
        <Heading style={h1}>Welcome{teacherName ? `, ${teacherName}` : ""}.</Heading>
        <Text style={text}>
          You are in. Penny is your AI teaching assistant for South African classrooms —
          built to cut the admin so you can focus on teaching.
        </Text>
        <Text style={text}>Here is what you can do right away:</Text>
        <Text style={list}>
          {PRODUCT_FEATURES.map((f) => (
            <React.Fragment key={f}>
              • {f}
              <br />
            </React.Fragment>
          ))}
        </Text>
        <Button style={button} href={EMAIL_DASHBOARD_URL}>
          Go to my dashboard
        </Button>
        <Text style={text}>
          Need a hand? Visit{" "}
          <a href={EMAIL_FAQ_URL} style={{ color: "#4A6B4A" }}>
            Help &amp; FAQ
          </a>{" "}
          or reply to this email ({EMAIL_SUPPORT_ADDRESS}).
        </Text>
        <PennyEmailFooter />
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: WelcomeEmail,
  subject: `Welcome to ${PRODUCT.name}`,
  displayName: "Welcome",
  previewData: { teacherName: "Alex" },
} satisfies TemplateEntry;

const main = { backgroundColor: "#ffffff", fontFamily: '"Plus Jakarta Sans", Arial, sans-serif' };
const container = { padding: "20px 25px", maxWidth: "520px" };
const h1 = { fontSize: "22px", fontWeight: "bold" as const, color: "#4A6B4A", margin: "0 0 20px" };
const text = { fontSize: "14px", color: "#55575d", lineHeight: "1.5", margin: "0 0 16px" };
const list = { ...text, margin: "0 0 24px" };
const button = {
  backgroundColor: "#4A6B4A",
  color: "#ffffff",
  fontSize: "14px",
  borderRadius: "8px",
  padding: "12px 20px",
  textDecoration: "none",
};
