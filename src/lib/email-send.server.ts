/**
 * Server-only: render a transactional template and enqueue it for Resend.
 * Used by PayFast webhooks, cancellation, onboarding, and feedback.
 * Do not expose this over a user-JWT HTTP route.
 */
import * as React from "react";
import { render } from "react-email";
import { TEMPLATES } from "@/lib/email-templates/registry";
import {
  emailFromHeader,
  EMAIL_FROM_DOMAIN,
  EMAIL_REPLY_TO,
} from "@/lib/email-config";

export type EnqueueTemplateResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: string };

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function resolveUnsubscribeToken(
  supabaseAdmin: Awaited<
    typeof import("@/integrations/supabase/client.server")
  >["supabaseAdmin"],
  email: string,
): Promise<string | null> {
  const normalized = email.toLowerCase();
  const { data: existing } = await supabaseAdmin
    .from("email_unsubscribe_tokens")
    .select("token, used_at")
    .eq("email", normalized)
    .maybeSingle();

  if (existing && !existing.used_at) return existing.token;
  if (existing?.used_at) return null;

  const token = generateToken();
  await supabaseAdmin
    .from("email_unsubscribe_tokens")
    .upsert({ token, email: normalized }, { onConflict: "email", ignoreDuplicates: true });

  const { data: stored } = await supabaseAdmin
    .from("email_unsubscribe_tokens")
    .select("token")
    .eq("email", normalized)
    .maybeSingle();

  return stored?.token ?? token;
}

export async function enqueueTransactionalTemplate(opts: {
  templateName: string;
  recipientEmail: string;
  templateData?: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<EnqueueTemplateResult> {
  const template = TEMPLATES[opts.templateName];
  if (!template) {
    return { ok: false, reason: `unknown_template:${opts.templateName}` };
  }

  const to = template.to ?? opts.recipientEmail;
  if (!to) return { ok: false, reason: "missing_recipient" };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Idempotency: skip if we already queued or sent this key.
  const { data: prior } = await supabaseAdmin
    .from("email_send_log")
    .select("id")
    .eq("message_id", opts.idempotencyKey)
    .in("status", ["sent", "pending"])
    .maybeSingle();
  if (prior) return { ok: true, messageId: opts.idempotencyKey };

  const { data: suppressed } = await supabaseAdmin
    .from("suppressed_emails")
    .select("email")
    .eq("email", to.toLowerCase())
    .maybeSingle();
  if (suppressed) return { ok: false, reason: "email_suppressed" };

  const unsubscribeToken = await resolveUnsubscribeToken(supabaseAdmin, to);
  if (!unsubscribeToken) {
    return { ok: false, reason: "email_suppressed" };
  }

  const data = opts.templateData ?? {};
  const element = React.createElement(template.component, data);
  const html = await render(element);
  const text = await render(element, { plainText: true });
  const subject =
    typeof template.subject === "function" ? template.subject(data) : template.subject;

  const messageId = opts.idempotencyKey;

  await supabaseAdmin.from("email_send_log").insert({
    message_id: messageId,
    template_name: opts.templateName,
    recipient_email: to,
    status: "pending",
  });

  const { error } = await supabaseAdmin.rpc("enqueue_email", {
    queue_name: "transactional_emails",
    payload: {
      message_id: messageId,
      to,
      from: emailFromHeader(),
      reply_to: EMAIL_REPLY_TO,
      sender_domain: EMAIL_FROM_DOMAIN,
      subject,
      html,
      text,
      purpose: "transactional",
      label: opts.templateName,
      idempotency_key: opts.idempotencyKey,
      unsubscribe_token: unsubscribeToken,
      queued_at: new Date().toISOString(),
    },
  });

  if (error) {
    console.error("[email] enqueue failed", error);
    await supabaseAdmin.from("email_send_log").insert({
      message_id: messageId,
      template_name: opts.templateName,
      recipient_email: to,
      status: "failed",
      error_message: "Failed to enqueue email",
    });
    return { ok: false, reason: "enqueue_failed" };
  }

  return { ok: true, messageId };
}
