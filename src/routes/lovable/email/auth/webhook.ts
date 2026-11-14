import * as React from 'react'
import { render } from 'react-email'
import { createClient } from '@supabase/supabase-js'
import { createFileRoute } from '@tanstack/react-router'
import { verifyStandardWebhook, WebhookVerificationError } from '@/lib/webhook-verify'
import { emailFromHeader, EMAIL_REPLY_TO } from '@/lib/email-config'
import { SignupEmail } from '@/lib/email-templates/signup'
import { InviteEmail } from '@/lib/email-templates/invite'
import { MagicLinkEmail } from '@/lib/email-templates/magic-link'
import { RecoveryEmail } from '@/lib/email-templates/recovery'
import { EmailChangeEmail } from '@/lib/email-templates/email-change'
import { ReauthenticationEmail } from '@/lib/email-templates/reauthentication'

const EMAIL_SUBJECTS: Record<string, string> = {
  signup: 'Confirm your Penny account',
  invite: "You've been invited",
  magiclink: 'Your Penny sign-in link',
  recovery: 'Reset your Penny password',
  email_change: 'Confirm your new email',
  reauthentication: 'Your verification code',
}

// Template mapping
const EMAIL_TEMPLATES: Record<string, React.ComponentType<any>> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
}

function redactEmail(email: string | null | undefined): string {
  if (!email) return '***'
  const [localPart, domain] = email.split('@')
  if (!localPart || !domain) return '***'
  return `${localPart[0]}***@${domain}`
}

export const Route = createFileRoute("/lovable/email/auth/webhook")({
  // @ts-expect-error - server block is transformed by TanStack router plugin at build time
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const hookSecret = process.env.SUPABASE_AUTH_HOOK_SECRET
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

        if (!hookSecret || !supabaseUrl || !supabaseServiceKey) {
          console.error('Missing required environment variables')
          return Response.json(
            { error: 'Server configuration error' },
            { status: 500 }
          )
        }

        // Supabase's native "Send Email" Auth Hook signs requests per the
        // Standard Webhooks spec (https://www.standardwebhooks.com/) — the
        // same scheme Svix and Resend use.
        let payload: any
        try {
          payload = await verifyStandardWebhook(request, hookSecret)
        } catch (error) {
          if (error instanceof WebhookVerificationError) {
            console.error('Invalid auth webhook signature', { error: error.message })
            return Response.json(
              { error: 'Invalid signature' },
              { status: 401 }
            )
          }
          console.error('Webhook verification failed', { error })
          return Response.json(
            { error: 'Invalid webhook payload' },
            { status: 400 }
          )
        }

        const user = payload.user
        const emailData = payload.email_data
        const emailType = emailData?.email_action_type

        if (!emailType || !user?.email) {
          console.error('Webhook payload missing required fields', {
            hasEmailType: !!emailType,
            hasEmail: !!user?.email,
          })
          return Response.json(
            { error: 'Invalid webhook payload' },
            { status: 400 }
          )
        }

        console.log('Received auth event', {
          emailType,
          email_redacted: redactEmail(user.email),
        })

        const EmailTemplate = EMAIL_TEMPLATES[emailType]
        if (!EmailTemplate) {
          console.error('Unknown email type', { emailType })
          return Response.json(
            { error: `Unknown email type: ${emailType}` },
            { status: 400 }
          )
        }

        // Supabase's Send Email Hook gives us the raw pieces (token_hash,
        // redirect_to) to build the verification link ourselves — unlike
        // Lovable's relay, it doesn't hand us a pre-built URL.
        const confirmationUrl = new URL(`${supabaseUrl}/auth/v1/verify`)
        confirmationUrl.searchParams.set('token', emailData.token_hash)
        confirmationUrl.searchParams.set('type', emailType)
        if (emailData.redirect_to) {
          confirmationUrl.searchParams.set('redirect_to', emailData.redirect_to)
        }

        // Build template props
        const templateProps = {
          siteName: 'Penny Teacher',
          siteUrl: emailData.site_url,
          recipient: user.email,
          confirmationUrl: confirmationUrl.toString(),
          token: emailData.token,
          email: user.email,
          oldEmail: user.email,
          newEmail: emailData.new_email ?? user.new_email,
        }

        // Render React Email to HTML and plain text
        const element = React.createElement(EmailTemplate, templateProps)
        const html = await render(element)
        const text = await render(element, { plainText: true })

        // Enqueue email for async processing by the dispatcher.
        const supabase = createClient(supabaseUrl, supabaseServiceKey)
        const messageId = crypto.randomUUID()

        // Log pending BEFORE enqueue so we have a record even if enqueue crashes
        await supabase.from('email_send_log').insert({
          message_id: messageId,
          template_name: emailType,
          recipient_email: user.email,
          status: 'pending',
        })

        const { error: enqueueError } = await supabase.rpc('enqueue_email', {
          queue_name: 'auth_emails',
          payload: {
            message_id: messageId,
            to: user.email,
            from: emailFromHeader(),
            reply_to: EMAIL_REPLY_TO,
            subject: EMAIL_SUBJECTS[emailType] || 'Notification',
            html,
            text,
            purpose: 'transactional',
            label: emailType,
            queued_at: new Date().toISOString(),
          },
        })

        if (enqueueError) {
          console.error('Failed to enqueue auth email', { error: enqueueError, emailType })
          await supabase.from('email_send_log').insert({
            message_id: messageId,
            template_name: emailType,
            recipient_email: user.email,
            status: 'failed',
            error_message: 'Failed to enqueue email',
          })
          return Response.json(
            { error: 'Failed to enqueue email' },
            { status: 500 }
          )
        }

        console.log('Auth email enqueued', {
          emailType,
          email_redacted: redactEmail(user.email),
        })

        return Response.json({ success: true, queued: true })
      },
    },
  },
})
