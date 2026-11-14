import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { StudentDashboardPage } from "@/features/oral-assessment/pages/StudentDashboardPage";

export const Route = createFileRoute("/tools/oral-assessment/student")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  head: () => ({
    meta: [
      { title: "Student — Oral Assessment" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: StudentDashboardPage,
});
