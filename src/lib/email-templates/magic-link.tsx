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

interface MagicLinkEmailProps {
  confirmationUrl: string
}

export const MagicLinkEmail = ({ confirmationUrl }: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your Penny sign-in link</Preview>
    <Body style={main}>
      <Container style={container}>
        <PennyEmailHeader />
        <Heading style={h1}>Here is your sign-in link.</Heading>
        <Text style={text}>
          Click the button below to sign in to Penny. This link expires in about
          an hour — if it does not work, request a new one from the sign-in page.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Sign in to Penny
        </Button>
        <PennyEmailFooter disclaimer="If you did not request this link, you can safely ignore this email." />
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail

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
