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
import { EMAIL_SUPPORT_ADDRESS } from "@/lib/email-config";
import type { TemplateEntry } from "./registry";

interface Props {
  studentName?: string;
  lecturerName?: string;
  assessmentTitle?: string;
  inviteUrl?: string;
  expectedDurationMinutes?: number;
}

const OralAssessmentInviteEmail = ({
  studentName,
  lecturerName,
  assessmentTitle,
  inviteUrl,
  expectedDurationMinutes,
}: Props) => {
  const title = assessmentTitle?.trim() || "oral assessment";
  const greeting = studentName?.trim() ? `Hi ${studentName.trim()},` : "Hi,";
  const from = lecturerName?.trim() || "your lecturer";
  const duration =
    typeof expectedDurationMinutes === "number" && expectedDurationMinutes > 0
      ? ` About ${expectedDurationMinutes} minutes.`
      : "";

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>You are invited to a Penny oral assessment: {title}</Preview>
      <Body style={main}>
        <Container style={container}>
          <PennyEmailHeader />
          <Heading style={h1}>You are invited to an oral assessment</Heading>
          <Text style={text}>{greeting}</Text>
          <Text style={text}>
            {from} has invited you to complete <strong>{title}</strong> with Penny.
            This is a spoken viva — you will answer questions out loud.
            {duration}
          </Text>
          <Text style={text}>
            Sign in with this email address, then open the link below to accept and start when
            you are ready. AI may recommend a mark; your lecturer awards the final result.
          </Text>
          {inviteUrl ? (
            <Button style={button} href={inviteUrl}>
              Open oral assessment
            </Button>
          ) : null}
          <Text style={text}>
            Prefer Chrome or Edge with a microphone. Need help? Reply to this email (
            {EMAIL_SUPPORT_ADDRESS}).
          </Text>
          <PennyEmailFooter />
        </Container>
      </Body>
    </Html>
  );
};

export const template = {
  component: OralAssessmentInviteEmail,
  subject: (data: Record<string, unknown>) => {
    const title =
      typeof data.assessmentTitle === "string" && data.assessmentTitle.trim()
        ? data.assessmentTitle.trim()
        : "oral assessment";
    return `Invitation: ${title}`;
  },
  displayName: "Oral assessment invite",
  previewData: {
    studentName: "Alex",
    lecturerName: "Dr Morgan",
    assessmentTitle: "Parts of Speech — Unit 2",
    inviteUrl: "https://app.pennyteacher.co.za/tools/oral-assessment/invite/preview",
    expectedDurationMinutes: 15,
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
