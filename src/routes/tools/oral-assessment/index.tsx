import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { canUseOralAssessment, LecturerDashboardPage } from "@/features/oral-assessment";

export const Route = createFileRoute("/tools/oral-assessment/")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    if (!canUseOralAssessment(data.user.email)) throw redirect({ to: "/" });
  },
  head: () => ({
    meta: [
      { title: "Penny Oral Assessment Tool" },
      {
        name: "description",
        content:
          "Transform existing assessments into adaptive oral assessments that verify authentic understanding.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LecturerDashboardPage,
});
