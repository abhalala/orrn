import { createFileRoute } from "@tanstack/react-router";

import { LabelSheet } from "@/features/pack/label-sheet";

/**
 * `/pack/$id/labels`: the A4 sticker sheet of a packing session, for plants with no label printer
 * connected. `?serial=` limits it to one bundle. Not nested under `/pack/$id` (trailing underscore).
 */
export const Route = createFileRoute("/_tenant/pack_/$id_/labels")({
  validateSearch: (search: Record<string, unknown>): { serial?: string } =>
    typeof search.serial === "string" && search.serial.trim() ? { serial: search.serial.trim().slice(0, 200) } : {},
  component: LabelSheetPage,
});

function LabelSheetPage() {
  const { id } = Route.useParams();
  const { serial } = Route.useSearch();
  return <LabelSheet groupId={id} only={serial} />;
}
