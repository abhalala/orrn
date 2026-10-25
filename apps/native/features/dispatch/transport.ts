import { formatKgTotal, gToKg } from "@orrn/domain";

/** The transport details of a dispatch header, ready to show (FP-PK-11/12). Empty parts are left out. */
export type TransportFacts = {
  transporter: string | null;
  vehicleNo: string | null;
  driver: string | null;
  capacityKg: string | null;
};

type HeaderLike = {
  transporterName?: string | null;
  transporter?: string | null;
  vehicleNo?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  vehicleCapacityG?: number | null;
};

const text = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/**
 * The transporter master's name snapshot first (a rename never rewrites a sent list), the free-text one for
 * old dispatches. The driver reads "Name, phone" when both are there.
 */
export function transportFacts(d: HeaderLike): TransportFacts {
  const name = text(d.driverName);
  const phone = text(d.driverPhone);
  return {
    transporter: text(d.transporterName) ?? text(d.transporter),
    vehicleNo: text(d.vehicleNo),
    driver: name && phone ? `${name}, ${phone}` : (name ?? phone),
    capacityKg: d.vehicleCapacityG ? formatKgTotal(gToKg(d.vehicleCapacityG)) : null,
  };
}

export function hasTransport(f: TransportFacts): boolean {
  return Boolean(f.transporter || f.vehicleNo || f.driver || f.capacityKg);
}
