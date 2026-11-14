/**
 * Penny Oral Assessment Tool access control.
 * Private beta: founder emails only.
 * Later: set VITE_ORAL_ASSESSMENT_PUBLIC=true (and ORAL_ASSESSMENT_PUBLIC on Worker).
 */
import { isFounderEmail } from "@/lib/founder-access";

export function isOralAssessmentPublic(): boolean {
  const vite = (import.meta.env.VITE_ORAL_ASSESSMENT_PUBLIC as string | undefined)?.trim();
  const server =
    typeof process !== "undefined" ? process.env.ORAL_ASSESSMENT_PUBLIC?.trim() : undefined;
  const raw = vite || server || "";
  return raw === "1" || raw.toLowerCase() === "true";
}

/** Signed-in user may use Oral Assessment (founder-only until public flag is set). */
export function canUseOralAssessment(email: string | null | undefined): boolean {
  if (!email) return false;
  if (isOralAssessmentPublic()) return true;
  return isFounderEmail(email);
}

/**
 * Student surfaces (invite accept, student dashboard, viva, report) are open to any
 * signed-in user. Server functions still enforce invitation / session ownership.
 * Lecturer create/manage stays on canUseOralAssessment.
 */
export function canAccessOralStudentSurface(_email: string | null | undefined): boolean {
  return true;
}
