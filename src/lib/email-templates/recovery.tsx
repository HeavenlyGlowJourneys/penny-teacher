import * as React from 'react'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from '@react-email/components'
import { PennyEmailFooter, PennyEmailHeader } from '@/lib/email-templates/PennyEmailFooter'

interface RecoveryEmailProps {
  confirmationUrl: string
}

export const RecoveryEmail = ({ confirmationUrl }: RecoveryEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Reset your Penny password</Preview>
    <Body style={main}>
      <Container style={container}>
        <PennyEmailHeader />
        <Heading style={h1}>Forgot your password?</Heading>
        <Text style={text}>No problem — it happens to the best of us.</Text>
        <Text style={text}>
          Click the button below to set a new password and get back to what
          matters.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Reset my password
        </Button>
        <PennyEmailFooter disclaimer="If you did not request a password reset, you can safely ignore this email." />
      </Container>
    </Body>
  </Html>
)

export default RecoveryEmail

const main = { backgroundColor: '#ffffff', fontFamily: '"Plus Jakarta Sans", Arial, sans-serif' }
const container = { padding: '20px 25px', maxWidth: '520px' }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#4A6B4A',
  margin: '0 0 20px',
}
const text = {
  fontSize: '14px',
  color: '#55575d',
  lineHeight: '1.5',
  margin: '0 0 25px',
}
const button = {
  backgroundColor: '#4A6B4A',
  color: '#ffffff',
  fontSize: '14px',
  borderRadius: '8px',
  padding: '12px 20px',
  textDecoration: 'none',
}
