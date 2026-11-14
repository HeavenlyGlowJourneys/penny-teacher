import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/** Name shown in "Hi …" and Settings — preferred over email local-part. */
export function teacherDisplayName(user: Pick<User, "email" | "user_metadata">): string {
  const meta = (user.user_metadata ?? {}) as { full_name?: string; name?: string };
  const fromMeta = (meta.full_name || meta.name || "").trim();
  if (fromMeta) return fromMeta;
  return user.email?.split("@")[0] || "there";
}

/** First name / short form for warm greetings (e.g. emails). */
export function teacherFirstName(user: Pick<User, "email" | "user_metadata">): string {
  const display = teacherDisplayName(user);
  return display.split(/\s+/)[0] || "there";
}

export async function updateTeacherDisplayName(name: string): Promise<string> {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) throw new Error("Please enter a name");
  if (trimmed.length > 60) throw new Error("Name is a bit long — try something shorter");

  const { data, error } = await supabase.auth.updateUser({
    data: { full_name: trimmed, name: trimmed },
  });
  if (error) throw error;
  return teacherDisplayName(data.user);
}
