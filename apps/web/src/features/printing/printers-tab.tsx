import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Printer, RotateCw } from "lucide-react";
import { useMemo, useState } from "react";

import { useCompanyWhen } from "@/features/stock/use-company-when";
import { trpc } from "@/shared/utils/trpc";

import { labelDocumentFromSchema } from "./label-studio-model";
import { PRINT_COMPUTER_REFRESH_MS } from "./print-computer";
import { PrinterCard, type PrinterDesign } from "./printers-card";
import { PrintComputerSection } from "./printers-computer";
import { preferencesDraft, printerReportOf } from "./printers-model";
import { PrinterSettingsSheet } from "./printers-settings-sheet";
import { useLabelSample } from "./use-label-sample";

/**
 * Printers: the print computer as it last reported (`edge.overview`), then each label printer
 * (`spool.listProfiles`) with its status from the computer's printer report (`spool.listPrinters`) and the label it
 * prints, drawn from its published design with the newest bundle's values. Nothing here is a live check.
 */
export function PrintersTab() {
  const { t } = useT();
  const when = useCompanyWhen();
  const nodes = useQuery({ ...trpc.edge.overview.queryOptions(), refetchInterval: PRINT_COMPUTER_REFRESH_MS });
  const profiles = useQuery(trpc.spool.listProfiles.queryOptions());
  // No active print computer answers NOT_FOUND: every printer then reads "Not reported", which is the truth.
  const reports = useQuery({ ...trpc.spool.listPrinters.queryOptions(), retry: false, refetchInterval: PRINT_COMPUTER_REFRESH_MS, meta: { inlineError: true } });
  const documents = useQuery(trpc.spool.labelDocuments.list.queryOptions());
  const sample = useLabelSample();
  const [settingsFor, setSettingsFor] = useState<string | null>(null);

  const designs = useMemo(() => {
    const byId = new Map<string, PrinterDesign>();
    for (const row of documents.data ?? []) {
      byId.set(row.id, row.schema ? { kind: "ready", document: labelDocumentFromSchema(row.schema), version: row.version } : { kind: "missing" });
    }
    return byId;
  }, [documents.data]);

  if (nodes.isPending || profiles.isPending) return <PrintersSkeleton />;

  if (nodes.isError || profiles.isError) {
    return (
      <div className="rounded-card border border-border bg-card" role="alert">
        <EmptyState
          title={t("printing.loadFailed")}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                void nodes.refetch();
                void profiles.refetch();
              }}
            >
              <RotateCw aria-hidden="true" strokeWidth={2} />
              {t("common.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  const nodeRows = nodes.data.nodes;
  const profileRows = profiles.data;

  if (nodeRows.length === 0 && profileRows.length === 0) {
    return (
      <div className="rounded-card border border-border bg-card">
        <EmptyState icon={<Printer aria-hidden="true" strokeWidth={2} />} title={t("printing.notSetUpTitle")} body={t("printing.notSetUpBody")} />
      </div>
    );
  }

  const designFor = (templateId: string): PrinterDesign =>
    documents.isPending ? { kind: "loading" } : (designs.get(templateId) ?? { kind: "missing" });
  const editing = profileRows.find((profile) => profile.id === settingsFor) ?? null;
  const editingDesign = editing ? designFor(editing.templateId) : null;

  return (
    <div className="flex min-w-0 flex-col gap-7">
      <PrintComputerSection nodes={nodeRows} when={when} nowMs={Date.now()} />

      <section aria-labelledby="label-printers-heading" className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="label-printers-heading" className="m-0 text-[17px] font-semibold">
            {t("printing.printers.title")}
          </h2>
          {profileRows.length > 0 ? (
            <span className="text-[13px] text-muted-foreground">{t("printing.printers.count", { count: profileRows.length })}</span>
          ) : null}
        </div>
        {profileRows.length === 0 ? (
          <div className="rounded-card border border-border bg-card">
            <EmptyState icon={<Printer aria-hidden="true" strokeWidth={2} />} title={t("printing.printers.empty")} body={t("printing.printers.emptyBody")} />
          </div>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {profileRows.map((profile) => (
              <PrinterCard
                key={profile.id}
                profile={profile}
                report={printerReportOf(reports.data, profile.spoolPrinterId)}
                design={designFor(profile.templateId)}
                sample={sample}
                when={when}
                onOpenSettings={() => setSettingsFor(profile.id)}
              />
            ))}
          </ul>
        )}
      </section>

      <p className="m-0 max-w-[68ch] text-[13px] leading-5 text-muted-foreground">{t("printing.nodes.hint")}</p>

      {editing ? (
        <PrinterSettingsSheet
          key={editing.id}
          profile={editing}
          initial={preferencesDraft(editing, editingDesign?.kind === "ready" ? editingDesign.document.page : null)}
          onClose={() => setSettingsFor(null)}
        />
      ) : null}
    </div>
  );
}

/** Shaped like the page: the status block, what is attached to it, then a printer with its label. */
function PrintersSkeleton() {
  return (
    <div className="flex min-w-0 flex-col gap-7" aria-busy="true">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-36 rounded-full" />
        <Skeleton className="h-44 w-full rounded-[22px]" />
        <Skeleton className="h-16 w-full rounded-card" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-32 rounded-full" />
        <div className="grid grid-cols-1 overflow-hidden rounded-card border border-border bg-card lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="flex flex-col gap-4 p-5">
            <Skeleton className="h-5 w-40 rounded-full" />
            <Skeleton className="h-6 w-24 rounded-full" />
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
          <div className="bg-surface-sunken p-5">
            <Skeleton className="aspect-[4/3] w-full max-w-[22rem] rounded-[3px]" />
          </div>
        </div>
      </div>
    </div>
  );
}
