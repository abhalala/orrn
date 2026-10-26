/**
 * Wave-2 M9: the order lines Pack offers. A booking (taken, not confirmed, often no PO yet) can
 * still be packed for, as the server allows, but it is never the suggestion and it sits after
 * the confirmed lines with its status said, so a packer does not pick it by habit.
 */
export type PackLineLike = { lineId: string; orderStatus: string };

export type PackLineChoice<L> = { line: L; suggested: boolean; booking: boolean };

export function packLineChoices<L extends PackLineLike>(lines: readonly L[]): PackLineChoice<L>[] {
  const firm = lines.filter((l) => l.orderStatus !== "booking");
  const booking = lines.filter((l) => l.orderStatus === "booking");
  return [
    ...firm.map((line, i) => ({ line, suggested: i === 0, booking: false })),
    ...booking.map((line) => ({ line, suggested: false, booking: true })),
  ];
}
