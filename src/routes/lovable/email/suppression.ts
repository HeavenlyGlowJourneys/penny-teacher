import { createClient } from '@supabase/supabase-js'
import { createFileRoute } from '@tanstack/react-router'
import { verifyStandardWebhook, WebhookVerificationError } from '@/lib/webhook-verify'

// Resend webhook event shape (only the fields we use).
// https://resend.com/docs/dashboard/webhooks/event-types
interface ResendWebhookEvent {
  type: string
  created_at: string
  data: {
    email_id?: string
    to?: string[]
    subject?: string
  }
}

const SUPPRESSION_EVENT_TYPES = new Set(['email.bounced', 'email.complained'])

function mapEventTypeToReason(type: string): 'bounce' | 'complaint' {
  return type === 'email.complained' ? 'complaint' : 'bounce'
}

function mapReasonToStatus(reason: string): 'bounced' | 'complained' {
  return reason === 'complaint' ? 'complained' : 'bounced'
}

function mapReasonToMessage(reason: string): string {
  return reason === 'complaint'
    ? 'Spam complaint — recipient marked email as spam'
    : 'Permanent bounce — email address is invalid or rejected'
}

export const Route = createFileRoute("/lovable/email/suppression")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const webhookSecret = process.env.RESEND_WEBHOOK_SECRET
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

        if (!webhookSecret || !supabaseUrl || !supabaseServiceKey) {
          console.error('Missing required environment variables')
          return Response.json({ error: 'Server configuration error' }, { status: 500 })
        }

        // Resend signs webhooks per the Standard Webhooks spec (it uses Svix).
        let event: ResendWebhookEvent
        try {
          event = await verifyStandardWebhook(request, webhookSecret)
        } catch (error) {
          if (error instanceof WebhookVerificationError) {
            console.error('Invalid suppression webhook signature', { error: error.message })
            return Response.json({ error: 'Invalid signature' }, { status: 401 })
          }
          console.error('Webhook verification failed', { error })
          return Response.json({ error: 'Invalid payload' }, { status: 400 })
        }

        // We only care about bounce/complaint events — everything else
        // (delivered, opened, clicked, ...) is a no-op ack.
        if (!SUPPRESSION_EVENT_TYPES.has(event.type)) {
          return Response.json({ success: true, ignored: event.type })
        }

        const recipient = event.data?.to?.[0]
        if (!recipient) {
          console.error('Suppression event missing recipient', { type: event.type })
          return Response.json({ error: 'Missing recipient' }, { status: 400 })
        }

        const reason = mapEventTypeToReason(event.type)
        const normalizedEmail = recipient.toLowerCase()

        const supabase = createClient(supabaseUrl, supabaseServiceKey)

        // 1. Upsert to suppressed_emails (idempotent — safe for retries)
        const { error: suppressError } = await supabase
          .from('suppressed_emails')
          .upsert(
            {
              email: normalizedEmail,
              reason,
              metadata: { resend_email_id: event.data?.email_id ?? null },
            },
            { onConflict: 'email' },
          )

        if (suppressError) {
          console.error('Failed to upsert suppressed email', {
            error: suppressError,
            email_redacted: normalizedEmail[0] + '***@' + normalizedEmail.split('@')[1],
          })
          return Response.json({ error: 'Failed to write suppression' }, { status: 500 })
        }

        // 2. Append a new log entry for the suppression event (never update existing rows)
        const sendLogStatus = mapReasonToStatus(reason)
        const sendLogMessage = mapReasonToMessage(reason)

        const { error: insertError } = await supabase
          .from('email_send_log')
          .insert({
            message_id: event.data?.email_id ?? null,
            template_name: 'system',
            recipient_email: normalizedEmail,
            status: sendLogStatus,
            error_message: sendLogMessage,
          })

        if (insertError) {
          // Non-fatal — log and continue. The suppression was already recorded.
          console.warn('Failed to insert email_send_log', { error: insertError })
        }

        console.log('Suppression processed', {
          email_redacted: normalizedEmail[0] + '***@' + normalizedEmail.split('@')[1],
          reason,
          resend_type: event.type,
        })

        return Response.json({ success: true })
      },
    },
  },
})
