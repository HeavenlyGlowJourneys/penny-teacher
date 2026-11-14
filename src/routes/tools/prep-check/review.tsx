import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { canUsePrepCheck, PrepCheckReviewPage } from "@/features/prep-check";

const searchSchema = z.object({
  subjectId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
});

export const Route = createFileRoute("/tools/prep-check/review")({
  ssr: false,
  validateSearch: (search) => searchSchema.parse(search),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    if (!canUsePrepCheck(data.user.email)) throw redirect({ to: "/" });
  },
  head: () => ({
    meta: [
      { title: "Planning pack review — Prep Check" },
      {
        name: "description",
        content: "Upload a planning ZIP for Prep Check review.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PrepCheckReviewPage,
});
