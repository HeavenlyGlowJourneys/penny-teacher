/**
 * Prep Check access control.
 * Private beta: founder emails only.
 * Later: set VITE_PREP_CHECK_PUBLIC=true (and PREP_CHECK_PUBLIC on Worker) to open to any signed-in user.
 */
import { isFounderEmail } from "@/lib/founder-access";

export function isPrepCheckPublic(): boolean {
  const vite = (import.meta.env.VITE_PREP_CHECK_PUBLIC as string | undefined)?.trim();
  const server =
    typeof process !== "undefined" ? process.env.PREP_CHECK_PUBLIC?.trim() : undefined;
  const raw = vite || server || "";
  return raw === "1" || raw.toLowerCase() === "true";
}

/** Signed-in user may use Prep Check (founder-only until public flag is set). */
export function canUsePrepCheck(email: string | null | undefined): boolean {
  if (!email) return false;
  if (isPrepCheckPublic()) return true;
  return isFounderEmail(email);
}
