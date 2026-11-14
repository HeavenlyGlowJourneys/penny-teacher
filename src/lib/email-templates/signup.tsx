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

interface SignupEmailProps {
  confirmationUrl: string
}

export const SignupEmail = ({ confirmationUrl }: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your Penny account</Preview>
    <Body style={main}>
      <Container style={container}>
        <PennyEmailHeader />
        <Heading style={h1}>Almost there.</Heading>
        <Text style={text}>Hi there,</Text>
        <Text style={text}>
          Thanks for joining Penny — the teaching assistant that gives you your
          time back.
        </Text>
        <Text style={text}>
          Click the button below to confirm your email address and get started.
        </Text>
        <Text style={text}>
          Once you are in, you will be capturing marks by voice in minutes.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Confirm my account
        </Button>
        <PennyEmailFooter disclaimer="If you did not create a Penny account, you can safely ignore this email." />
      </Container>
    </Body>
  </Html>
)

export default SignupEmail

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
