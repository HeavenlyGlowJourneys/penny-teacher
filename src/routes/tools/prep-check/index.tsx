import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { canUsePrepCheck, PrepCheckHubPage } from "@/features/prep-check";

export const Route = createFileRoute("/tools/prep-check/")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    if (!canUsePrepCheck(data.user.email)) throw redirect({ to: "/" });
  },
  head: () => ({
    meta: [
      { title: "Prep Check — Penny" },
      {
        name: "description",
        content: "AI curriculum planning checker for teachers and subject heads.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PrepCheckHubPage,
});
