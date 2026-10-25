import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useEffect } from "react";

import { CastBlock } from "@/features/portal/certificate-page";
import { ppmPercentText, type CertCast } from "@/features/portal/model";
import { kgFromG } from "@/features/press/model";
import { useCompanyWhen } from "@/features/stock/use-company-when";
import { useMe } from "@/shared/lib/me";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { latestVerdict } from "./cast-view";
import { clockText, dayText } from "./format";
import { mmToFtText } from "./melt-form";
import { castPeriodText, ELEMENT_LABEL, verdictTone } from "./model";
import { SpectroTable } from "./spectro-panel";
import { LoadFailed, Note, useTimeZone } from "./ui";

const RANK = { fail: 3, incomplete: 2, pass: 1 } as const;

const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 10mm; }
  html[data-cert-print] [data-slot="side-nav"],
  html[data-cert-print] [data-slot="tab-bar"],
  html[data-cert-print] [data-shell-chrome],
  html[data-cert-print] [data-slot="app-shell"] > a,
  html[data-cert-print] .cert-no-print { display: none !important; }
  html[data-cert-print] [data-slot="app-shell"],
  html[data-cert-print] [data-slot="app-shell"] > div { display: block !important; min-height: 0 !important; }
  html[data-cert-print] main > div { max-width: none !important; padding: 0 !important; }
}
`;

/**
 * `/casts/$id/certificate` (FP-FD-18): the staff copy of a cast's test certificate. Number, alloy,
 * furnace, each melt with its times and spectro against the limits, the logs, and the bundles that
 * cite the cast (members only). A failed reading prints as FAIL; there is no way to mark it passed.
 * Not linked from the public bundle page, not a tax document.
 */
export function CertificateScreen({ id }: { id: string }) {
  const { t } = useT();
  const tz = useTimeZone();
  const when = useCompanyWhen();
  const { data: me } = useMe();
  const cast = useQuery({ ...trpc.foundry.casts.get.queryOptions({ id }), meta: INLINE_ERROR_META });
  const trace = useQuery({ ...trpc.foundry.casts.trace.queryOptions({ castId: id }), meta: INLINE_ERROR_META });
  const alloys = useQuery({ ...trpc.foundry.alloys.list.queryOptions(), meta: INLINE_ERROR_META });
  const furnaces = useQuery({ ...trpc.foundry.furnaces.list.queryOptions(), meta: INLINE_ERROR_META });
  useEffect(() => {
    document.documentElement.dataset.certPrint = "1";
    return () => {
      delete document.documentElement.dataset.certPrint;
    };
  }, []);
  const back = { to: `/casts/${id}`, label: t("foundry.cast.back") };
  if (showsQueryError(cast)) return <><PageHeader title={t("foundry.cert.title")} back={back} /><LoadFailed title={t("foundry.cast.loadFailed")} onRetry={() => void cast.refetch()} /></>;
  const data = cast.data;
  if (!data) return <><PageHeader title={t("foundry.cert.title")} back={back} /><Skeleton className="h-64 rounded-card" /></>;
  const c = data.cast;
  const live = data.melts.filter((m) => m.status === "locked");
  const alloy = alloys.data?.items.find((a) => a.id === c.alloyId) ?? alloys.data?.items.find((a) => a.code === c.alloy);
  const limits = alloy?.limits ?? [];
  const verdicts = live.map((m) => ({ m, v: latestVerdict(m.spectro) }));
  const worst = verdicts.reduce<"pass" | "fail" | "incomplete" | null>((w, x) => (x.v && (!w || RANK[x.v] > RANK[w]) ? x.v : w), null);
  const missing = verdicts.filter((x) => x.v === null).map((x) => x.m.seq);
  const company = me?.company;
  const best = verdicts.filter((x) => x.v === worst && x.v !== null).at(-1)?.m;
  const bestResult = best ? [...best.spectro].reverse().find((s) => !s.voidedAt) : undefined;
  const castBlock: CertCast = {
    castNo: c.number,
    alloy: c.alloy,
    status: worst === "fail" ? "failed" : bestResult ? "tested" : "pending",
    verdict: worst,
    bundles: trace.data?.bundles.length ?? 0,
    pcs: 0,
    weightG: trace.data?.bundles.reduce((s, b) => s + (b.weightG ?? 0), 0) ?? 0,
    sectionCodes: [],
    alBalance: bestResult?.alSource === "balance",
    elements: bestResult
      ? Object.entries(bestResult.values ?? {}).map(([k, v]) => ({ element: ELEMENT_LABEL[k as keyof typeof ELEMENT_LABEL] ?? k.toUpperCase(), ppm: Math.round((v as number) * 10_000), pct: ppmPercentText(Math.round((v as number) * 10_000)) }))
      : [],
  };
  const furnaceCodes = [...new Set(live.map((m) => furnaces.data?.items.find((f) => f.id === m.furnaceId)?.code).filter(Boolean))];
  return (
    <>
      <style>{PRINT_CSS}</style>
      <PageHeader
        title={t("foundry.cert.title")}
        back={back}
        subtitle={t("foundry.cert.staffCopy")}
        actions={
          <Button className="cert-no-print" onClick={() => window.print()} data-testid="cert-print">
            <Printer aria-hidden="true" className="size-4" />
            {t("common.print")}
          </Button>
        }
      />
      {missing.length > 0 ? <Note tone="amber" testId="cert-no-spectro">{t("foundry.cert.noSpectro", { melts: missing.join(", ") })}</Note> : null}
      <article aria-label={t("foundry.cert.title")} className="flex min-w-0 flex-col gap-5 rounded-card border border-border bg-card p-4 sm:p-6" data-testid="cast-certificate" data-verdict={worst ?? ""}>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 font-display text-[20px] leading-tight font-bold break-words">{company?.name}</p>
            <p className="m-0 text-[13px] text-muted-foreground">{t("foundry.cert.title")}</p>
          </div>
          {worst ? (
            <Chip tone={verdictTone(worst)} truncate={false} className={`text-[16px] font-bold ${worst === "fail" ? "uppercase" : ""}`} data-testid="cert-verdict">
              {worst === "fail" ? t("foundry.cert.fail") : t(`foundry.spectro.verdict.${worst}`)}
            </Chip>
          ) : (
            <Chip tone="neutral" truncate={false} data-testid="cert-verdict">{t("foundry.spectro.none")}</Chip>
          )}
        </div>
        <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {[
            { k: t("foundry.casts.columns.cast"), v: c.number, mono: true },
            { k: t("foundry.casts.columns.alloy"), v: c.alloy, mono: true },
            { k: t("foundry.melt.furnace"), v: furnaceCodes.join(", ") || "-", mono: true },
            { k: t("foundry.cert.period"), v: castPeriodText(c.year, c.month) },
          ].map((f) => (
            <div key={f.k} className="min-w-0">
              <dt className="text-[13px] text-muted-foreground">{f.k}</dt>
              <dd className={`m-0 text-[15px] font-semibold break-words ${f.mono ? "font-mono" : ""}`}>{f.v}</dd>
            </div>
          ))}
        </dl>

        {live.map((m) => {
          const result = [...m.spectro].reverse().find((s) => !s.voidedAt);
          const logs = m.outputs.filter((o) => o.kind === "logs");
          return (
            <section key={m.id} aria-label={t("foundry.melt.number", { n: m.seq })} className="flex min-w-0 flex-col gap-2 border-t border-border pt-4" data-melt={m.seq}>
              <h2 className="m-0 flex flex-wrap items-baseline gap-x-3 text-[16px] font-semibold">
                {t("foundry.melt.number", { n: m.seq })}
                <span className="text-[13px] font-normal text-muted-foreground">
                  {m.chargingStartAt && m.castingEndAt ? `${dayText(new Date(m.chargingStartAt).getTime(), tz)} ${clockText(new Date(m.chargingStartAt).getTime(), tz)} - ${clockText(new Date(m.castingEndAt).getTime(), tz)}` : ""}
                </span>
              </h2>
              <p className="m-0 text-[14px] tabular-nums">
                {logs.map((l) => t("foundry.melt.out.logLine", { pcs: l.pcs ?? 0, ft: mmToFtText(l.lengthMm), kg: kgFromG(l.kgG) })).join(" · ")}
              </p>
              {result ? (
                <>
                  <SpectroTable result={result} limits={limits} />
                  <p className="m-0 text-[12px] text-muted-foreground">{t("foundry.cert.limitsNote")}</p>
                </>
              ) : (
                <p className="m-0 text-[14px] font-medium text-tone-amber-ink">{t("foundry.cert.noSpectroMelt", { n: m.seq })}</p>
              )}
            </section>
          );
        })}

        {live.length > 0 && castBlock.status !== "pending" ? (
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2" aria-label={t("portal.certificate.chemistry")}>
            <CastBlock cast={castBlock} />
          </ul>
        ) : null}

        <section aria-labelledby="cert-bundles" className="flex min-w-0 flex-col gap-2 border-t border-border pt-4">
          <h2 id="cert-bundles" className="m-0 text-[16px] font-semibold">{t("foundry.cert.bundles")}</h2>
          {!trace.data ? (
            <Skeleton className="h-10 rounded-card" />
          ) : trace.data.bundles.length === 0 ? (
            <EmptyState title={t("foundry.cert.noBundles")} />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[14px]" data-testid="cert-bundle-list">
              {trace.data.bundles.map((b) => (
                <li key={b.id} className="flex flex-wrap gap-x-3 tabular-nums">
                  <span className="font-mono font-semibold">{b.serial}</span>
                  <span>{kgFromG(b.weightG ?? 0)} {t("units.kg")}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <p className="m-0 border-t border-border pt-3 text-[13px] text-muted-foreground">{t("foundry.cert.footer", { date: when(Date.now()) })}</p>
      </article>
    </>
  );
}
