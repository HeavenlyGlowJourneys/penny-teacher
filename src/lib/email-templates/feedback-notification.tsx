// Internal notification email sent to the Penny team whenever a teacher
// submits feedback via the in-app floating button.
import * as React from 'react'
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  category?: string
  page?: string
  plan?: string
  browser?: string
  appVersion?: string
  message?: string
}

const NOTIFY_TO = 'pennyteacherapp@gmail.com'

const FeedbackNotificationEmail = ({
  category = 'Feedback',
  page = '/',
  plan = 'unknown',
  browser = 'unknown',
  appVersion = '1.0.0',
  message = '',
}: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`New Penny feedback (${category}) from ${page}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>New feedback from a teacher</Heading>
        <Text style={intro}>
          A teacher just submitted feedback in the Penny app.
        </Text>

        <Section style={metaBox}>
          <Text style={metaRow}>
            <strong>Category:</strong> {category}
          </Text>
          <Text style={metaRow}>
            <strong>Page:</strong> {page}
          </Text>
          <Text style={metaRow}>
            <strong>Plan:</strong> {plan}
          </Text>
          <Text style={metaRow}>
            <strong>Browser:</strong> {browser}
          </Text>
          <Text style={metaRow}>
            <strong>App version:</strong> {appVersion}
          </Text>
        </Section>

        <Hr style={hr} />

        <Heading as="h2" style={h2}>
          Message
        </Heading>
        <Text style={messageBlock}>{message}</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: FeedbackNotificationEmail,
  subject: (data: Record<string, any>) =>
    `[${data?.category ?? 'Feedback'}] Penny Feedback — ${data?.page ?? '/'}`,
  displayName: 'Feedback notification',
  to: NOTIFY_TO,
  previewData: {
    category: 'Compliment',
    page: '/dashboard',
    plan: 'Penny',
    browser: 'Chrome on macOS',
    appVersion: '1.0.0',
    message: 'Love the new voice capture — saved me a whole evening.',
  },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
  color: '#1f2937',
}
const container = {
  maxWidth: '560px',
  margin: '0 auto',
  padding: '32px 24px',
}
const h1 = {
  fontSize: '22px',
  fontWeight: 600,
  margin: '0 0 12px',
  color: '#1f2937',
}
const h2 = {
  fontSize: '16px',
  fontWeight: 600,
  margin: '20px 0 8px',
  color: '#1f2937',
}
const intro = {
  fontSize: '14px',
  lineHeight: '22px',
  margin: '0 0 20px',
  color: '#374151',
}
const metaBox = {
  backgroundColor: '#f7f5ef',
  borderRadius: '10px',
  padding: '16px 18px',
}
const metaRow = {
  fontSize: '14px',
  lineHeight: '22px',
  margin: '2px 0',
  color: '#1f2937',
}
const hr = {
  borderColor: '#e5e7eb',
  margin: '24px 0',
}
const messageBlock = {
  fontSize: '14px',
  lineHeight: '22px',
  whiteSpace: 'pre-wrap' as const,
  margin: 0,
  color: '#1f2937',
}
