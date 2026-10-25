import {
  isPlSnapshotV2,
  plDispatchCodesText,
  plExtraColumns,
  plGroupTitle,
  plRowExtras,
  plSectionSubtotalAfter,
  plShipDateText,
  type PackingListSnapshot,
} from "@orrn/documents/packing-list/model";

/**
 * The packing list v2 as the screen shows it (FP-PK-13), read from the stored snapshot only: the
 * header (letterhead, bill to, ship to, transport, PO, invoice), the groups by order line with their
 * subtotals, a subtotal after each section that spans several groups, the hollow / solid / semi
 * summary, the party number and original order columns (only when they say something), and the
 * branding choice. The same snapshot feeds the PDF, the Excel file and the print HTML, so all agree.
 */
export type PlRowView = {
  sr: number;
  bundleNo: string;
  partyNo: string | null;
  originalSo: string | null;
  section: string;
  item: string;
  weightG: number;
  cutFt: number;
  cutIn: number;
  pcs: number;
  kgPer12ftMilli: number | null;
  range12ft: number | null;
  po: string | null;
};

export type PlSubtotal = { bundles: number; pcs: number; weightG: number };

export type PlGroupView = {
  key: string;
  title: string;
  rows: PlRowView[];
  subtotal: PlSubtotal;
  /** A section spanning several groups gets its own subtotal after its last group. */
  sectionAfter: (PlSubtotal & { sectionCode: string; item: string }) | null;
};

export type PlParty = { name: string; gstin: string | null; address: string | null };

export type PlView = {
  plNumber: string;
  revision: number;
  date: string;
  dispatchCodes: string;
  shipDate: string | null;
  company: { name: string; legalName: string | null; gstin: string | null; address: string | null; phone: string | null };
  /** Branding off hides the logo and tagline; the legal name always prints. */
  branding: { show: boolean; tagline: string | null };
  billTo: PlParty;
  shipTo: PlParty;
  vehicleNo: string | null;
  driverName: string | null;
  driverPhone: string | null;
  transporter: string | null;
  poNumbers: string[];
  invoiceNumber: string | null;
  invoiceDate: string | null;
  columns: { partyNo: boolean; originalSo: boolean };
  groups: PlGroupView[];
  profile: { kind: "hollow" | "solid" | "semi"; bundles: number; pcs: number; weightG: number }[];
  total: PlSubtotal;
  summaryText: string;
};

/** The v2 view of a parsed snapshot, or null for a list stored before v2 (the old view shows those). */
export function plViewOf(pl: PackingListSnapshot): PlView | null {
  if (!isPlSnapshotV2(pl)) return null;
  const extra = plExtraColumns(pl);
  const sectionAfter = plSectionSubtotalAfter(pl);
  const h = pl.header;
  return {
    plNumber: h.plNumber,
    revision: pl.issue?.revision ?? 1,
    date: h.date,
    dispatchCodes: plDispatchCodesText(pl),
    shipDate: plShipDateText(pl.dispatch.shipDate, h.shipDate ?? null),
    company: h.company,
    branding: { show: pl.print?.showBranding ?? pl.issue?.branding.show ?? true, tagline: pl.issue?.branding.tagline ?? null },
    billTo: h.billTo,
    shipTo: h.shipTo,
    vehicleNo: h.vehicleNo,
    driverName: h.driverName,
    driverPhone: h.driverPhone,
    transporter: h.transporter,
    poNumbers: h.poNumbers,
    invoiceNumber: h.invoiceNumber,
    invoiceDate: h.invoiceDate,
    columns: extra,
    groups: pl.groups.map((g, i) => ({
      key: g.key,
      title: plGroupTitle(g, pl.groups),
      rows: g.rows.map((r) => {
        const x = plRowExtras(pl, r);
        return {
          sr: r.sr,
          bundleNo: r.bundleNo,
          partyNo: x.partyNo && x.partyNo !== r.bundleNo ? x.partyNo : null,
          originalSo: x.originalSo || null,
          section: r.section,
          item: r.item,
          weightG: r.weightG,
          cutFt: r.cutFt,
          cutIn: r.cutIn,
          pcs: r.pcs,
          kgPer12ftMilli: r.kgPer12ftMilli,
          range12ft: r.range12ft,
          po: r.po,
        };
      }),
      subtotal: g.subtotal,
      sectionAfter: sectionAfter.get(i) ?? null,
    })),
    profile: (pl.profileSummary ?? []).map((k) => ({ kind: k.kind, bundles: k.bundles, pcs: k.pcs, weightG: k.weightG })),
    total: { bundles: pl.summary.bundles, pcs: pl.summary.pcs, weightG: pl.summary.weightG },
    summaryText: pl.summary.text,
  };
}
