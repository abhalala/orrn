import { createFileRoute } from "@tanstack/react-router";

import { DocumentsPage } from "@/features/masters/documents-page";

export const Route = createFileRoute("/_tenant/masters/documents")({
  component: DocumentsPage,
});
