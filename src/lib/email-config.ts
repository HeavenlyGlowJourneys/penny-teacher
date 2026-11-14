/**
 * Shared outbound email identity for Penny.
 * Must match the Resend-verified domain and Cloudflare Email Routing setup.
 */
export const EMAIL_FROM_DOMAIN = "notify.pennyteacher.co.za";

/** Display name shown in the From: header. */
export const EMAIL_FROM_NAME = "Penny Teacher";

/** Envelope sender — do not use for customer replies. */
export const EMAIL_FROM_ADDRESS = `noreply@${EMAIL_FROM_DOMAIN}`;

/**
 * Reply-To — teacher replies should land here, then Cloudflare Email Routing
 * forwards to pennyteacherapp@gmail.com.
 */
export const EMAIL_REPLY_TO = `support@${EMAIL_FROM_DOMAIN}`;

/** Public site shown in email footers. */
export const EMAIL_SITE_URL = "https://pennyteacher.co.za";

/** Support address shown in footers (same mailbox as Reply-To routing). */
export const EMAIL_SUPPORT_ADDRESS = EMAIL_REPLY_TO;

/** App origin — logo and deep links. */
export const EMAIL_APP_URL = "https://app.pennyteacher.co.za";

/** Stable production logo (Workers static asset under /public). */
export const EMAIL_LOGO_URL = `${EMAIL_APP_URL}/penny-logo.png?v=3`;

export const EMAIL_DASHBOARD_URL = `${EMAIL_APP_URL}/dashboard`;
export const EMAIL_PRICING_URL = `${EMAIL_APP_URL}/pricing`;
export const EMAIL_BILLING_URL = `${EMAIL_APP_URL}/billing`;
export const EMAIL_FAQ_URL = `${EMAIL_APP_URL}/faq`;
export const EMAIL_PRIVACY_URL = `${EMAIL_APP_URL}/privacy`;
export const EMAIL_TERMS_URL = `${EMAIL_APP_URL}/terms`;

export function emailFromHeader(): string {
  return `${EMAIL_FROM_NAME} <${EMAIL_FROM_ADDRESS}>`;
}
