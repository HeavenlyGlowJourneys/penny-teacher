import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { canUsePrepCheck } from "@/features/prep-check/access";
import { PrepCheckLibraryPage } from "@/features/prep-check/pages/PrepCheckLibraryPage";

const searchSchema = z.object({
  subjectId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
});

export const Route = createFileRoute("/tools/prep-check/library")({
  ssr: false,
  validateSearch: (search) => searchSchema.parse(search),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    if (!canUsePrepCheck(data.user.email)) throw redirect({ to: "/" });
  },
  head: () => ({
    meta: [
      { title: "Library — Prep Check" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PrepCheckLibraryPage,
});
