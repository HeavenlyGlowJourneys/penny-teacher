import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { canUsePrepCheck } from "@/features/prep-check/access";
import { PrepCheckConfigPage } from "@/features/prep-check/pages/PrepCheckConfigPage";

export const Route = createFileRoute("/tools/prep-check/config")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    if (!canUsePrepCheck(data.user.email)) throw redirect({ to: "/" });
  },
  head: () => ({
    meta: [
      { title: "Configuration — Prep Check" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PrepCheckConfigPage,
});
