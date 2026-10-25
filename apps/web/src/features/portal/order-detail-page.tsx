import { formatLength } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { PageHeader } from "@orrn/ui/components/page-header";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { useQuery } from "@tanstack/react-query";

import { trpc } from "@/shared/utils/trpc";

import { usePortalMe } from "./hooks";
import { isPortalOrderStatus, kgText, pcsText, PORTAL_STATUS_TONE, sectionTitle } from "./model";
import { bookDate, PortalError, PortalSkeleton } from "./ui";

/** `/portal/orders/$id`: ordered, dispatched and baki per line. Never a rate, a copy or a tier. */
export function PortalOrderDetailPage({ id }: { id: string }) {
  const { t, locale } = useT();
  const me = usePortalMe();
  const q = useQuery({ ...trpc.portal.orders.get.queryOptions({ id }), retry: false });
  const unit = me.data?.lengthUnit ?? "mm";
  const back = { to: "/portal/orders", label: t("portal.orders.title") };
  if (q.isError) {
    return (
      <>
        <PageHeader title={t("portal.orders.title")} back={back} />
        <PortalError error={q.error} onRetry={() => void q.refetch()} />
      </>
    );
  }
  const o = q.data;
  if (!o) {
    return (
      <>
        <PageHeader title={t("portal.orders.title")} back={back} />
        <PortalSkeleton />
      </>
    );
  }
  const status = isPortalOrderStatus(o.status) ? o.status : null;
  return (
    <>
      <PageHeader
        title={o.number}
        back={back}
        subtitle={[bookDate(o.orderDate, locale), o.poNumber ? `${t("portal.orders.poNumber")}: ${o.poNumber}` : null].filter(Boolean).join(" · ")}
        actions={
          status ? (
            <Chip tone={PORTAL_STATUS_TONE[status]} truncate={false}>
              {t(`portal.orders.status.${status}`)}
            </Chip>
          ) : undefined
        }
      />
      {status === "booking" ? (
        <p role="status" className="m-0 rounded-card border border-border bg-card p-4 text-[15px] font-medium">
          {t("portal.orders.waiting")}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatusBlock tone="neutral" title={t("portal.orders.ordered")} value={o.totals.orderedG / 1000} unit={t("units.kg")} format={(n) => kgText(Math.round(n * 1000))} countUp={false} />
        <StatusBlock tone="blue" title={t("portal.orders.dispatched")} value={o.totals.dispatchedG / 1000} unit={t("units.kg")} format={(n) => kgText(Math.round(n * 1000))} countUp={false} />
        <StatusBlock tone="amber" title={t("portal.orders.baki")} value={o.totals.bakiG / 1000} unit={t("units.kg")} format={(n) => kgText(Math.round(n * 1000))} countUp={false} />
      </div>
      {o.note ? <p className="m-0 text-[15px] break-words text-muted-foreground">{o.note}</p> : null}
      <section aria-labelledby="portal-lines" className="flex min-w-0 flex-col gap-3">
        <h2 id="portal-lines" className="m-0 font-display text-[22px] font-bold tracking-[-0.03em]">
          {t("portal.orders.lines")}
        </h2>
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2" data-testid="portal-order-lines">
          {o.lines.map((l) => (
            <li key={l.lineNo} className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4" data-line={l.lineNo}>
              <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
                <p className="m-0 text-[16px] font-semibold break-words">
                  {t("portal.orders.lineNo", { n: l.lineNo })} · {sectionTitle(l)}
                </p>
                <p className="m-0 font-mono text-[14px] tabular-nums">{formatLength(l.cutLengthMm, unit)}</p>
              </div>
              <dl className="m-0 grid grid-cols-3 gap-3">
                {[
                  { k: "ordered", g: l.orderedG, p: l.orderedPcs },
                  { k: "dispatched", g: l.dispatchedG, p: l.dispatchedPcs },
                  { k: "baki", g: l.bakiG, p: l.bakiPcs },
                ].map((c) => (
                  <div key={c.k} className="min-w-0">
                    <dt className="text-xs font-medium text-muted-foreground">{t(`portal.orders.${c.k as "ordered"}`)}</dt>
                    <dd data-no-truncate="" className="m-0 mt-0.5 font-mono text-[14px] font-semibold tabular-nums">
                      {kgText(c.g)} {t("units.kg")}
                      {c.p != null ? <span className="block text-xs font-normal text-muted-foreground">{pcsText(c.p)} {t("units.pcs")}</span> : null}
                    </dd>
                  </div>
                ))}
              </dl>
              {l.note ? <p className="m-0 text-[13px] break-words text-muted-foreground">{l.note}</p> : null}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
