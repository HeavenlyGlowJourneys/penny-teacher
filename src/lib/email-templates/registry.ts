import type { ComponentType } from 'react'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string
}

/**
 * Template registry — maps template names to their React Email components.
 * Import and register new templates here after creating them in this directory.
 */
import { template as feedbackNotification } from './feedback-notification'
import { template as welcome } from './welcome'
import { template as trialStarted } from './trial-started'
import { template as subscriptionSuccessful } from './subscription-successful'
import { template as subscriptionCancelled } from './subscription-cancelled'
import { template as oralAssessmentInvite } from './oral-assessment-invite'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'feedback-notification': feedbackNotification,
  welcome,
  'trial-started': trialStarted,
  'subscription-successful': subscriptionSuccessful,
  'subscription-cancelled': subscriptionCancelled,
  'oral-assessment-invite': oralAssessmentInvite,
}
