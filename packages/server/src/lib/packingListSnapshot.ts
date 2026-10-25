/**
 * Packing list snapshot v2 (spec P12/P13, digest Stage 16, PL-8): the plant's real PL.
 *
 * Header: company (name, legal name, GSTIN, address), bill-to and ship-to (customer name, GSTIN,
 * address), PL number from the plant's book, date, vehicle, driver, transporter, PO numbers and the
 * Tally invoice. Body: 11 columns, rows grouped by order line (or by section when a bundle has no
 * line), serial numbers running through the whole list. Totals "N bundles · X kg".
 *
 * v2 is a superset of v1: the v1 keys (`dispatch`, `company`, `items`, `totals`, `generatedAt`)
 * stay with the same meaning, so older web/native renderers keep working on a v2 snapshot.
 * Snapshots are stored once and never rebuilt from live data except by packingList.regenerate,
 * which keeps the PL number.
 */
import {
  kgPer12ft,
  MM_PER_INCH,
  profileKindSummary,
  weightRange12ftFromMilli,
  weightRange12ftOf,
  type ProfileKind,
} from "@orrn/domain";
import { z } from "zod";

import { enteredShipYmd } from "./dispatchFigures";

/** The 11 printed columns, in order. */
export const PL_COLUMNS = [
  "sr",
  "bundleNo",
  "section",
  "item",
  "weightKg",
  "cutFt",
  "cutIn",
  "pcs",
  "kgPer12ft",
  "range12ft",
  "po",
] as const;
export type PlColumn = (typeof PL_COLUMNS)[number];

/** Printed column headings (the PL is a customer document, printed in English). */
export const PL_COLUMN_LABELS: Record<PlColumn, string> = {
  sr: "Sr",
  bundleNo: "Bundle no",
  section: "Section",
  item: "Item",
  weightKg: "Weight kg",
  cutFt: "Cut ft",
  cutIn: "Cut in",
  pcs: "Pcs",
  kgPer12ft: "kg/12ft",
  range12ft: "Range /12'",
  po: "PO",
};

const partySchema = z.object({
  name: z.string(),
  gstin: z.string().nullable(),
  address: z.string().nullable(),
});

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const plRowSchema = z.object({
  sr: z.number().int().positive(),
  bundleNo: z.string(),
  section: z.string(),
  item: z.string(),
  weightG: z.number().int().nonnegative(),
  cutFt: z.number().int().nonnegative(),
  /** Inches past the feet, to the nearest quarter inch (0 – 11.75). */
  cutIn: z.number().nonnegative().lt(12),
  pcs: z.number().int().nonnegative(),
  /** kg per 12 ft piece × 1000 (grams per 12 ft); null without pieces or length. */
  kgPer12ftMilli: z.number().int().nullable(),
  /** Weight range /12' (the billed band): floor((kg12ft + 0.01) × 10) / 10. */
  range12ft: z.number().nullable(),
  po: z.string().nullable(),
});

/**
 * FP-PK-13 per-row extras, keyed by bundle number (`rowInfo`), kept beside the 11 printed columns so
 * a row keeps the PL-8 shape older readers and renderers rely on.
 */
export const plRowInfoSchema = z.object({
  /** The customer's own bundle number (party series), else the serial. */
  partyNo: z.string().nullable(),
  /** The order line the bundle was packed for (`SO-12/1`), from packed_sales_order_line_id. */
  originalSo: z.string().nullable(),
  profileKind: z.enum(["hollow", "solid", "semi"]).nullable(),
});
export type PlRow = z.infer<typeof plRowSchema>;

const subtotalSchema = z.object({
  bundles: z.number().int().nonnegative(),
  pcs: z.number().int().nonnegative(),
  weightG: z.number().int().nonnegative(),
});

export const plGroupSchema = z.object({
  /** Order line id, or `section:{dieId}` for bundles without a line. */
  key: z.string(),
  salesOrderLineId: z.string().nullable(),
  orderNumber: z.string().nullable(),
  /** The order's FY period (`2026-27`): SO numbers repeat every FY. Absent on PLs stored before it. */
  orderPeriod: z.string().nullable().optional(),
  lineNo: z.number().int().nullable(),
  sectionCode: z.string(),
  item: z.string(),
  finish: z.string().nullable(),
  poNumber: z.string().nullable(),
  rows: z.array(plRowSchema).min(1),
  subtotal: subtotalSchema,
});
export type PlGroup = z.infer<typeof plGroupSchema>;

