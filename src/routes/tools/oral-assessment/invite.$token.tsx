import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { InviteAcceptPage } from "@/features/oral-assessment";

export const Route = createFileRoute("/tools/oral-assessment/invite/$token")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  head: () => ({
    meta: [
      { title: "Invitation — Oral Assessment" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: InviteRoute,
});

function InviteRoute() {
  const { token } = Route.useParams();
  return <InviteAcceptPage token={token} />;
}
