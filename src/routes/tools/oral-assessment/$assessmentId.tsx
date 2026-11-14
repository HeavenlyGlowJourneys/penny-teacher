import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { canUseOralAssessment } from "@/features/oral-assessment";
import { AssessmentDetailPage } from "@/features/oral-assessment/pages/AssessmentDetailPage";

export const Route = createFileRoute("/tools/oral-assessment/$assessmentId")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    if (!canUseOralAssessment(data.user.email)) throw redirect({ to: "/" });
  },
  head: () => ({
    meta: [
      { title: "Review — Oral Assessment" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AssessmentRoute,
});

function AssessmentRoute() {
  const { assessmentId } = Route.useParams();
  return <AssessmentDetailPage assessmentId={assessmentId} />;
}
