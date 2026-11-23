import { createFileRoute } from "@tanstack/react-router";

import { RecruitmentPage } from "@/features/hr/recruitment-page";

export const Route = createFileRoute("/_tenant/hr/recruitment")({
  component: RecruitmentPage,
});
