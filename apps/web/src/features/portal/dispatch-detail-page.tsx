import { packingListModel, safeParsePackingListSnapshot } from "@orrn/documents/packing-list/model";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { PageHeader } from "@orrn/ui/components/page-header";
import { useQuery } from "@tanstack/react-query";
import { FileDown, Printer, ScrollText } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PackingListBody } from "@/features/dispatch/packing-list-view";
import { RouterLink } from "@/shared/components/router-link";
import { downloadPackingListPdf } from "@/shared/lib/exports";
import { isNotFound } from "@/shared/lib/session-errors";
import { trpc } from "@/shared/utils/trpc";

import { usePortalMe } from "./hooks";
import { kgText, pcsText } from "./model";
import { dateText, PortalError, PortalSkeleton } from "./ui";

/**
 * `/portal/dispatches/$id`: the packing list the party received, as the plant printed it, without
 * cast numbers (Q39). PDF and print come from the same renderers the plant uses; the test
 * certificate opens next to it once the plant has issued one.
 */
export function PortalDispatchDetailPage({ id }: { id: string }) {
  const { t, locale } = useT();
  const me = usePortalMe();
  const zone = me.data?.timeZone ?? "Asia/Kolkata";
  const dispatch = useQuery({ ...trpc.portal.dispatches.get.queryOptions({ id }), retry: false });
  const pl = useQuery({ ...trpc.portal.packingList.get.queryOptions({ dispatchId: id }), retry: false, enabled: dispatch.data?.hasPackingList === true });
  const parsed = useMemo(() => (pl.data ? safeParsePackingListSnapshot(pl.data.snapshot) : null), [pl.data]);
  const model = useMemo(() => (parsed?.success ? packingListModel(parsed.data, { timeZone: zone }) : null), [parsed, zone]);
  const [downloading, setDownloading] = useState(false);
  const back = { to: "/portal/dispatches", label: t("portal.dispatches.title") };

  if (dispatch.isError) {
    return (
      <>
        <PageHeader title={t("portal.dispatches.title")} back={back} />
        <PortalError error={dispatch.error} onRetry={isNotFound(dispatch.error) ? undefined : () => void dispatch.refetch()} />
      </>
    );
  }
  const d = dispatch.data;
  if (!d) {
    return (
      <>
        <PageHeader title={t("portal.dispatches.title")} back={back} />
        <PortalSkeleton />
      </>
    );
  }

  async function downloadPdf() {
    if (!pl.data || !parsed?.success) return;
    setDownloading(true);
    try {
      await downloadPackingListPdf(parsed.data, pl.data.code, { timeZone: zone });
    } catch {
      toast.error(t("packingList.downloadFailed"));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <PageHeader
        title={d.code}
        back={back}
        subtitle={[dateText(d.completedAt, locale, zone), d.vehicleNo ? `${t("portal.dispatches.vehicle")}: ${d.vehicleNo}` : null].filter(Boolean).join(" · ")}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            {model ? (
              <>
                <Button variant="secondary" loading={downloading} onClick={() => void downloadPdf()}>
                  <FileDown aria-hidden="true" strokeWidth={2} />
                  {t("portal.dispatches.downloadPl")}
                </Button>
                <Button variant="secondary" onClick={() => window.print()}>
                  <Printer aria-hidden="true" strokeWidth={2} />
                  {t("portal.dispatches.print")}
                </Button>
              </>
            ) : null}
            {d.hasCertificate ? (
              <Button asChild>
                <RouterLink to={`/portal/certificate/${d.id}`}>
                  <ScrollText aria-hidden="true" strokeWidth={2} />
                  {t("portal.dispatches.viewCertificate")}
                </RouterLink>
              </Button>
            ) : null}
          </div>
        }
      />
      <p className="m-0 font-display text-[22px] font-bold tabular-nums" data-testid="portal-dispatch-totals">
        {t("portal.dispatches.totals", { bundles: d.totals.bundles, pcs: pcsText(d.totals.pcs), kg: kgText(d.totals.weightG) })}
      </p>
      <section aria-labelledby="portal-pl" className="flex min-w-0 flex-col gap-3">
        <h2 id="portal-pl" className="m-0 font-display text-[22px] font-bold tracking-[-0.03em]">
          {t("packingList.title")}
        </h2>
        {!d.hasPackingList ? (
          <p className="m-0 text-[15px] text-muted-foreground">{t("portal.dispatches.noPl")}</p>
        ) : pl.isError ? (
          <PortalError error={pl.error} onRetry={() => void pl.refetch()} />
        ) : !pl.data ? (
          <PortalSkeleton rows={2} />
        ) : model ? (
          <PackingListBody model={model} code={pl.data.code} />
        ) : (
          <p className="m-0 text-[15px] text-muted-foreground">{t("packingList.loadError")}</p>
        )}
      </section>
    </>
  );
}
