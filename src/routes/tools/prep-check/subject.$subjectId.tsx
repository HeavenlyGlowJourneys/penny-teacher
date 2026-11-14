import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { canUsePrepCheck } from "@/features/prep-check/access";
import { PrepCheckSubjectDashboardPage } from "@/features/prep-check/pages/PrepCheckSubjectDashboardPage";

export const Route = createFileRoute("/tools/prep-check/subject/$subjectId")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    if (!canUsePrepCheck(data.user.email)) throw redirect({ to: "/" });
  },
  head: () => ({
    meta: [
      { title: "Subject — Prep Check" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PrepCheckSubjectDashboardPage,
});
