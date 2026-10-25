/**
 * BACKLOG 62 (still reproducing in the final explore): a load left with no vehicle number. The
 * Dispatch sheet now asks for it when the header has none, and saves it before completing; the
 * PL and the e-way bill name the truck. Same normalising as the server (spaces and dashes dropped,
 * upper case, 2–15 letters and digits).
 */
export type VehicleGate =
  | { kind: "ready" }
  | { kind: "save"; vehicleNo: string }
  | { kind: "missing" }
  | { kind: "invalid" };

export function normaliseVehicleNo(raw: string): string {
  return raw.replace(/[\s-]+/g, "").toUpperCase();
}

export function vehicleGate(current: string | null | undefined, typed: string): VehicleGate {
  if (current?.trim()) return { kind: "ready" };
  const v = normaliseVehicleNo(typed);
  if (!v) return { kind: "missing" };
  if (!/^[A-Z0-9]{2,15}$/.test(v)) return { kind: "invalid" };
  return { kind: "save", vehicleNo: v };
}
