/**
 * Shared founder allowlist — safe to import from client or server.
 * Emails come from env only; never hardcode personal addresses in source.
 *
 * Set comma-separated addresses in:
 * - VITE_FOUNDER_EMAILS (client + build)
 * - FOUNDER_EMAILS (server / Worker; falls back to VITE_FOUNDER_EMAILS)
 */

function readFounderEmailsRaw(): string {
  const fromVite =
    typeof import.meta !== "undefined" && import.meta.env
      ? String(import.meta.env.VITE_FOUNDER_EMAILS ?? "")
      : "";
  const fromProcess =
    typeof process !== "undefined"
      ? String(process.env.FOUNDER_EMAILS ?? process.env.VITE_FOUNDER_EMAILS ?? "")
      : "";
  return (fromVite || fromProcess).trim();
}

export function getFounderEmails(): readonly string[] {
  const raw = readFounderEmailsRaw();
  if (!raw) return [];
  return raw
    .split(/[,;\n]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

export function isFounderEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const needle = email.toLowerCase().trim();
  return getFounderEmails().includes(needle);
}
