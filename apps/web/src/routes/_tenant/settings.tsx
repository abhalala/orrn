import { useT } from "@orrn/i18n";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Tabs } from "@orrn/ui/components/tabs";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { DEFAULT_SECTION, parseSectionId, SETTINGS_SECTIONS } from "@/features/settings/sections";
import { canAny, useMe } from "@/shared/lib/me";

export const Route = createFileRoute("/_tenant/settings")({
  // `/settings?tab=team` is where the old Members page now lives.
  // Kept free of the section components so the entry chunk doesn't pull them in; the page maps an
  // unknown value to the first section.
  validateSearch: (search: Record<string, unknown>): { tab?: string } =>
    typeof search.tab === "string" && search.tab !== "company" ? { tab: search.tab } : {},
  component: SettingsPage,
});

/** `/settings`: one tab per section in `SETTINGS_SECTIONS` the role may open (Company ... Data). */
function SettingsPage() {
  const { t } = useT();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/settings" });
  const { data: me } = useMe();
  const visible = SETTINGS_SECTIONS.filter((s) => !s.requires || canAny(me, s.requires));
  const tab = parseSectionId(search.tab, visible);
  const section = visible.find((s) => s.id === tab);

  return (
    <>
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />
      <Tabs
        label={t("settings.title")}
        value={tab}
        onValueChange={(next) => void navigate({ search: next === DEFAULT_SECTION ? {} : { tab: next } })}
        items={visible.map((s) => ({ id: s.id, label: t(s.labelKey) }))}
      >
        {section?.render()}
      </Tabs>
    </>
  );
}
