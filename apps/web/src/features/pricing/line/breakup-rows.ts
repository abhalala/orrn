/**
 * The price sheet of one order line, as plain rows: what the frozen `PriceBreakup` says, in the order a
 * person reads it (base metal, conversion, alloy, finish, add-ons, discount, the rate from the master, a rate
 * changed by hand, the rate on the line). The screen puts words and rupees on each row.
 */
import { isModuleOn, overrideNeedsApproval, type PriceBreakup } from "@orrn/domain";

export type BreakupNote =
  | { type: "metal"; source: "nalco" | "lme" | "manual"; rateDate: string; lme: { usdPerTonneCents: number; inrPerUsdPaise: number; premiumPaisePerKg: number } | null }
  | { type: "conversion"; from: "customer" | "die" | "series" | "default" }
  | { type: "name"; name: string }
  | { type: "addons"; labels: string[] }
  | { type: "reason"; reason: string }
  | { type: "approved" };

export type BreakupRow = {
  id: "metal" | "conversion" | "alloy" | "finish" | "addons" | "discount" | "fixed" | "computed" | "override" | "final";
  /** Paise per kg. */
  paise: number;
  /** `minus` is shown with a minus sign (a discount). */
  sign: "plus" | "minus" | "none";
  /** A total line: the rate from the master, or the rate on the line. */
  total: boolean;
  note: BreakupNote | null;
};

export function breakupRows(b: PriceBreakup): BreakupRow[] {
  const rows: BreakupRow[] = [];
  const add = (row: Omit<BreakupRow, "note" | "total" | "sign"> & Partial<Pick<BreakupRow, "note" | "total" | "sign">>) =>
    rows.push({ note: null, total: false, sign: "none", ...row });

  if (b.fixedPaisePerKg != null) {
    // A customer's fixed rate replaces the sum: the parts would only mislead.
    add({ id: "fixed", paise: b.fixedPaisePerKg });
  } else {
    add({ id: "metal", paise: b.metal.paisePerKg, note: { type: "metal", source: b.metal.source, rateDate: b.metal.rateDate, lme: b.metal.lme } });
    add({ id: "conversion", paise: b.conversion.paisePerKg, sign: "plus", note: { type: "conversion", from: b.conversion.from } });
    if (b.alloy.paisePerKg > 0) add({ id: "alloy", paise: b.alloy.paisePerKg, sign: "plus", note: b.alloy.alloy ? { type: "name", name: b.alloy.alloy } : null });
    if (b.finish.paisePerKg > 0) add({ id: "finish", paise: b.finish.paisePerKg, sign: "plus", note: b.finish.finish ? { type: "name", name: b.finish.finish } : null });
    if (b.componentsPaisePerKg > 0) {
      add({ id: "addons", paise: b.componentsPaisePerKg, sign: "plus", note: { type: "addons", labels: b.components.map((c) => c.label) } });
    }
    if (b.discountPaisePerKg > 0) add({ id: "discount", paise: b.discountPaisePerKg, sign: "minus" });
  }

  if (b.override) {
    add({ id: "computed", paise: b.computedPaisePerKg, total: true });
    add({
      id: "override",
      paise: b.override.ratePaise,
      note: b.override.reason ? { type: "reason", reason: b.override.reason } : b.override.approvedBy ? { type: "approved" } : null,
    });
  }
  add({ id: "final", paise: b.finalPaisePerKg, total: true });
  return rows;
}

/** The rate asked for a line against the rate the master gives. */
export type AskedRate = { ratePaise: number; computedPaisePerKg: number; needsApproval: boolean; sameAsNow: boolean };

/** Is an asked rate going to wait for a manager (below the computed rate), and is it just today's rate again. */
export function askedRate(b: PriceBreakup, ratePaise: number): AskedRate {
  return {
    ratePaise,
    computedPaisePerKg: b.computedPaisePerKg,
    needsApproval: overrideNeedsApproval(b.computedPaisePerKg, ratePaise),
    sameAsNow: ratePaise === b.finalPaisePerKg,
  };
}

/** The pricing module is on for this company (the shared module rule, opt-in modules included). */
export function pricingModuleOn(modules: readonly string[] | null | undefined): boolean {
  return isModuleOn(modules, "pricing");
}

/**
 * Whether a line shows the price sheet: it has a frozen breakup (the server only sends one to people who
 * may see rates) and the pricing module is on. Without a breakup the line keeps showing just its rate.
 */
export function showsPriceSheet(breakup: PriceBreakup | null | undefined, modules: readonly string[] | null | undefined): breakup is PriceBreakup {
  return breakup != null && pricingModuleOn(modules);
}
