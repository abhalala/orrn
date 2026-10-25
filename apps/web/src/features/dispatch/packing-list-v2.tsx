import { formatKg, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { breakpoints, useMediaQuery } from "@orrn/ui/hooks/use-media-query";
import { cn } from "@orrn/ui/lib/utils";

import { formatShipDate } from "./format";
import type { PlGroupView, PlRowView, PlSubtotal, PlView } from "./pl-model";

const kg = (g: number) => formatKg(gToKg(g));
const k12 = (milli: number | null) => (milli === null ? "-" : (milli / 1000).toFixed(3));
const range = (v: number | null) => (v === null ? "-" : v.toFixed(1));

/**
 * The packing list the plant sends (FP-PK-13), on screen: header with the letterhead, bill to / ship
 * to, PL number and revision, date, vehicle, transporter, PO and invoice; the groups by order line with
 * subtotals; a section subtotal where a section spans groups; the hollow / solid / semi summary; and
 * the party number and original order columns when they have something to say. Built from the stored
 * snapshot only (`pl-model.ts`).
 */
export function PlV2Body({ view, code }: { view: PlView; code: string }) {
  const wide = useMediaQuery(breakpoints.desktop);
  return (
    <>
      <PlHeader view={view} code={code} />
      {wide ? <PlTable view={view} /> : <PlStack view={view} />}
      <PlSummary view={view} />
    </>
  );
}

function PlHeader({ view, code }: { view: PlView; code: string }) {
  const { t, locale } = useT();
  const facts: { key: string; label: string; value: string | null; mono?: boolean }[] = [
    { key: "plNo", label: t("packingList.plNo"), value: view.revision > 1 ? `${code} (${t("packingList.v2.revisionShort", { n: view.revision })})` : code, mono: true },
    { key: "date", label: t("packingList.date"), value: formatShipDate(view.date, { locale }) ?? t("packingList.notSet") },
    { key: "dispatch", label: t("packingList.dispatch"), value: view.dispatchCodes, mono: true },
    { key: "shipDate", label: t("packingList.shipDate"), value: view.shipDate ?? t("packingList.notSet") },
    { key: "vehicle", label: t("packingList.vehicle"), value: view.vehicleNo, mono: true },
    { key: "driver", label: t("packingList.driver"), value: [view.driverName, view.driverPhone].filter(Boolean).join(" · ") || null },
    { key: "transporter", label: t("packingList.transporter"), value: view.transporter },
    { key: "po", label: t("packingList.po"), value: view.poNumbers.length > 0 ? view.poNumbers.join(", ") : null, mono: true },
    { key: "invoice", label: t("packingList.invoice"), value: view.invoiceNumber ? [view.invoiceNumber, view.invoiceDate ? formatShipDate(view.invoiceDate, { locale }) : null].filter(Boolean).join(" · ") : null, mono: true },
  ];
  const company = view.company;
  return (
    <div data-slot="pl-header" className="flex min-w-0 flex-col gap-5 rounded-card border border-border bg-card p-4 sm:p-6">
      <div className="flex min-w-0 flex-col gap-1">
        {/* Branding off hides the logo and tagline. The legal name always prints. */}
        {view.branding.show ? (
          <div className="flex items-center gap-3" data-testid="pl-branding">
            <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-card bg-foreground font-display text-[14px] font-bold text-background">
              {company.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="flex min-w-0 flex-col">
              <p className="m-0 font-display text-[20px] leading-tight font-bold tracking-[-0.02em] break-words">{company.name}</p>
              {view.branding.tagline ? <p className="m-0 text-[13px] text-muted-foreground">{view.branding.tagline}</p> : null}
            </div>
          </div>
        ) : null}
        <p data-testid="pl-legal-name" className={cn("m-0 break-words", view.branding.show ? "text-[13px] text-muted-foreground" : "font-display text-[20px] leading-tight font-bold tracking-[-0.02em]")}>
          {company.legalName ?? company.name}
        </p>
        {company.address || company.gstin ? (
          <p className="m-0 text-[13px] leading-5 text-muted-foreground break-words">
            {[company.address, company.gstin ? `${t("packingList.gstin")} ${company.gstin}` : null, company.phone].filter(Boolean).join(" · ")}
          </p>
        ) : null}
        <p className="m-0 text-[14px] text-muted-foreground">{t("packingList.title")}</p>
      </div>

      <dl className="m-0 grid min-w-0 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
        {facts.map((f) => (
          <div key={f.key} data-fact={f.key} className="flex min-w-0 flex-col">
            <dt className="text-[13px] text-muted-foreground">{f.label}</dt>
            <dd className={cn("m-0 text-[15px] font-semibold break-words", f.mono && "font-mono")}>{f.value || <span className="font-normal text-muted-foreground">-</span>}</dd>
          </div>
        ))}
      </dl>

      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Party label={t("packingList.billTo")} party={view.billTo} />
        <Party label={t("packingList.shipTo")} party={view.shipTo} />
      </div>

      <p
        data-testid="packing-list-totals"
        data-no-truncate=""
        className="m-0 font-display text-[28px] leading-[1.1] font-extrabold tracking-[-0.03em] tabular-nums sm:text-[34px]"
      >
        {t("packingList.totals", { bundles: view.total.bundles, kg: kg(view.total.weightG) })}
      </p>
    </div>
  );
}

function Party({ label, party }: { label: string; party: { name: string; gstin: string | null; address: string | null } }) {
  const { t } = useT();
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <p className="m-0 text-[13px] text-muted-foreground">{label}</p>
      <p className="m-0 font-display text-[18px] leading-snug font-bold tracking-[-0.015em] break-words">{party.name}</p>
      {party.address ? <p className="m-0 text-[14px] text-muted-foreground break-words">{party.address}</p> : null}
      {party.gstin ? (
        <p className="m-0 text-[14px] text-muted-foreground">
          {t("packingList.gstin")} <span className="font-mono">{party.gstin}</span>
        </p>
      ) : null}
    </div>
  );
}

function PlSummary({ view }: { view: PlView }) {
  const { t } = useT();
  if (view.profile.length === 0) return null;
  return (
    <section aria-label={t("packingList.v2.byProfile")} data-slot="pl-profile" className="flex min-w-0 flex-wrap gap-3">
      {view.profile.map((k) => (
        <div key={k.kind} data-kind={k.kind} className="flex min-w-[10rem] flex-1 flex-col gap-0.5 rounded-card border border-border bg-card px-4 py-3">
          <span className="text-[13px] text-muted-foreground">{t(`packingList.v2.summary.${k.kind}`)}</span>
          <span className="font-mono text-[16px] font-semibold tabular-nums">
            {t("packingList.totals", { bundles: k.bundles, kg: kg(k.weightG) })}
          </span>
        </div>
      ))}
    </section>
  );
}

function groupTotals(t: ReturnType<typeof useT>["t"], s: PlSubtotal) {
  return t("packingList.totals", { bundles: s.bundles, kg: kg(s.weightG) });
}

function PlTable({ view }: { view: PlView }) {
  const { t } = useT();
  const { partyNo, originalSo } = view.columns;
  const cols = [
    { key: "sr", label: t("packingList.columns.sr"), end: false },
    { key: "bundle", label: t("packingList.columns.bundleNo"), end: false },
    ...(partyNo ? [{ key: "party", label: t("packingList.v2.partyNo"), end: false }] : []),
    { key: "section", label: t("packingList.columns.section"), end: false },
    { key: "item", label: t("packingList.columns.item"), end: false },
    { key: "kg", label: t("packingList.columns.weightKg"), end: true },
    { key: "ft", label: t("packingList.columns.cutLengthFt"), end: true },
    { key: "in", label: t("packingList.columns.cutLengthIn"), end: true },
    { key: "pcs", label: t("packingList.columns.pcs"), end: true },
    { key: "k12", label: t("packingList.columns.kgPer12ft"), end: true },
    { key: "range", label: t("packingList.columns.weightRange"), end: true },
    { key: "po", label: t("packingList.columns.po"), end: false },
    ...(originalSo ? [{ key: "so", label: t("packingList.columns.originalSo"), end: false }] : []),
  ];
  const cell = "px-3 py-2 first:pl-5 last:pr-5";
  const span = cols.length;
  return (
    <div className="min-w-0 overflow-hidden rounded-card border border-border bg-card">
      <div className="overflow-x-auto">
        <table data-testid="packing-list-table" aria-label={t("packingList.rowsLabel")} className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-border">
              {cols.map((c) => (
                <th key={c.key} scope="col" className={cn("h-11 text-[13px] font-semibold text-muted-foreground", cell, c.end ? "text-right" : "text-left")}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          {view.groups.map((g) => (
            <GroupBody key={g.key} g={g} span={span} cell={cell} partyNo={partyNo} originalSo={originalSo} />
          ))}
          <tfoot>
            <tr className="border-t-2 border-foreground text-[15px] font-bold">
              <td className={cell} />
              <td className={cn(cell, "whitespace-nowrap")}>{t("units.bundles", { count: view.total.bundles })}</td>
              {partyNo ? <td className={cell} /> : null}
              <td className={cell} />
              <td className={cell}>{t("packingList.grandTotal")}</td>
              <td className={cn(cell, "text-right font-mono tabular-nums")} data-testid="packing-list-total-kg">
                {kg(view.total.weightG)}
              </td>
              <td className={cell} />
              <td className={cell} />
              <td className={cn(cell, "text-right font-mono tabular-nums")}>{view.total.pcs}</td>
              <td className={cell} />
              <td className={cell} />
              <td className={cell} />
              {originalSo ? <td className={cell} /> : null}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function GroupBody({ g, span, cell, partyNo, originalSo }: { g: PlGroupView; span: number; cell: string; partyNo: boolean; originalSo: boolean }) {
  const { t } = useT();
  const blank = (n: number) => Array.from({ length: n }, (_, i) => <td key={i} className={cell} />);
  return (
    <tbody>
      <tr className="border-b border-border bg-surface-sunken/60">
        <th scope="rowgroup" colSpan={span} className={cn(cell, "text-left text-[14px] font-semibold")}>
          {g.title}
        </th>
      </tr>
      {g.rows.map((r) => (
        <tr key={r.sr} data-testid="packing-list-row" className="border-b border-border">
          <td className={cn(cell, "font-mono text-muted-foreground tabular-nums")}>{r.sr}</td>
          <td className={cn(cell, "font-mono font-semibold whitespace-nowrap")}>{r.bundleNo}</td>
          {partyNo ? <td className={cn(cell, "font-mono whitespace-nowrap")}>{r.partyNo ?? ""}</td> : null}
          <td className={cn(cell, "font-mono")}>{r.section}</td>
          <td className={cn(cell, "break-words")}>{r.item}</td>
          <td className={cn(cell, "text-right font-mono tabular-nums")}>{kg(r.weightG)}</td>
          <td className={cn(cell, "text-right font-mono tabular-nums")}>{r.cutFt}</td>
          <td className={cn(cell, "text-right font-mono tabular-nums")}>{r.cutIn}</td>
          <td className={cn(cell, "text-right font-mono tabular-nums")}>{r.pcs}</td>
          <td className={cn(cell, "text-right font-mono tabular-nums")}>{k12(r.kgPer12ftMilli)}</td>
          <td className={cn(cell, "text-right font-mono font-semibold tabular-nums")}>{range(r.range12ft)}</td>
          <td className={cn(cell, "font-mono")}>{r.po ?? ""}</td>
          {originalSo ? <td className={cn(cell, "font-mono whitespace-nowrap")}>{r.originalSo ?? ""}</td> : null}
        </tr>
      ))}
      <tr className="border-b border-border font-semibold" data-testid="pl-group-total">
        <td className={cell} />
        <td className={cn(cell, "whitespace-nowrap")}>{t("units.bundles", { count: g.subtotal.bundles })}</td>
        {partyNo ? <td className={cell} /> : null}
        <td className={cell} />
        <td className={cell}>{t("packingList.groupTotal")}</td>
        <td className={cn(cell, "text-right font-mono tabular-nums")}>{kg(g.subtotal.weightG)}</td>
        {blank(2)}
        <td className={cn(cell, "text-right font-mono tabular-nums")}>{g.subtotal.pcs}</td>
        {blank(3)}
        {originalSo ? <td className={cell} /> : null}
      </tr>
      {g.sectionAfter ? (
        <tr className="border-b border-border bg-surface-sunken/60 font-semibold" data-testid="pl-section-total">
          <td className={cell} />
          <td className={cn(cell, "whitespace-nowrap")}>{t("units.bundles", { count: g.sectionAfter.bundles })}</td>
          {partyNo ? <td className={cell} /> : null}
          <td className={cell} />
          <td className={cell}>{t("packingList.v2.sectionTotal", { section: g.sectionAfter.sectionCode })}</td>
          <td className={cn(cell, "text-right font-mono tabular-nums")}>{kg(g.sectionAfter.weightG)}</td>
          {blank(2)}
          <td className={cn(cell, "text-right font-mono tabular-nums")}>{g.sectionAfter.pcs}</td>
          {blank(3)}
          {originalSo ? <td className={cell} /> : null}
        </tr>
      ) : null}
    </tbody>
  );
}

function PlStack({ view }: { view: PlView }) {
  const { t } = useT();
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {view.groups.map((g) => (
        <section key={g.key} aria-label={g.title} className="min-w-0 overflow-hidden rounded-card border border-border bg-card">
          <div className="flex min-w-0 flex-col gap-0.5 border-b border-border px-4 py-3">
            <h3 className="m-0 text-[15px] font-semibold break-words">{g.title}</h3>
            <p data-testid="pl-group-subtotal" className="m-0 text-[13px] text-muted-foreground tabular-nums">
              {groupTotals(t, g.subtotal)}
            </p>
          </div>
          <ul aria-label={t("packingList.rowsLabel")} className="m-0 list-none divide-y divide-border p-0">
            {g.rows.map((r) => (
              <StackRow key={r.sr} r={r} originalSo={view.columns.originalSo} />
            ))}
          </ul>
          {g.sectionAfter ? (
            <p data-testid="pl-section-total" className="m-0 border-t border-border bg-surface-sunken/60 px-4 py-2.5 text-[14px] font-semibold tabular-nums">
              {t("packingList.v2.sectionTotal", { section: g.sectionAfter.sectionCode })}: {groupTotals(t, g.sectionAfter)}
            </p>
          ) : null}
        </section>
      ))}
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-card border-2 border-foreground bg-card px-4 py-3">
        <span className="text-[15px] font-bold">{t("packingList.grandTotal")}</span>
        <span data-testid="packing-list-total-kg" data-no-truncate="" className="font-mono text-[17px] font-bold tabular-nums">
          {groupTotals(t, view.total)}
        </span>
      </div>
    </div>
  );
}

function StackRow({ r, originalSo }: { r: PlRowView; originalSo: boolean }) {
  const { t } = useT();
  return (
    <li data-testid="packing-list-row" className="flex min-w-0 flex-col gap-2 px-4 py-3">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <span className="min-w-0 [overflow-wrap:anywhere]">
          <span className="mr-2 font-mono text-[13px] text-muted-foreground">{r.sr}</span>
          <span className="font-mono text-[16px] font-semibold">{r.bundleNo}</span>
          {r.partyNo ? <span className="ml-2 font-mono text-[13px] text-muted-foreground">{t("packingList.v2.partyShort", { number: r.partyNo })}</span> : null}
        </span>
        <span data-no-truncate="" className="shrink-0 font-mono text-[15px] font-semibold tabular-nums">
          {kg(r.weightG)} {t("units.kg")}
        </span>
      </div>
      <dl className="m-0 grid grid-cols-3 gap-x-3 gap-y-1.5">
        <StackFact label={t("packingList.columns.cutLengthFt")} value={String(r.cutFt)} />
        <StackFact label={t("packingList.columns.cutLengthIn")} value={String(r.cutIn)} />
        <StackFact label={t("packingList.columns.pcs")} value={String(r.pcs)} />
        <StackFact label={t("packingList.columns.kgPer12ft")} value={k12(r.kgPer12ftMilli)} />
        <StackFact label={t("packingList.columns.weightRange")} value={range(r.range12ft)} strong />
        {originalSo && r.originalSo ? <StackFact label={t("packingList.columns.originalSo")} value={r.originalSo} /> : null}
      </dl>
    </li>
  );
}

function StackFact({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-[12px] leading-4 text-muted-foreground break-words">{label}</dt>
      <dd className={cn("m-0 font-mono text-[14px] tabular-nums", strong && "font-semibold")}>{value}</dd>
    </div>
  );
}
