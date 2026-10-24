import { kgPer12ft, weightRange12ft } from "@orrn/domain";
import type { PLSnapshot } from "@orrn/documents/packing-list";

import { naturalCompare } from "../../lib/format";

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * `packingList.byDispatch` stores the snapshot as free JSON. This reads it
 * into the `PLSnapshot` the PDF and Excel builders take, tolerating a missing
 * field (a list made by an older server) and returning null when it is not a
 * packing list at all.
 */
export function toPlSnapshot(raw: unknown): PLSnapshot | null {
  if (!isObject(raw) || !isObject(raw.dispatch) || !Array.isArray(raw.items)) return null;
  const d = raw.dispatch;
  const customer = isObject(d.customer) ? d.customer : {};
  const company = isObject(raw.company) ? raw.company : {};
  const items: PLSnapshot["items"] = [];
  for (const entry of raw.items) {
    if (!isObject(entry)) return null;
    const die = isObject(entry.die) ? entry.die : {};
    items.push({
      bundleSerial: str(entry.bundleSerial),
      die: { series: str(die.series), sectionCode: str(die.sectionCode) },
      groupId: str(entry.groupId),
      quantity: num(entry.quantity),
      weightG: num(entry.weightG),
      lengthMm: num(entry.lengthMm),
    });
  }
  const totals = isObject(raw.totals) ? raw.totals : {};
  const weightG = items.reduce((s, i) => s + i.weightG, 0);
  return {
    dispatch: {
      code: str(d.code),
      customer: {
        name: str(customer.name),
        phone: strOrNull(customer.phone),
        email: strOrNull(customer.email),
        billingAddress: isObject(customer.billingAddress) ? customer.billingAddress : null,
        shippingAddress: isObject(customer.shippingAddress) ? customer.shippingAddress : null,
        taxId: strOrNull(customer.taxId),
      },
      shipDate: strOrNull(d.shipDate),
      notes: str(d.notes),
      completedAt: strOrNull(d.completedAt),
    },
    company: { id: str(company.id), name: str(company.name) },
    items,
    totals: {
      totalBundles: totals.totalBundles === undefined ? items.length : num(totals.totalBundles),
      totalQuantity: totals.totalQuantity === undefined ? items.reduce((s, i) => s + i.quantity, 0) : num(totals.totalQuantity),
      totalWeightKg: totals.totalWeightKg === undefined ? weightG / 1000 : num(totals.totalWeightKg),
      totalLengthM: totals.totalLengthM === undefined ? items.reduce((s, i) => s + i.lengthMm, 0) / 1000 : num(totals.totalLengthM),
    },
    generatedAt: str(raw.generatedAt, new Date(0).toISOString()),
  };
}

export type PlRow = {
  /** Running serial number down the whole list. */
  sr: number;
  serial: string;
  /** Section code and series, "14701 PATTI". */
  item: string;
  weightG: number;
  lengthMm: number;
  pieces: number;
  /** kg of one 12 ft piece, null without pieces or length. */
  kg12: number | null;
  /** The catalogue band /12', null when kg12 is. */
  band: number | null;
};

export type PlSection = { key: string; label: string; rows: PlRow[]; weightG: number; pieces: number };

export type PlTable = { sections: PlSection[]; totals: { bundles: number; weightG: number; pieces: number } };

/**
 * The printed packing list as rows: sorted by section (natural order), then
 * length, then bundle number, numbered Sr 1..n, with a subtotal per section.
 */
export function plTable(snapshot: PLSnapshot): PlTable {
  const sorted = [...snapshot.items].sort(
    (a, b) =>
      naturalCompare(a.die.sectionCode, b.die.sectionCode) ||
      naturalCompare(a.die.series, b.die.series) ||
      a.lengthMm - b.lengthMm ||
      naturalCompare(a.bundleSerial, b.bundleSerial),
  );
  const sections: PlSection[] = [];
  sorted.forEach((item, index) => {
    const label = `${item.die.sectionCode} ${item.die.series}`.trim();
    let section = sections[sections.length - 1];
    if (!section || section.key !== label) {
      section = { key: label, label, rows: [], weightG: 0, pieces: 0 };
      sections.push(section);
    }
    const kg12 = kgPer12ft({ weightG: item.weightG, pieces: item.quantity, lengthMm: item.lengthMm });
    section.rows.push({
      sr: index + 1,
      serial: item.bundleSerial,
      item: label,
      weightG: item.weightG,
      lengthMm: item.lengthMm,
      pieces: item.quantity,
      kg12,
      band: kg12 === null ? null : weightRange12ft(kg12),
    });
    section.weightG += item.weightG;
    section.pieces += item.quantity;
  });
  return {
    sections,
    totals: {
      bundles: sorted.length,
      weightG: sorted.reduce((s, i) => s + i.weightG, 0),
      pieces: sorted.reduce((s, i) => s + i.quantity, 0),
    },
  };
}
