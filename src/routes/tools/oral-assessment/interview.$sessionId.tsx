import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { InterviewPage } from "@/features/oral-assessment/pages/InterviewPage";

export const Route = createFileRoute("/tools/oral-assessment/interview/$sessionId")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  head: () => ({
    meta: [
      { title: "Interview — Oral Assessment" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: InterviewRoute,
});

function InterviewRoute() {
  const { sessionId } = Route.useParams();
  return <InterviewPage sessionId={sessionId} />;
}
