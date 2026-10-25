/** The ageing figures of one order line (`ageing.forOrder`), the ones the breakdown reads. */
export type OrderAgedLine = {
  loadedPcs: number;
  inOvenPcs: number;
  outUntestedPcs: number;
  heldPcs: number;
  releasedPcs: number;
  packedPcs: number;
};

export type AgedPartKey = "loaded" | "inOven" | "outUntested" | "held" | "released" | "packed";

/**
 * The chips under an order line: loaded always (when the line went to a trolley at all), then each stage that
 * holds pieces now, then packed. Empty when nothing of the line was ever loaded. Pure: the server's numbers
 * as they are.
 */
export function agedBreakdown(line: OrderAgedLine): { key: AgedPartKey; pcs: number; tone: "neutral" | "blue" | "amber" | "green" }[] {
  if (line.loadedPcs <= 0) return [];
  const parts: { key: AgedPartKey; pcs: number; tone: "neutral" | "blue" | "amber" | "green" }[] = [{ key: "loaded", pcs: line.loadedPcs, tone: "neutral" }];
  if (line.inOvenPcs > 0) parts.push({ key: "inOven", pcs: line.inOvenPcs, tone: "blue" });
  if (line.outUntestedPcs > 0) parts.push({ key: "outUntested", pcs: line.outUntestedPcs, tone: "amber" });
  if (line.heldPcs > 0) parts.push({ key: "held", pcs: line.heldPcs, tone: "amber" });
  if (line.releasedPcs > 0) parts.push({ key: "released", pcs: line.releasedPcs, tone: "green" });
  if (line.packedPcs > 0) parts.push({ key: "packed", pcs: line.packedPcs, tone: "green" });
  return parts;
}
