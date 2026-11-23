/**
 * Pure rules of the "Billets for this plan" card (#49): the readiness dot of a plan line, the short
 * flag of a totals row and the recovery word of a line. No React here.
 */
export type BilletRecoverySource = "die" | "plant" | "default";

export type BilletLineState = {
  dieReady: boolean;
  billetsEnough: boolean;
  ready: boolean;
};

export type BilletDot = "ready" | "dieNotReady" | "billetsShort";

/** Die first: a line with no free die copy says that, even when the billets are also short. */
export function billetDot(row: BilletLineState): BilletDot {
  if (row.ready) return "ready";
  if (!row.dieReady) return "dieNotReady";
  return "billetsShort";
}

export const BILLET_DOT_TONE: Record<BilletDot, "green" | "amber"> = {
  ready: "green",
  dieNotReady: "amber",
  billetsShort: "amber",
};

export const BILLET_DOT_KEY: Record<BilletDot, "reg.billet.ready" | "reg.billet.dieNotReady" | "reg.billet.billetsShort"> = {
  ready: "reg.billet.ready",
  dieNotReady: "reg.billet.dieNotReady",
  billetsShort: "reg.billet.billetsShort",
};

/** A totals row is short when the stock of its alloy is below the billet kg it needs. */
export function totalIsShort(total: { billetKgG: number; stockG: number }): boolean {
  return total.stockG < total.billetKgG;
}

export const RECOVERY_KEY: Record<BilletRecoverySource, "reg.billet.recoveryDie" | "reg.billet.recoveryPlant" | "reg.billet.recoveryDefault"> = {
  die: "reg.billet.recoveryDie",
  plant: "reg.billet.recoveryPlant",
  default: "reg.billet.recoveryDefault",
};

export function recoveryKey(source: BilletRecoverySource) {
  return RECOVERY_KEY[source];
}

/** Rows by plan line id, for the dot next to each line on the page. */
export function rowsByLine<T extends { planLineId: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.planLineId, r]));
}
