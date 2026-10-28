import { useT } from "@orrn/i18n";
import { HowToButton } from "@orrn/ui/components/how-to-button";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Tabs } from "@orrn/ui/components/tabs";
import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { Info } from "lucide-react";
import { useEffect, useState } from "react";

import { LabelsTab } from "@/features/printing/labels-tab";
import {
  PRINT_TABS,
  parsePage,
  parsePrintStatus,
  parsePrintTab,
  type PrintStatus,
  type PrintTab,
} from "@/features/printing/model";
import { PRINT_COMPUTER_REFRESH_MS } from "@/features/printing/print-computer";
import { PrintersTab } from "@/features/printing/printers-tab";
import { PrintingSummary } from "@/features/printing/printing-summary";
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
 * `/printing` (was `/spool`): a summary strip (what needs a retry, what waits, what printed, whether the print computer
 * reports in), then Queue (retry or cancel jobs), Printers (print computers and label printers) and Labels (reprint
 * entry, label designs). Everything shown comes from stored rows; nothing is checked live.
 */
function PrintingPage() {
  const { t } = useT();
  const location = useLocation();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/printing" });
  const tab = search.tab ?? "queue";
  // One clock for the page: relative times and the print computer's state move on while it stays open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), PRINT_COMPUTER_REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  if (location.pathname.startsWith("/printing/templates/")) return <Outlet />;

  return (
    <>
      <PageHeader title={t("printing.title")} subtitle={t("printing.subtitle")} actions={<HowToButton slug="printer-trouble" />} />
      <PrintingSummary tab={tab} status={search.status} now={now} />
      <Can
        do="spool.manage_jobs"
        fallback={
          <p
            data-testid="printing-restricted"
            className="m-0 flex min-w-0 items-start gap-2.5 rounded-card bg-surface-sunken px-4 py-3 text-[14px] leading-6 text-muted-foreground"
          >
            <Info aria-hidden="true" strokeWidth={2} className="mt-1 size-4 shrink-0" />
            <span className="min-w-0">{t("printing.restricted")}</span>
          </p>
        }
      >
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
            now={now}
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
