import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { canUseOralAssessment } from "@/features/oral-assessment";
import { CreateAssessmentPage } from "@/features/oral-assessment/pages/CreateAssessmentPage";

export const Route = createFileRoute("/tools/oral-assessment/create")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    if (!canUseOralAssessment(data.user.email)) throw redirect({ to: "/" });
  },
  head: () => ({
    meta: [
      { title: "Create — Oral Assessment" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CreateAssessmentPage,
});
