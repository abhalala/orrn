import { useT } from "@orrn/i18n";
import { HowToButton } from "@orrn/ui/components/how-to-button";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Tabs } from "@orrn/ui/components/tabs";
import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";

import { LabelsTab } from "@/features/printing/labels-tab";
import {
  PRINT_TABS,
  parsePage,
  parsePrintStatus,
  parsePrintTab,
  type PrintStatus,
  type PrintTab,
} from "@/features/printing/model";
import { PrintersTab } from "@/features/printing/printers-tab";
import { QueueTab } from "@/features/printing/queue-tab";
import { Can } from "@/shared/components/can";

type PrintingSearch = { tab?: PrintTab; status?: PrintStatus; page?: number };

export const Route = createFileRoute("/_tenant/printing")({
  // Old `/spool` links land here (`shared/lib/redirects.ts`); anything unknown falls back to the queue.
  validateSearch: (search: Record<string, unknown>): PrintingSearch => {
    const tab = parsePrintTab(search.tab);
    return {
      ...(tab !== "queue" ? { tab } : {}),
      ...(tab === "queue" && parsePrintStatus(search.status) ? { status: parsePrintStatus(search.status) } : {}),
      ...(tab === "queue" && parsePage(search.page) ? { page: parsePage(search.page) } : {}),
    };
  },
  component: PrintingPage,
});

/**
 * `/printing` (was `/spool`): Queue (retry failed labels), Printers (print
 * computers and label printers) and Labels (reprint entry, label designs).
 * Everything shown comes from stored rows; nothing is checked live.
 */
function PrintingPage() {
  const { t } = useT();
  const location = useLocation();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/printing" });
  const tab = search.tab ?? "queue";

  if (location.pathname.startsWith("/printing/templates/")) return <Outlet />;

  return (
    <>
      <PageHeader
        title={t("printing.title")}
        subtitle={t("printing.subtitle")}
        actions={<HowToButton slug="printer-trouble" />}
      />
      <Can do="spool.manage_jobs" fallback={<p className="m-0 text-[14px] text-muted-foreground">{t("printing.restricted")}</p>}>
        {null}
      </Can>
      <Tabs
        label={t("printing.title")}
        value={tab}
        onValueChange={(next) => void navigate({ search: next === "queue" ? {} : { tab: next as PrintTab } })}
        items={PRINT_TABS.map((id) => ({ id, label: t(`printing.tabs.${id}`) }))}
      >
        {tab === "queue" ? (
          <QueueTab
            status={search.status}
            page={search.page ?? 1}
            onStatus={(status) => void navigate({ search: status ? { status } : {} })}
            onPage={(page) => void navigate({ search: { ...(search.status ? { status: search.status } : {}), ...(page > 1 ? { page } : {}) } })}
          />
        ) : null}
        {tab === "printers" ? <PrintersTab /> : null}
        {tab === "labels" ? <LabelsTab /> : null}
      </Tabs>
      <Outlet />
    </>
  );
}
