import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/class/$classId")({
  head: () => ({
    meta: [
      { title: "Class – Penny" },
      { name: "description", content: "Class overview in Penny — learners, assessments, term marks, and report comments." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <Outlet />,
});