/** Subtotal per section (FP-PK-13), in printed order. */
export const plSectionSchema = subtotalSchema.extend({ sectionCode: z.string(), item: z.string() });
/** Footer summary by profile kind, hollow / solid / semi, zero kinds omitted. */
export const plProfileSchema = subtotalSchema.extend({ kind: z.enum(["hollow", "solid", "semi"]) });

export const plSnapshotV2Schema = z.object({
  version: z.literal(2),
  header: z.object({
    plNumber: z.string().min(1),
    /** Completion date on the company wall clock. */
    date: ymd,
    dispatchCode: z.string(),
    company: z.object({
      name: z.string(),
      legalName: z.string().nullable(),
      gstin: z.string().nullable(),
      address: z.string().nullable(),
      phone: z.string().nullable(),
    }),
    billTo: partySchema,
    shipTo: partySchema,
    vehicleNo: z.string().nullable(),
    driverName: z.string().nullable(),
    driverPhone: z.string().nullable(),
    transporter: z.string().nullable(),
    poNumbers: z.array(z.string()),
    invoiceNumber: z.string().nullable(),
    invoiceDate: ymd.nullable(),
    /**
     * The ship date as the company's calendar day (`settings.timezone`, else IST), so the printed
     * date never depends on the reader's timezone (review round 3 m-5). Absent on older snapshots.
     */
    shipDate: ymd.nullable().optional(),
  }),
  columns: z.tuple([
    z.literal("sr"),
    z.literal("bundleNo"),
    z.literal("section"),
    z.literal("item"),
    z.literal("weightKg"),
    z.literal("cutFt"),
    z.literal("cutIn"),
    z.literal("pcs"),
    z.literal("kgPer12ft"),
    z.literal("range12ft"),
    z.literal("po"),
  ]),
  groups: z.array(plGroupSchema),
  summary: subtotalSchema.extend({ text: z.string() }),
  // ---- FP-PK-13 (absent on PLs stored before it) ----
  issue: z
    .object({
      /** 1 for the first issue; regenerate keeps the PL number and adds 1. */
      revision: z.number().int().positive(),
      /** Every dispatch the list covers (a combined list covers several of one customer). */
      dispatchCodes: z.array(z.string()),
      /** Branding off hides logo and tagline; the legal name always prints. */
      branding: z.object({ show: z.boolean(), tagline: z.string().nullable(), logoUrl: z.string().nullable() }),
    })
    .optional(),
  rowInfo: z.record(z.string(), plRowInfoSchema).optional(),
  sections: z.array(plSectionSchema).optional(),
  profileSummary: z.array(plProfileSchema).optional(),
  print: z.object({ showBranding: z.boolean(), showOriginalSo: z.boolean() }).optional(),
  // ---- v1 keys, unchanged meaning ----
  dispatch: z.object({
    code: z.string(),
    customer: z.object({
      id: z.string(),
      name: z.string(),
      phone: z.string().nullable(),
      email: z.string().nullable(),
      billingAddress: z.record(z.string(), z.unknown()).nullable(),
      shippingAddress: z.record(z.string(), z.unknown()).nullable(),
      taxId: z.string().nullable(),
    }),
    shipDate: z.string().nullable(),
    notes: z.string(),
    status: z.string(),
    completedAt: z.string().nullable(),
  }),
  company: z.object({ id: z.string(), name: z.string() }),
  items: z.array(
    z.object({
      bundleSerial: z.string(),
      die: z.object({ series: z.string(), sectionCode: z.string() }),
      groupId: z.string(),
      quantity: z.number().int(),
      weightG: z.number().int(),
      lengthMm: z.number().int(),
    }),
  ),
  totals: z.object({
    totalBundles: z.number().int(),
    totalQuantity: z.number().int(),
    totalWeightKg: z.number(),
    totalLengthM: z.number(),
  }),
  generatedAt: z.string(),
  generatedBy: z.string(),
});
export type PlSnapshotV2 = z.infer<typeof plSnapshotV2Schema>;

export function isPlSnapshotV2(snapshot: unknown): snapshot is PlSnapshotV2 {
  return Boolean(snapshot && typeof snapshot === "object" && (snapshot as { version?: unknown }).version === 2);
}

/** Cut length as printed: whole feet + inches to the nearest quarter inch (3658 mm → 12 ft 0 in). */
export function cutFtIn(lengthMm: number): { ft: number; inch: number } {
  const totalInches = Math.round(lengthMm / MM_PER_INCH / 0.25) * 0.25;
  const ft = Math.floor(totalInches / 12);
  return { ft, inch: Number((totalInches - ft * 12).toFixed(2)) };
}

