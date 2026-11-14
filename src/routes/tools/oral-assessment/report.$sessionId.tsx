import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { ReportPage } from "@/features/oral-assessment/pages/ReportPage";

export const Route = createFileRoute("/tools/oral-assessment/report/$sessionId")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  head: () => ({
    meta: [
      { title: "Report — Oral Assessment" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReportRoute,
});

function ReportRoute() {
  const { sessionId } = Route.useParams();
  return <ReportPage sessionId={sessionId} />;
}
