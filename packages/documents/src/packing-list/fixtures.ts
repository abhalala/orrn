/**
 * Test fixtures: packing list snapshots exactly as the server stores them
 * today (`packingList.ts` buildSnapshot, v1). `groupId` there is
 * `groupLabel ?? bundle.groupId`, so an unlabelled bundle leaks its packing
 * session (bundle group) id: a UUID in production, `dev-group-NNN` in the seed.
 */
export const RECEIPT_UUID = "3f2b9c1e-8a4d-4f6b-9c2e-7d1a5b8e0f42";

type RawItem = {
  bundleSerial: string;
  die: { series: string; sectionCode: string; name?: string | null };
  groupId: string;
  groupLabel?: string | null;
  quantity: number;
  weightG: number;
  lengthMm: number;
};

export function v1Snapshot(items: RawItem[], overrides: Record<string, unknown> = {}) {
  const totalWeightG = items.reduce((s, i) => s + i.weightG, 0);
  return {
    dispatch: {
      code: "D-0042",
      customer: {
        id: "cust-1",
        name: "Shivam Aluminium, Bhavnagar",
        phone: "+91 98250 41177",
        email: null,
        billingAddress: null,
        shippingAddress: null,
        taxId: "24AAKFS4821M1Z3",
      },
      shipDate: "2026-10-04T00:00:00.000Z",
      notes: "",
      status: "completed",
      completedAt: "2026-10-03T09:12:00.000Z",
    },
    company: { id: "co-1", name: "Fourcubes Extrusion" },
    items,
    totals: {
      totalBundles: items.length,
      totalQuantity: items.reduce((s, i) => s + i.quantity, 0),
      totalWeightKg: Number((totalWeightG / 1000).toFixed(3)),
      totalLengthM: 99.999,
    },
    generatedAt: "2026-10-03T09:12:01.000Z",
    generatedBy: "user-1",
    ...overrides,
  };
}

const patti = { series: "PATTI", sectionCode: "14701" };
const angle = { series: "ANGLE", sectionCode: "11250" };

/** Two sections, no packing group labels: groups must be the sections, never the receipt UUID. */
export const unlabelled = v1Snapshot([
  { bundleSerial: "26I4087", die: patti, groupId: RECEIPT_UUID, quantity: 21, weightG: 52_400, lengthMm: 3658 },
  { bundleSerial: "26I4086", die: patti, groupId: RECEIPT_UUID, quantity: 20, weightG: 50_455, lengthMm: 3658 },
  { bundleSerial: "26I4101", die: angle, groupId: "dev-group-007", quantity: 24, weightG: 50_116, lengthMm: 3505 },
]);

/** Packing group labels set on the dispatch (stored uppercase by setItemGroupLabel). */
export const labelled = v1Snapshot([
  { bundleSerial: "26I4101", die: angle, groupId: "B", quantity: 24, weightG: 50_116, lengthMm: 3505 },
  { bundleSerial: "26I4086", die: patti, groupId: "A", quantity: 20, weightG: 50_455, lengthMm: 3658 },
  { bundleSerial: "26I4087", die: patti, groupId: "A", quantity: 21, weightG: 52_400, lengthMm: 3658 },
]);
