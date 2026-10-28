import { createFileRoute } from "@tanstack/react-router";

import { LabelStudio } from "@/features/printing/label-studio";

export const Route = createFileRoute("/_tenant/printing/templates/$templateId")({
  component: LabelStudioRoute,
});

function LabelStudioRoute() {
  const { templateId } = Route.useParams();
  return <LabelStudio templateId={templateId} />;
}
