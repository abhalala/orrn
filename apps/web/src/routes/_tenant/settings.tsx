import { useT } from "@orrn/i18n";
import { PageHeader } from "@orrn/ui/components/page-header";
import { createFileRoute } from "@tanstack/react-router";

import { DataTab } from "@/features/settings/data-tab";
import { RouteStub } from "@/shared/components/route-stub";

export const Route = createFileRoute("/_tenant/settings")({
  // `/settings?tab=team` is where the old Members page now lives.
  validateSearch: (search: Record<string, unknown>): { tab?: string } =>
    typeof search.tab === "string" ? { tab: search.tab } : {},
  component: SettingsScreen,
});

/**
 * Until Task 24 lands the tabbed Settings screen, only the Data tab
 * (`?tab=data`, Task 25) is real; the other tabs stay a stub.
 */
function SettingsScreen() {
  const { tab } = Route.useSearch();
  const { t } = useT();
  if (tab !== "data") return <RouteStub titleKey="settings.title" />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("settings.title")} subtitle={t("settings.tabs.data")} />
      <DataTab />
    </div>
  );
}
