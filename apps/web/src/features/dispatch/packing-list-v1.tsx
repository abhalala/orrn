import { type PackingListGroup, type PackingListModel, type PackingListRow } from "@orrn/documents/packing-list/model";
import { formatKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { breakpoints, useMediaQuery } from "@orrn/ui/hooks/use-media-query";

import { formatShipDate } from "./format";

const num = (v: number | null, digits: number) => (v === null ? "-" : v.toFixed(digits));
const bundleWord = (t: ReturnType<typeof useT>["t"], n: number) => t("units.bundles", { count: n });

/**
 * The packing list as it was before v2 (lists stored by PL-7 and earlier: no letterhead block, no
 * sections). New lists use `packing-list-v2.tsx`; this keeps the old ones readable.
 */
export function LegacyBody({ model, code, kgPerPiece = false }: { model: PackingListModel; code: string; kgPerPiece?: boolean }) {
  const { t, locale } = useT();
  const wide = useMediaQuery(breakpoints.desktop);
  const { header, groups, totals } = model;
  const facts: { label: string; value: string; mono?: boolean }[] = [
    { label: t("packingList.plNo"), value: code, mono: true },
    { label: t("packingList.dispatch"), value: header.dispatchCode, mono: true },
    { label: t("packingList.date"), value: formatShipDate(header.date, { locale }) ?? t("packingList.notSet") },
    { label: t("packingList.shipDate"), value: formatShipDate(header.shipDate, { locale }) ?? t("packingList.notSet") },
  ];
  return (
    <>
      <div className="flex min-w-0 flex-col gap-5 rounded-card border border-border bg-card p-4 sm:p-6">
        <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="m-0 font-display text-[20px] leading-tight font-bold tracking-[-0.02em] break-words">{header.companyName}</p>
            <p className="m-0 text-[14px] text-muted-foreground">{t("packingList.title")}</p>
          </div>
          <dl className="m-0 grid min-w-0 grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            {facts.map((f) => (
              <div key={f.label} className="flex min-w-0 flex-col">
                <dt className="text-[13px] text-muted-foreground">{f.label}</dt>
                <dd className={f.mono ? "m-0 font-mono text-[15px] font-semibold break-words" : "m-0 text-[15px] font-semibold"}>
                  {f.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="m-0 text-[13px] text-muted-foreground">{t("packingList.customer")}</p>
          <p className="m-0 font-display text-[19px] leading-snug font-bold tracking-[-0.015em] break-words">{header.customerName}</p>
          {header.customerTaxId ? (
            <p className="m-0 text-[14px] text-muted-foreground">
              {t("packingList.gstin")} <span className="font-mono">{header.customerTaxId}</span>
            </p>
          ) : null}
          {header.notes ? <p className="m-0 mt-1 text-[14px] break-words">{header.notes}</p> : null}
        </div>
        <p data-testid="packing-list-totals" data-no-truncate="" className="m-0 font-display text-[28px] leading-[1.1] font-extrabold tracking-[-0.03em] tabular-nums sm:text-[34px]">
          {t("packingList.totals", { bundles: totals.bundles, kg: formatKg(totals.weightKg) })}
        </p>
      </div>
      {wide ? <PackingListTable groups={groups} totals={totals} kgPerPiece={kgPerPiece} /> : <PackingListStack groups={groups} totals={totals} kgPerPiece={kgPerPiece} />}
    </>
  );
}

function groupTitle(t: ReturnType<typeof useT>["t"], g: PackingListGroup) {
  return g.labelled ? `${t("packingList.groupNamed", { label: g.label })}: ${g.dieLabel}` : g.label;
}

function PackingListTable({ groups, totals, kgPerPiece }: Pick<PackingListModel, "groups" | "totals"> & { kgPerPiece: boolean }) {
  const { t } = useT();
  const cols = [
    { key: "sr", label: t("packingList.columns.sr"), end: false },
    { key: "bundle", label: t("packingList.columns.bundleNo"), end: false },
    { key: "item", label: t("packingList.columns.item"), end: false },
    { key: "kg", label: t("packingList.columns.weightKg"), end: true },
    { key: "ft", label: t("packingList.columns.cutLengthFt"), end: true },
    { key: "in", label: t("packingList.columns.cutLengthIn"), end: true },
    { key: "pcs", label: t("packingList.columns.pcs"), end: true },
    { key: "k12", label: t("packingList.columns.kgPer12ft"), end: true },
    { key: "range", label: t("packingList.columns.weightRange"), end: true },
    ...(kgPerPiece ? [{ key: "kgpc", label: t("packingList.columns.kgPerPiece"), end: true }] : []),
  ];
  const cell = "px-3 py-2 first:pl-5 last:pr-5";
  return (
    <div className="min-w-0 overflow-hidden rounded-card border border-border bg-card">
      <div className="overflow-x-auto">
        <table data-testid="packing-list-table" aria-label={t("packingList.rowsLabel")} className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-border">
              {cols.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`h-11 ${cell} text-[13px] font-semibold text-muted-foreground ${c.end ? "text-right" : "text-left"}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.key}>
              <tr className="border-b border-border bg-surface-sunken/60">
                <th scope="rowgroup" colSpan={cols.length} className={`${cell} text-left text-[14px] font-semibold`}>
                  {groupTitle(t, g)}
                </th>
              </tr>
              {g.rows.map((r) => (
                <PlTableRow key={r.sr} row={r} cell={cell} kgPerPiece={kgPerPiece} />
              ))}
              <tr className="border-b border-border font-semibold">
                <td className={cell} />
                <td className={`${cell} whitespace-nowrap`}>{bundleWord(t, g.bundles)}</td>
                <td className={cell}>{t("packingList.groupTotalOf", { label: g.label })}</td>
                <td className={`${cell} text-right font-mono tabular-nums`}>{formatKg(g.weightKg)}</td>
                <td className={cell} />
                <td className={cell} />
                <td className={`${cell} text-right font-mono tabular-nums`}>{g.pieces}</td>
                <td className={cell} />
                <td className={cell} />
                {kgPerPiece ? <td className={cell} /> : null}
              </tr>
            </tbody>
          ))}
          <tfoot>
            <tr className="border-t-2 border-foreground text-[15px] font-bold">
              <td className={cell} />
              <td className={`${cell} whitespace-nowrap`}>{bundleWord(t, totals.bundles)}</td>
              <td className={cell}>{t("packingList.grandTotal")}</td>
              <td className={`${cell} text-right font-mono tabular-nums`} data-testid="packing-list-total-kg">
                {formatKg(totals.weightKg)}
              </td>
              <td className={cell} />
              <td className={cell} />
              <td className={`${cell} text-right font-mono tabular-nums`}>{totals.pieces}</td>
              <td className={cell} />
              <td className={cell} />
              {kgPerPiece ? <td className={cell} /> : null}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function PlTableRow({ row: r, cell, kgPerPiece }: { row: PackingListRow; cell: string; kgPerPiece: boolean }) {
  return (
    <tr data-testid="packing-list-row" className="border-b border-border">
      <td className={`${cell} font-mono text-muted-foreground tabular-nums`}>{r.sr}</td>
      <td className={`${cell} font-mono font-semibold whitespace-nowrap`}>{r.bundleNo}</td>
      <td className={`${cell} break-words`}>{r.item}</td>
      <td className={`${cell} text-right font-mono tabular-nums`}>{formatKg(r.weightKg)}</td>
      <td className={`${cell} text-right font-mono tabular-nums`}>{r.cutLengthFt}</td>
      <td className={`${cell} text-right font-mono tabular-nums`}>{r.cutLengthIn}</td>
      <td className={`${cell} text-right font-mono tabular-nums`}>{r.pcs}</td>
      <td className={`${cell} text-right font-mono tabular-nums`}>{num(r.kgPer12ft, 3)}</td>
      <td className={`${cell} text-right font-mono font-semibold tabular-nums`}>{num(r.weightRange12ft, 1)}</td>
      {kgPerPiece ? <td className={`${cell} text-right font-mono tabular-nums`} data-testid="packing-list-kg-per-piece">{num(r.kgPerPiece, 3)}</td> : null}
    </tr>
  );
}

function PackingListStack({ groups, totals, kgPerPiece }: Pick<PackingListModel, "groups" | "totals"> & { kgPerPiece: boolean }) {
  const { t } = useT();
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {groups.map((g) => {
        // The group title already names the item; a row repeats it only when one label spans several sections.
        const mixed = new Set(g.rows.map((r) => r.item)).size > 1;
        return (
          <section key={g.key} aria-label={groupTitle(t, g)} className="min-w-0 overflow-hidden rounded-card border border-border bg-card">
            <div className="flex min-w-0 flex-col gap-0.5 border-b border-border px-4 py-3">
              <h3 className="m-0 text-[15px] font-semibold break-words">{groupTitle(t, g)}</h3>
              <p className="m-0 text-[13px] text-muted-foreground tabular-nums">
                {t("packingList.totals", { bundles: g.bundles, kg: formatKg(g.weightKg) })}
              </p>
            </div>
            <ul aria-label={t("packingList.rowsLabel")} className="m-0 list-none divide-y divide-border p-0">
              {g.rows.map((r) => (
                <li key={r.sr} data-testid="packing-list-row" className="flex min-w-0 flex-col gap-2 px-4 py-3">
                  <div className="flex min-w-0 items-baseline justify-between gap-3">
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      <span className="mr-2 font-mono text-[13px] text-muted-foreground">{r.sr}</span>
                      <span className="font-mono text-[16px] font-semibold">{r.bundleNo}</span>
                    </span>
                    <span data-no-truncate="" className="shrink-0 font-mono text-[15px] font-semibold tabular-nums">
                      {formatKg(r.weightKg)} {t("units.kg")}
                    </span>
                  </div>
                  {mixed ? <p className="m-0 text-[13px] text-muted-foreground break-words">{r.item}</p> : null}
                  <dl className="m-0 grid grid-cols-3 gap-x-3 gap-y-1.5">
                    <Fact label={t("packingList.columns.cutLengthFt")} value={String(r.cutLengthFt)} />
                    <Fact label={t("packingList.columns.cutLengthIn")} value={String(r.cutLengthIn)} />
                    <Fact label={t("packingList.columns.pcs")} value={String(r.pcs)} />
                    <Fact label={t("packingList.columns.kgPer12ft")} value={num(r.kgPer12ft, 3)} />
                    <Fact label={t("packingList.columns.weightRange")} value={num(r.weightRange12ft, 1)} strong />
                    {kgPerPiece ? <Fact label={t("packingList.columns.kgPerPiece")} value={num(r.kgPerPiece, 3)} /> : null}
                  </dl>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-card border-2 border-foreground bg-card px-4 py-3">
        <span className="text-[15px] font-bold">{t("packingList.grandTotal")}</span>
        <span data-testid="packing-list-total-kg" data-no-truncate="" className="font-mono text-[17px] font-bold tabular-nums">
          {t("packingList.totals", { bundles: totals.bundles, kg: formatKg(totals.weightKg) })}
        </span>
      </div>
    </div>
  );
}

function Fact({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-[12px] leading-4 text-muted-foreground break-words">{label}</dt>
      <dd className={`m-0 font-mono text-[14px] tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</dd>
    </div>
  );
}
