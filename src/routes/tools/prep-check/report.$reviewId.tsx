import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { canUsePrepCheck } from "@/features/prep-check/access";
import { PrepCheckReportPage } from "@/features/prep-check/pages/PrepCheckReportPage";

export const Route = createFileRoute("/tools/prep-check/report/$reviewId")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    if (!canUsePrepCheck(data.user.email)) throw redirect({ to: "/" });
  },
  head: () => ({
    meta: [
      { title: "Report — Prep Check" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReportRoute,
});

function ReportRoute() {
  const { reviewId } = Route.useParams();
  return <PrepCheckReportPage reviewId={reviewId} />;
}
