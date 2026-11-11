import { TARGETS, type IngestTarget } from "@orrn/ingest";

import { fieldLabelKey } from "./recipe-builder";
import type { StagedRowView } from "./types";

/**
 * What a staged row shows for each mapped field: the value orrn will store, and, where the file said it differently,
 * what the file said (text and unit as typed). Rates are masked for a person without `order.price`: the server sends
 * no rate and no entered rate, `rateHidden` is true, and the cell is hidden in both columns, never zero.
 */
export type ValueCell = {
  field: string;
  labelKey: string;
  /** The rate is masked for this person: show `ingest.rate.hidden`. */
  hidden: boolean;
  /** The stored value as text (a rate is rupees, from paise). */
  value: string;
  /** Canonical unit of a number field, shown after the value. */
  unit: string | null;
  /** `ingest.rate.unit` for a rate: "Rs per kg". */
  unitKey: string | null;
  /** What the file said, only when it differs from the stored value. */
  entered: { text: string; unit: string | null } | null;
};

/** Paise to rupees as text with two decimals, without float arithmetic. */
export function rupeesFromPaise(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(paise));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const plain = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** The cells of a row, in the catalogue's field order, then any extra stored value. Blank values are left out. */
export function valueCells(target: IngestTarget | null, row: Pick<StagedRowView, "values" | "entered" | "rateHidden">): ValueCell[] {
  const values = row.values ?? {};
  const entered = row.entered ?? {};
  const defs = target ? TARGETS[target].fields : [];
  // Keys that start with "_" are the server's own working values (`_ids`, `_dupKey`), not what the file said.
  const order = [...defs.map((d) => d.name), ...Object.keys(values).filter((k) => !k.startsWith("_") && !defs.some((d) => d.name === k))];
  const out: ValueCell[] = [];
  for (const name of order) {
    const def = defs.find((d) => d.name === name);
    if (name === "rate" && row.rateHidden) {
      out.push({ field: name, labelKey: fieldLabelKey(name), hidden: true, value: "", unit: null, unitKey: null, entered: null });
      continue;
    }
    const raw = values[name];
    const typed = entered[name];
    if ((raw === null || raw === undefined || raw === "") && !typed) continue;
    const isRate = name === "rate" && def?.kind === "price_per_mass" && typeof raw === "number";
    const value = isRate ? rupeesFromPaise(raw as number) : plain(raw);
    const unit = isRate ? null : def?.unit ?? null;
    const unitKey = isRate ? "ingest.rate.unit" : null;
    // The file's text is shown when it is not the stored value itself, or when it carried a unit (a unit is the
    // point: "2.4 kg/12ft" becomes 2400 g/12ft).
    const differs = !!typed && (typed.text !== value || (typed.unit !== null && typed.unit !== unit));
    out.push({
      field: name,
      labelKey: fieldLabelKey(name),
      hidden: false,
      value,
      unit,
      unitKey,
      entered: differs ? { text: typed.text, unit: typed.unit } : null,
    });
  }
  return out;
}
