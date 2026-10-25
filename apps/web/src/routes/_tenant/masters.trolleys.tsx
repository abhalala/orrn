import { createFileRoute } from "@tanstack/react-router";

import { TrolleysPage } from "@/features/ageing/masters-pages";

export const Route = createFileRoute("/_tenant/masters/trolleys")({
  component: TrolleysPage,
});
