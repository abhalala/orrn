import { useT } from "@orrn/i18n";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { createFileRoute } from "@tanstack/react-router";

type ComingSoonModule = "foundry" | "ageing";

/** Honest placeholder for the two modules still being built elsewhere. No fixture screens. */
export const Route = createFileRoute("/_tenant/preview/coming-soon")({
  validateSearch: (search: Record<string, unknown>): { module: ComingSoonModule } => ({
    module: search.module === "ageing" ? "ageing" : "foundry",
  }),
  component: ComingSoon,
});

function ComingSoon() {
  const { t } = useT();
  const { module } = Route.useSearch();
  return (
    <>
      <PageHeader title={t(module === "ageing" ? "comingSoon.ageing" : "comingSoon.foundry")} />
      <EmptyState title={t("comingSoon.title")} body={t("comingSoon.body")} />
    </>
  );
}