/**
 * One line of text from a stored address object. No address form exists yet, so accept the likely
 * shapes: `{ lines: string[] }`, `{ line1, line2, city, state, pincode }`, `{ text }`, or any string
 * values in key order.
 */
export function addressText(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "string") return raw.trim() || null;
  if (typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  if (Array.isArray(rec.lines)) {
    const parts = rec.lines.map(str).filter((v): v is string => v !== null);
    return parts.length ? parts.join(", ") : null;
  }
  if (str(rec.text)) return str(rec.text);
  const known = ["line1", "line2", "line3", "street", "area", "city", "district", "state", "pincode", "postalCode", "zip", "country"];
  const knownParts = known.map((k) => str(rec[k])).filter((v): v is string => v !== null);
  if (knownParts.length) return knownParts.join(", ");
  const skip = new Set(["name", "gstin", "phone", "email"]);
  const any = Object.entries(rec)
    .filter(([k]) => !skip.has(k))
    .map(([, v]) => str(v))
    .filter((v): v is string => v !== null);
  return any.length ? any.join(", ") : null;
}

/** Natural compare: "12170" < "12171", "26I99" < "26I100". */
const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export type PlItemInput = {
  bundleId: string;
  serial: string;
  quantity: number;
  weightG: number;
  lengthMm: number;
  kgPer12ftMilli: number | null;
  bundlePo: string | null;
  bundleGroupId: string;
  groupLabel: string | null;
  dieId: string;
  series: string;
  sectionCode: string;
  sectionName: string | null;
  /** FP-PK-13: party number (else serial), section profile kind, packed-for line code. */
  partyNo?: string | null;
  profileKind?: ProfileKind | null;
  packedLineCode?: string | null;
  line: {
    id: string;
    orderNumber: string;
    orderPeriod?: string | null;
    lineNo: number;
    finish: string | null;
    poNumber: string | null;
  } | null;
};

export type PlBuildInput = {
  plNumber: string;
  date: string;
  generatedAt: Date;
  generatedBy: string;
  company: { id: string; name: string; settings: Record<string, unknown> | null };
  dispatch: {
    code: string;
    status: string;
    shipDate: Date | null;
    notes: string | null;
    completedAt: Date | null;
    vehicleNo: string | null;
    driverName: string | null;
    driverPhone: string | null;
    transporter: string | null;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    /** Transporter master name snapshotted on the dispatch (wins over the free text). */
    transporterName?: string | null;
  };
  /** FP-PK-13: revision, combined dispatches and print choices. Defaults: 1, [code], on, on. */
  revision?: number;
  dispatchCodes?: string[];
  showBranding?: boolean;
  showOriginalSo?: boolean;
  customer: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    billingAddress: Record<string, unknown> | null;
    shippingAddress: Record<string, unknown> | null;
    taxId: string | null;
  } | null;
  items: readonly PlItemInput[];
};

/** Company letterhead from `settings.letterhead` ({ legalName, gstin, address, phone }). */
export function letterhead(settings: Record<string, unknown> | null): {
  legalName: string | null;
  gstin: string | null;
  address: string | null;
  phone: string | null;
} {
  const raw = settings?.letterhead;
  const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return { legalName: str(rec.legalName), gstin: str(rec.gstin), address: str(rec.address), phone: str(rec.phone) };
}

/** Logo and tagline from `settings.letterhead` ({ tagline, logoUrl }); hidden when branding is off. */
export function branding(settings: Record<string, unknown> | null): { tagline: string | null; logoUrl: string | null } {
  const raw = settings?.letterhead;
  const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);
  const logo = str(rec.logoUrl, 2048);
  return { tagline: str(rec.tagline, 200), logoUrl: logo && /^https:\/\//.test(logo) ? logo : null };
}

function itemText(item: PlItemInput): string {
  const base = item.sectionName?.trim() || item.series;
  const finish = item.line?.finish?.trim();
  return finish ? `${base} (${finish})` : base;
}

