import { useT } from "@orrn/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { useQuery } from "@tanstack/react-query";

import { trpc } from "@/shared/utils/trpc";

import { bandPosition, kgPer12ftText, sectionMarker, sectionTitle } from "./model";
import { PortalError, PortalSkeleton } from "./ui";

/** `/portal/dies`: the sections the plant opened for this party and the ones it owns, with their copies. */
export function PortalDiesPage() {
  const { t } = useT();
  const q = useQuery({ ...trpc.portal.sections.visible.queryOptions(), retry: false });
  return (
    <>
      <PageHeader title={t("portal.dies.title")} subtitle={t("portal.dies.subtitle")} />
      {q.isError ? (
        <PortalError error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <PortalSkeleton />
      ) : q.data.length === 0 ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState title={t("portal.dies.empty")} />
        </div>
      ) : (
        <ul aria-label={t("portal.dies.title")} className="m-0 grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2" data-testid="portal-dies">
          {q.data.map((s) => {
            const marker = sectionMarker(s);
            return (
              <li key={s.id} className="min-w-0" data-section={s.sectionCode}>
                <Card className="h-full">
                  <CardHeader>
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                      <CardTitle className="min-w-0 break-words">{sectionTitle(s)}</CardTitle>
                      {marker ? (
                        <Chip tone={marker === "owned" ? "green" : "blue"} truncate={false}>
                          {t(marker === "owned" ? "portal.dies.owned" : "portal.dies.granted")}
                        </Chip>
                      ) : null}
                    </div>
                    <CardDescription>
                      {[s.name, s.profileKind, [s.alloy, s.temper].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}
                      {s.band ? ` · ${t("portal.dies.bandRange", { min: kgPer12ftText(s.band.minG), max: kgPer12ftText(s.band.maxG) })}` : ""}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {s.copies.length === 0 ? (
                      <p className="m-0 text-[14px] text-muted-foreground">{t("portal.dies.noCopies")}</p>
                    ) : (
                      <ul className="m-0 flex list-none flex-col gap-3 p-0">
                        {s.copies.map((c) => {
                          const pos = bandPosition(c.latestKgPer12ftMilli, c.band);
                          return (
                            <li key={c.id} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1" data-copy={c.code}>
                              <span className="font-mono text-[15px] font-semibold">
                                <span className="sr-only">{t("portal.dies.copy")} </span>
                                {c.code}
                              </span>
                              <span className="font-mono text-[14px] tabular-nums">
                                {c.latestKgPer12ftMilli == null ? (
                                  <span className="font-sans text-muted-foreground">{t("portal.dies.noReading")}</span>
                                ) : (
                                  `${kgPer12ftText(c.latestKgPer12ftMilli)} ${t("units.kgPer12ft")}`
                                )}
                              </span>
                              {pos ? (
                                <Chip tone={pos.position === "in" ? "green" : "amber"} truncate={false}>
                                  {pos.position === "in"
                                    ? t("portal.dies.inBand")
                                    : t(pos.position === "over" ? "portal.dies.overBand" : "portal.dies.underBand", { kg: kgPer12ftText(pos.offG) })}
                                </Chip>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
