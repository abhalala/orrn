/**
 * The customer's own bundle numbers a save made (FP-PK-07), first to last. Null when the bundles
 * carry no party number of their own (the number on the label is then the plant serial).
 */
export function partyRange(
  bundles: readonly { serial: string; partyNo: string | null }[],
): { from: string; to: string } | null {
  const party = bundles.filter((b) => b.partyNo && b.partyNo !== b.serial).map((b) => b.partyNo!);
  return party.length === 0 ? null : { from: party[0]!, to: party[party.length - 1]! };
}

/** Party number shown beside the serial: only when it differs (D12: shown only when a party number differs). */
export function partyNoLabel(b: { serial: string; partyNo: string | null }): string | null {
  return b.partyNo && b.partyNo !== b.serial ? b.partyNo : null;
}