export function buildPlSnapshotV2(input: PlBuildInput): PlSnapshotV2 {
  const cust = input.customer;
  const shipping = cust?.shippingAddress ?? null;
  const shipName = typeof shipping?.name === "string" && shipping.name.trim() ? shipping.name.trim() : null;
  const shipGstin = typeof shipping?.gstin === "string" && shipping.gstin.trim() ? shipping.gstin.trim() : null;

  // Group by order line, else by section; sections in natural order, then order number, line no.
  type Acc = { group: Omit<PlGroup, "rows" | "subtotal">; items: PlItemInput[] };
  const groups = new Map<string, Acc>();
  for (const item of input.items) {
    const key = item.line ? item.line.id : `section:${item.dieId}`;
    let acc = groups.get(key);
    if (!acc) {
      acc = {
        group: {
          key,
          salesOrderLineId: item.line?.id ?? null,
          orderNumber: item.line?.orderNumber ?? null,
          orderPeriod: item.line?.orderPeriod ?? null,
          lineNo: item.line?.lineNo ?? null,
          sectionCode: item.sectionCode,
          item: itemText(item),
          finish: item.line?.finish ?? null,
          poNumber: item.line?.poNumber ?? null,
        },
        items: [],
      };
      groups.set(key, acc);
    }
    acc.items.push(item);
  }
  const ordered = [...groups.values()].sort(
    (a, b) =>
      natural.compare(a.group.sectionCode, b.group.sectionCode) ||
      // Unlinked bundles of a section print after its order lines.
      Number(a.group.orderNumber === null) - Number(b.group.orderNumber === null) ||
      (a.group.orderPeriod ?? "").localeCompare(b.group.orderPeriod ?? "") ||
      natural.compare(a.group.orderNumber ?? "", b.group.orderNumber ?? "") ||
      (a.group.lineNo ?? 0) - (b.group.lineNo ?? 0) ||
      a.group.key.localeCompare(b.group.key),
  );

  let sr = 0;
  const outGroups: PlGroup[] = ordered.map(({ group, items }) => {
    // FP-PK-13: section (groups) → cut length → party number (natural: 26J9 before 26J10).
    const rows = [...items]
      .sort(
        (a, b) =>
          a.lengthMm - b.lengthMm ||
          natural.compare(a.partyNo ?? a.serial, b.partyNo ?? b.serial) ||
          natural.compare(a.serial, b.serial),
      )
      .map((item): PlRow => {
        sr += 1;
        const { ft, inch } = cutFtIn(item.lengthMm);
        const kg12 =
          item.kgPer12ftMilli != null
            ? item.kgPer12ftMilli / 1000
            : kgPer12ft({ weightG: item.weightG, pieces: item.quantity, lengthMm: item.lengthMm });
        const milli = kg12 == null ? null : Math.round(kg12 * 1000);
        return {
          sr,
          bundleNo: item.serial,
          section: item.sectionCode,
          item: itemText(item),
          weightG: item.weightG,
          cutFt: ft,
          cutIn: inch,
          pcs: item.quantity,
          kgPer12ftMilli: milli,
          // From the RAW kg/12ft with the plant's Excel formula floor((kg12 + 0.01) × 10) / 10, exact
          // in integers (review round 3; AGENTS.md "Range /12'"): raw 2.0895 is 2.0 though it prints
          // 2.090. Only a bundle without pieces or length falls back to the stored thousandths.
          range12ft:
            weightRange12ftOf({ weightG: item.weightG, pieces: item.quantity, lengthMm: item.lengthMm }) ??
            (milli == null ? null : weightRange12ftFromMilli(milli)),
          po: item.line?.poNumber?.trim() || item.bundlePo?.trim() || null,
        };
      });
    const subtotal = {
      bundles: rows.length,
      pcs: rows.reduce((s, r) => s + r.pcs, 0),
      weightG: rows.reduce((s, r) => s + r.weightG, 0),
    };
    return { ...group, rows, subtotal };
  });

  const allRows = outGroups.flatMap((g) => g.rows);
  const totalWeightG = allRows.reduce((s, r) => s + r.weightG, 0);
  const totalPcs = allRows.reduce((s, r) => s + r.pcs, 0);
  const totalLengthMm = input.items.reduce((s, i) => s + i.lengthMm, 0);
  const kg = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    totalWeightG / 1000,
  );
  const poNumbers = [...new Set(allRows.map((r) => r.po).filter((p): p is string => Boolean(p)))].sort((a, b) =>
    natural.compare(a, b),
  );
  const head = letterhead(input.company.settings);
  const bySerial = new Map(input.items.map((i) => [i.serial, i]));
  const showBranding = input.showBranding ?? true;
  const brand = branding(input.company.settings);
  // Subtotal per section, in printed order (groups are section-ordered).
  const sections: z.infer<typeof plSectionSchema>[] = [];
  for (const g of outGroups) {
    let sec = sections[sections.length - 1];
    if (!sec || sec.sectionCode !== g.sectionCode) {
      sec = { sectionCode: g.sectionCode, item: g.item, bundles: 0, pcs: 0, weightG: 0 };
      sections.push(sec);
    }
    sec.bundles += g.subtotal.bundles;
    sec.pcs += g.subtotal.pcs;
    sec.weightG += g.subtotal.weightG;
  }
  const profileSummary = profileKindSummary(
    allRows.map((r) => ({ profileKind: bySerial.get(r.bundleNo)?.profileKind ?? null, weightG: r.weightG, pcs: r.pcs })),
  ).map((t) => ({ kind: t.kind, bundles: t.bundles, pcs: t.pcs, weightG: t.weightG }));

  return {
    version: 2,
    header: {
      plNumber: input.plNumber,
      date: input.date,
      dispatchCode: input.dispatch.code,
      company: { name: input.company.name, ...head },
      billTo: { name: cust?.name ?? "", gstin: cust?.taxId?.trim() || null, address: addressText(cust?.billingAddress) },
      shipTo: {
        name: shipName ?? cust?.name ?? "",
        gstin: shipGstin ?? (cust?.taxId?.trim() || null),
        address: addressText(shipping) ?? addressText(cust?.billingAddress),
      },
      vehicleNo: input.dispatch.vehicleNo,
      driverName: input.dispatch.driverName,
      driverPhone: input.dispatch.driverPhone,
      transporter: input.dispatch.transporterName ?? input.dispatch.transporter,
      poNumbers,
      invoiceNumber: input.dispatch.invoiceNumber,
      invoiceDate: input.dispatch.invoiceDate,
      // The ship date somebody ENTERED, as the company's day (lib/dispatchFigures); the PL prints its own issue date besides,
      // so a load with no entered date prints none rather than the day it left (review round 1, I1).
      shipDate: enteredShipYmd(input.dispatch.shipDate, input.company.settings),
    },
    columns: [...PL_COLUMNS],
    groups: outGroups,
    summary: {
      bundles: allRows.length,
      pcs: totalPcs,
      weightG: totalWeightG,
      text: `${allRows.length} ${allRows.length === 1 ? "bundle" : "bundles"} · ${kg} kg`,
    },
    issue: {
      revision: input.revision ?? 1,
      dispatchCodes: input.dispatchCodes ?? [input.dispatch.code],
      branding: showBranding ? { show: true, ...brand } : { show: false, tagline: null, logoUrl: null },
    },
    rowInfo: Object.fromEntries(
      input.items.map((i) => [
        i.serial,
        { partyNo: i.partyNo ?? i.serial, originalSo: i.packedLineCode ?? null, profileKind: i.profileKind ?? null },
      ]),
    ),
    sections,
    profileSummary,
    print: { showBranding, showOriginalSo: input.showOriginalSo ?? true },
    dispatch: {
      code: input.dispatch.code,
      customer: {
        id: cust?.id ?? "",
        name: cust?.name ?? "",
        phone: cust?.phone ?? null,
        email: cust?.email ?? null,
        billingAddress: cust?.billingAddress ?? null,
        shippingAddress: cust?.shippingAddress ?? null,
        taxId: cust?.taxId ?? null,
      },
      shipDate: input.dispatch.shipDate ? new Date(input.dispatch.shipDate).toISOString() : null,
      notes: input.dispatch.notes ?? "",
      status: input.dispatch.status,
      completedAt: input.dispatch.completedAt ? new Date(input.dispatch.completedAt).toISOString() : null,
    },
    company: { id: input.company.id, name: input.company.name },
    // v1 rows follow the printed order so a v1 renderer lists the same sequence.
    items: outGroups.flatMap((g) =>
      g.rows.map((r) => {
        const item = bySerial.get(r.bundleNo)!;
        return {
          bundleSerial: item.serial,
          die: { series: item.series, sectionCode: item.sectionCode },
          groupId: item.groupLabel ?? item.bundleGroupId ?? "",
          quantity: item.quantity,
          weightG: item.weightG,
          lengthMm: item.lengthMm,
        };
      }),
    ),
    totals: {
      totalBundles: allRows.length,
      totalQuantity: totalPcs,
      totalWeightKg: Number((totalWeightG / 1000).toFixed(3)),
      totalLengthM: Number((totalLengthMm / 1000).toFixed(3)),
    },
    generatedAt: input.generatedAt.toISOString(),
    generatedBy: input.generatedBy,
  };
}
