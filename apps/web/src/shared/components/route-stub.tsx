import { useT, type MessageKey } from "@orrn/i18n";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";

/**
 * Placeholder for a screen whose task hasn't landed yet. The route and URL are
 * final; the screen replaces this stub. Remove each use as its screen ships.
 */
export function RouteStub({ titleKey }: { titleKey: MessageKey }) {
  const { t } = useT();
  return (
    <>
      <PageHeader title={t(titleKey)} />
      <EmptyState title={t("ui.stubTitle")} body={t("ui.stubBody")} />
    </>
  );
}
