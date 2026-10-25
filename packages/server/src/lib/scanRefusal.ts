/**
 * Dispatch add refusals (D12): the machine `code` and English `reason` every add path returns.
 * Kept free of imports so the tRPC error formatter (`src/index.ts`) can use the error class.
 */
/** Outcomes that keep a bundle off the dispatch (everything but not found / already on / added). */
export const SCAN_REFUSALS = ["ambiguous", "void", "dispatched", "held", "held_for_order", "reallocation_pending", "unassigned", "wrong_customer", "outside_order", "owned_die"] as const;
export type ScanRefusalCode = (typeof SCAN_REFUSALS)[number];

export function isScanRefusal(outcome: string): outcome is ScanRefusalCode {
  return (SCAN_REFUSALS as readonly string[]).includes(outcome);
}

/** One refused code with its machine code and the English sentence (`reason`). */
export type ScanRefusal = {
  serial: string;
  code: ScanRefusalCode;
  reason: string;
  heldBy: string | null;
  customerName: string | null;
  candidates: string[];
  /** `held_for_order` (FP-OP-17): the sales order it is held for (`customerName` is its customer); `outside_order`: the order the packing list is for. */
  orderNumber?: string | null;
};

/**
 * The `cause` of the TRPCError `dispatch.addBundle` throws for a refusal, so clients get the same
 * `{code, reason}` as a scan (the error formatter copies it to `error.data.refusal`).
 */
export class ScanRefusalError extends Error {
  readonly refusal: ScanRefusal;
  constructor(refusal: ScanRefusal) {
    super(refusal.reason);
    this.name = "ScanRefusalError";
    this.refusal = refusal;
  }
}
