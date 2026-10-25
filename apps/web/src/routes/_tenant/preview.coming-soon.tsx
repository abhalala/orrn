import { useT } from "@orrn/i18n";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Honest placeholder for the module still being built elsewhere (ageing). No fixture screens.
 * Foundry is built: `?module=foundry`, or a missing module, no longer says it is coming and goes
 * to the real casts screen.
 */
export const Route = createFileRoute("/_tenant/preview/coming-soon")({
  validateSearch: (search: Record<string, unknown>): { module?: "ageing" | "foundry" } => ({
    module: search.module === "ageing" ? "ageing" : search.module === "foundry" ? "foundry" : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (search.module === "foundry") throw redirect({ to: "/casts", replace: true });
  },
  component: ComingSoon,
});

function ComingSoon() {
  const { t } = useT();
  return (
    <>
      <PageHeader title={t("comingSoon.ageing")} />
      <EmptyState title={t("comingSoon.title")} body={t("comingSoon.body")} />
    </>
  );
}
