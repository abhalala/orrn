import type { Fmt } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";

import { cutLengthText, kgPlain3, massUnit } from "@/shared/lib/fmt-text";

/** The part of a press report row the weight and length cells are built from. The server's `row.cells` stay for the CSV, in kg and mm. */
export type ReportCellRow = { goodG: number; pcs: number; scrapG: number; billetCount: number; billetG: number; cutLengthsMm: readonly number[] };

/**
 * The cells that carry a weight or a length, written in the plant's units so a row agrees with the totals row under it and with
 * its header. Three decimals and no grouping, as the server wrote them ("1000.000 / 120"), so a plant on kg reads what it did.
 */
export function reportCell(fmt: Fmt, id: "good" | "scrap" | "billets" | "cutLengths", row: ReportCellRow): string {
  switch (id) {
    case "good":
      return `${kgPlain3(fmt, row.goodG)} / ${row.pcs}`;
    case "scrap":
      return kgPlain3(fmt, row.scrapG);
    case "billets":
      return `${row.billetCount} / ${kgPlain3(fmt, row.billetG)}`;
    case "cutLengths":
      return row.cutLengthsMm.map((mm) => cutLengthText(fmt, mm)).join(", ");
  }
}

/** The billets header names the weight unit of its second half when that is not kg; a plant on kg keeps "Billets". */
export const billetsHeaderKey = (fmt: Fmt): MessageKey => (massUnit(fmt) === "kg" ? "press.report.billets" : "press.report.billetsUnit");
