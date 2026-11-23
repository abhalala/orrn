import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { useMe } from "@/shared/lib/me";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { usePaperFmt } from "@/shared/lib/fmt";
import { castLengthText, cutLengthText, kgGrouped1, paperT } from "@/shared/lib/fmt-text";
import { trpc } from "@/shared/utils/trpc";

import { buildTimeline, chemistryOfMelt, cutTotals, nameOf, tempSummary, tempText, toMs } from "./data-sheet-model";
import { clockText, dayText } from "./format";
import { castPeriodText, CAST_TONE, verdictTone, type CastStatus } from "./model";
import { rejectReasonText } from "./rejects-model";
import { yieldText } from "./billets-model";
import { SpectroTable } from "./spectro-panel";
import { LoadFailed, useTimeZone } from "./ui";

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
  html[data-cert-print] .sheet-block { break-inside: avoid; }
}
`;

const TH = "py-1 pr-3 text-left font-medium text-muted-foreground";
const TD = "py-1 pr-3 tabular-nums";

function Block({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="sheet-block flex min-w-0 flex-col gap-2 border-t border-border pt-4">
      <h2 id={id} className="m-0 text-[16px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/**
 * `/casts/$id/sheet` (row 45): the cast data sheet on A4. One cast, start to finish: the melts with furnace, charge,
 * weights, times, temperatures and chemistry against the alloy's limits; the logs out and any bought-in receipt;
 * homogenizing, cuts and rejects; and who did what. A paper: today's units and words whatever the plant chose.
 * Loaded on its own (a separate route file), never from the shared entry code.
 */
export function DataSheetScreen({ id }: { id: string }) {
  const fmt = usePaperFmt();
  const { t: tUi } = useT();
  const t = paperT(tUi);
  const tz = useTimeZone();
  const { data: me } = useMe();
  const cast = useQuery({ ...trpc.foundry.casts.get.queryOptions({ id }), meta: INLINE_ERROR_META });
  const sheet = useQuery({ ...trpc.foundry.casts.dataSheet.queryOptions({ id }), meta: INLINE_ERROR_META });
  const alloys = useQuery({ ...trpc.foundry.alloys.list.queryOptions(), meta: INLINE_ERROR_META });
  useEffect(() => {
    document.documentElement.dataset.certPrint = "1";
    return () => {
      delete document.documentElement.dataset.certPrint;
    };
  }, []);
  const back = { to: `/casts/${id}`, label: t("foundry.cast.back") };
  const title = t("fdy2.sheet.title");
  if (showsQueryError(cast) || showsQueryError(sheet)) {
    return <><PageHeader title={title} back={back} /><LoadFailed title={t("fdy2.sheet.loadFailed")} onRetry={() => { void cast.refetch(); void sheet.refetch(); }} /></>;
  }
  if (!cast.data || !sheet.data) return <><PageHeader title={title} back={back} /><Skeleton className="h-64 rounded-card" /></>;

  const c = cast.data.cast;
  const s = sheet.data;
  const live = cast.data.melts.filter((m) => m.status === "locked");
  const alloy = alloys.data?.items.find((a) => a.id === c.alloyId) ?? alloys.data?.items.find((a) => a.code === c.alloy);
  const limits = alloy?.limits ?? [];
  const day = (v: unknown) => { const ms = toMs(v as Date); return ms === null ? "-" : dayText(fmt, ms, tz); };
  const clock = (v: unknown) => { const ms = toMs(v as Date); return ms === null ? "-" : clockText(fmt, ms, tz); };
  const dayClock = (v: unknown) => { const ms = toMs(v as Date); return ms === null ? "-" : `${dayText(fmt, ms, tz)} ${clockText(fmt, ms, tz)}`; };
  const kg = (g: number) => t("fdy2.sheet.kgLine", { kg: kgGrouped1(fmt, g) });
  const who = (uid: string | null | undefined) => nameOf(s.people, uid);
  const timeline = buildTimeline({ melts: live, sheetMelts: s.melts, readings: s.readings, homog: s.homog, cuts: s.cuts, rejects: s.rejects });
  const cuts = cutTotals(s.cuts);
  const furnaceOf = (meltId: string) => s.melts.find((m) => m.id === meltId)?.furnace ?? null;
  const TIMES = ["preheatStartAt", "chargingStartAt", "chargingEndAt", "castingStartAt", "castingEndAt"] as const;
  const TIME_WORD = { preheatStartAt: "preheat", chargingStartAt: "chargingStart", chargingEndAt: "chargingEnd", castingStartAt: "castingStart", castingEndAt: "castingEnd" } as const;

  return (
    <>
      <style>{PRINT_CSS}</style>
      <PageHeader
        title={title}
        back={back}
        subtitle={t("fdy2.sheet.subtitle")}
        actions={
          <Button className="cert-no-print" onClick={() => window.print()} data-testid="sheet-print">
            <Printer aria-hidden="true" className="size-4" />
            {t("common.print")}
          </Button>
        }
      />
      <article aria-label={title} className="flex min-w-0 flex-col gap-5 rounded-card border border-border bg-card p-4 sm:p-6" data-testid="cast-data-sheet">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 font-display text-[20px] leading-tight font-bold break-words">{me?.company?.name}</p>
            <p className="m-0 text-[13px] text-muted-foreground">{title}</p>
          </div>
          <Chip tone={CAST_TONE[c.status as CastStatus] ?? "neutral"} truncate={false}>{t(`foundry.casts.status.${c.status as CastStatus}`)}</Chip>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {[
            { k: t("foundry.casts.columns.cast"), v: c.number, mono: true },
            ...(c.legacyCode ? [{ k: t("foundry.newCast.legacy"), v: c.legacyCode, mono: true }] : []),
            { k: t("foundry.casts.columns.alloy"), v: c.alloy, mono: true },
            { k: t("foundry.cert.period"), v: castPeriodText(c.year, c.month) },
            { k: t("fdy2.sheet.opened"), v: day(c.openedAt) },
            { k: t("fdy2.sheet.closed"), v: c.closedAt ? day(c.closedAt) : "-" },
            { k: t("fdy2.sheet.source"), v: t(s.source === "bought_in" ? "fdy2.sheet.sourceBought" : "fdy2.sheet.sourceMelt") },
            { k: t("fdy2.sheet.openedBy"), v: who(c.createdBy) },
          ].map((f) => (
            <div key={f.k} className="min-w-0">
              <dt className="text-[13px] text-muted-foreground">{f.k}</dt>
              <dd className={`m-0 text-[15px] font-semibold break-words ${"mono" in f && f.mono ? "font-mono" : ""}`}>{f.v}</dd>
            </div>
          ))}
        </dl>

        {s.receipt ? (
          <Block id="ds-receipt" title={t("fdy2.sheet.receipt.title")}>
            <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-2 text-[14px] sm:grid-cols-4" data-testid="sheet-receipt">
              {[
                [t("fdy2.sheet.receipt.number"), s.receipt.number],
                [t("fdy2.sheet.receipt.vendor"), s.receipt.vendorName],
                [t("fdy2.sheet.receipt.on"), s.receipt.receivedOn ? day(s.receipt.receivedOn) : "-"],
                [t("fdy2.sheet.receipt.vendorCast"), s.receipt.vendorCastNo ?? "-"],
                [t("fdy2.sheet.receipt.challan"), s.receipt.challanNo ?? "-"],
                [t("fdy2.sheet.receipt.logs"), t("fdy2.sheet.pcsKg", { pcs: s.receipt.pcs, kg: kgGrouped1(fmt, s.receipt.kgG) })],
                [t("fdy2.sheet.receipt.size"), t("fdy2.sheet.receipt.sizeLine", { dia: s.receipt.diameterMm ?? "-", len: s.receipt.lengthMm != null ? castLengthText(fmt, s.receipt.lengthMm) : "-" })],
                [t("fdy2.sheet.receipt.mtc"), t(s.receipt.hasMtc ? "fdy2.sheet.yes" : "fdy2.sheet.no")],
              ].map(([k, v]) => (
                <div key={k} className="min-w-0"><dt className="text-[12px] text-muted-foreground">{k}</dt><dd className="m-0 break-words font-medium">{v}</dd></div>
              ))}
            </dl>
          </Block>
        ) : null}

        {live.length === 0 && !s.receipt ? <p className="m-0 text-[14px] text-muted-foreground">{t("fdy2.sheet.noMelts")}</p> : null}
        {live.map((m) => {
          const chem = chemistryOfMelt(m.spectro, limits);
          const result = chem ? m.spectro.find((r) => r.id === chem.resultId) : undefined;
          const temps = tempSummary(s.readings, m.id);
          const fur = furnaceOf(m.id);
          const lots = m.inputs;
          const logs = m.outputs.filter((o) => o.kind === "logs");
          return (
            <Block key={m.id} id={`ds-melt-${m.seq}`} title={t("foundry.melt.number", { n: m.seq })}>
              <div className="flex flex-col gap-3" data-melt={m.seq}>
                <p className="m-0 text-[14px]">
                  <span className="text-muted-foreground">{t("foundry.melt.furnace")}: </span>
                  <span className="font-mono font-semibold">{fur ? fur.code : "-"}</span>
                  <span className="text-muted-foreground"> · {t("fdy2.sheet.lockedBy", { name: who(s.melts.find((x) => x.id === m.id)?.lockedBy ?? s.melts.find((x) => x.id === m.id)?.createdBy) })}</span>
                </p>
                <table className="w-full border-collapse text-[14px]" data-testid="sheet-times">
                  <thead><tr>{TIMES.map((k) => <th key={k} scope="col" className={TH}>{t(`fdy2.sheet.event.${TIME_WORD[k]}`)}</th>)}</tr></thead>
                  <tbody><tr>{TIMES.map((k) => <td key={k} className={TD}>{m[k] ? dayClock(m[k]) : "-"}</td>)}</tr></tbody>
                </table>

                <div>
                  <h3 className="m-0 mb-1 text-[14px] font-semibold">{t("fdy2.sheet.charge")}</h3>
                  <table className="w-full border-collapse text-[14px]" data-testid="sheet-charge">
                    <tbody>
                      {lots.map((i) => (
                        <tr key={i.line} className="border-b border-border last:border-0">
                          <td className="py-1 pr-3">{i.kind === "lot" ? [i.lotNumber, i.itemName, i.gradeCode].filter(Boolean).join(" · ") : `${i.streamCode ?? ""} ${i.streamName ?? ""}`.trim()}</td>
                          <td className={`${TD} text-right font-mono`}>{kg(i.kgG)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-2 text-[14px] sm:grid-cols-5" data-testid="sheet-weights">
                  {[
                    [t("fdy2.sheet.w.in"), kg(m.inputG)],
                    [t("fdy2.sheet.w.logs"), kg(m.logsG)],
                    [t("fdy2.sheet.w.dross"), kg(m.drossG)],
                    [t("fdy2.sheet.w.loss"), `${kg(m.lossG)} · ${(m.lossBp / 100).toFixed(1)} %`],
                    [t("fdy2.sheet.w.yield"), m.yieldBp != null ? `${yieldText(m.yieldBp)} %` : "-"],
                  ].map(([k, v]) => (
                    <div key={k} className="min-w-0"><dt className="text-[12px] text-muted-foreground">{k}</dt><dd className="m-0 font-mono font-semibold tabular-nums">{v}</dd></div>
                  ))}
                </dl>

                <p className="m-0 text-[14px]" data-testid="sheet-temps">
                  <span className="text-muted-foreground">{t("fdy2.sheet.temps")}: </span>
                  {temps ? t("fdy2.sheet.tempsLine", { n: temps.n, min: tempText(temps.minX10), max: tempText(temps.maxX10) }) : t("fdy2.sheet.noTemps")}
                </p>

                {logs.length > 0 ? (
                  <p className="m-0 text-[14px] tabular-nums" data-testid="sheet-logs">
                    <span className="text-muted-foreground">{t("fdy2.sheet.logsOut")}: </span>
                    {logs.map((l) => t("foundry.melt.out.logLine", { pcs: l.pcs ?? 0, ft: castLengthText(fmt, l.lengthMm), kg: kgGrouped1(fmt, l.kgG) })).join(" · ")}
                  </p>
                ) : null}

                <div data-testid="sheet-chemistry">
                  <h3 className="m-0 mb-1 flex flex-wrap items-center gap-2 text-[14px] font-semibold">
                    {t("fdy2.sheet.chemistry")}
                    {chem ? (
                      <Chip tone={verdictTone(chem.verdict)} truncate={false} data-testid="sheet-verdict">
                        {chem.outside.length > 0 ? t("fdy2.sheet.outside", { count: chem.outside.length }) : t("fdy2.sheet.inLimits")}
                      </Chip>
                    ) : null}
                  </h3>
                  {result ? <SpectroTable result={result} limits={limits} /> : <p className="m-0 text-[14px] font-medium text-tone-amber-ink">{t("fdy2.sheet.noSpectro")}</p>}
                </div>
              </div>
            </Block>
          );
        })}

        {s.homog.length > 0 ? (
          <Block id="ds-homog" title={t("fdy2.sheet.homog.title")}>
            <table className="w-full border-collapse text-[14px]" data-testid="sheet-homog">
              <thead><tr>{(["batch", "temp", "soak", "in", "out", "pcs", "by"] as const).map((k) => <th key={k} scope="col" className={TH}>{t(`fdy2.sheet.homog.col.${k}`)}</th>)}</tr></thead>
              <tbody>
                {s.homog.map((h, i) => (
                  <tr key={`${h.number}-${i}`} className="border-b border-border last:border-0">
                    <td className={`${TD} font-mono font-semibold`}>{h.number}</td>
                    <td className={TD}>{t("fdy2.sheet.celsius", { temp: tempText(h.targetTempX10) })}</td>
                    <td className={TD}>{t("fdy2.sheet.minutes", { done: h.soakedMin ?? 0, plan: h.soakMin })}</td>
                    <td className={TD}>{dayClock(h.inAt)}</td>
                    <td className={TD}>{dayClock(h.outAt)}</td>
                    <td className={TD}>{t("fdy2.sheet.pcsKg", { pcs: h.pcs, kg: kgGrouped1(fmt, h.kgG) })}</td>
                    <td className={TD}>{who(h.releasedBy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Block>
        ) : null}

        {s.cuts.length > 0 ? (
          <Block id="ds-cuts" title={t("fdy2.sheet.cuts.title")}>
            <table className="w-full border-collapse text-[14px]" data-testid="sheet-cuts">
              <thead><tr>{(["at", "machine", "logs", "length", "billets", "end", "yield", "by"] as const).map((k) => <th key={k} scope="col" className={TH}>{t(`fdy2.sheet.cuts.col.${k}`)}</th>)}</tr></thead>
              <tbody>
                {s.cuts.map((x, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className={TD}>{dayClock(x.cutAt)}</td>
                    <td className={TD}>{t(`fdy2.billets.machine.${x.machine}`)}</td>
                    <td className={TD}>{t("fdy2.sheet.pcsKg", { pcs: x.logPcs, kg: kgGrouped1(fmt, x.logG) })}</td>
                    <td className={TD}>{cutLengthText(fmt, x.billetLengthMm)}</td>
                    <td className={TD}>{t("fdy2.sheet.pcsKg", { pcs: x.billetPcs, kg: kgGrouped1(fmt, x.billetG) })}</td>
                    <td className={TD}>{kg(x.endG)}</td>
                    <td className={TD}>{yieldText(x.yieldBp)} %</td>
                    <td className={TD}>{who(x.createdBy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="m-0 text-[14px] font-semibold tabular-nums" data-testid="sheet-cut-totals">
              {t("fdy2.billets.cut.totals", { logs: kgGrouped1(fmt, cuts.logG), billets: kgGrouped1(fmt, cuts.billetG), end: kgGrouped1(fmt, cuts.endG), yield: yieldText(cuts.yieldBp) })}
            </p>
          </Block>
        ) : null}

        {s.rejects.length > 0 ? (
          <Block id="ds-rejects" title={t("fdy2.sheet.rejects.title")}>
            <table className="w-full border-collapse text-[14px]" data-testid="sheet-rejects">
              <thead><tr>{(["at", "kind", "reason", "pcs", "by"] as const).map((k) => <th key={k} scope="col" className={TH}>{t(`fdy2.sheet.rejects.col.${k}`)}</th>)}</tr></thead>
              <tbody>
                {s.rejects.map((r, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className={TD}>{dayClock(r.rejectedAt)}</td>
                    <td className={TD}>{t(`fdy2.rejects.kind.${r.kind}`)}</td>
                    <td className={TD}>{rejectReasonText(tUi, r.kind, r.reasonCode ?? "other", r.reasonLabel)}</td>
                    <td className={TD}>{t("fdy2.sheet.pcsKg", { pcs: r.pcs, kg: kgGrouped1(fmt, r.kgG) })}</td>
                    <td className={TD}>{who(r.createdBy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Block>
        ) : null}

        {timeline.length > 0 ? (
          <Block id="ds-who" title={t("fdy2.sheet.who.title")}>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-[13px]" data-testid="sheet-timeline">
              {timeline.map((e, i) => (
                <li key={i} className="flex flex-wrap gap-x-3 tabular-nums">
                  <span className="w-[8.5rem] text-muted-foreground">{`${dayText(fmt, e.at, tz)} ${clockText(fmt, e.at, tz)}`}</span>
                  <span className="min-w-0 flex-1 break-words">
                    {t(`fdy2.sheet.event.${e.kind}`)}
                    {e.meltSeq !== null ? ` · ${t("foundry.melt.number", { n: e.meltSeq })}` : ""}
                    {e.kind === "reading" && typeof e.detail === "number" ? ` · ${t("fdy2.sheet.celsius", { temp: tempText(e.detail) })}` : ""}
                  </span>
                  <span className="font-medium">{who(e.actorId)}</span>
                </li>
              ))}
            </ul>
          </Block>
        ) : null}
      </article>
    </>
  );
}
