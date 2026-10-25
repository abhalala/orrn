import { createFileRoute } from "@tanstack/react-router";

import { OvensPage } from "@/features/ageing/masters-pages";

export const Route = createFileRoute("/_tenant/masters/ovens")({
  component: OvensPage,
});
