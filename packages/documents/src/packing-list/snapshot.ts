/** Immutable packing list snapshot shape stored in D1 and used for client exports. */
export type PLSnapshot = {
  schemaVersion?: 1 | 2;
  packingGroupKey?: "die" | "weightRange" | "manual";
  packingListLayout?: "orrn" | "fourcubes";
  dispatch: {
    code: string;
    customer: {
      name: string;
      phone?: string | null;
      email?: string | null;
      billingAddress?: Record<string, unknown> | null;
      shippingAddress?: Record<string, unknown> | null;
      taxId?: string | null;
    };
    shipDate: string | null;
    notes: string;
    completedAt: string | null;
  };
  company: { id: string; name: string };
  items: Array<{
    bundleSerial: string;
    die: { series: string; sectionCode: string; name?: string | null };
    groupId: string;
    quantity: number;
    weightG: number;
    lengthMm: number;
    uid?: string;
    groupLabel?: string;
    poNumber?: string | null;
    kgPer12ft?: number | null;
    kgPerCut?: number | null;
    weightRange?: string;
    lengthFt?: number;
    packedAt?: string | null;
  }>;
  groups?: Array<{
    label: string;
    firstSeenAt: string;
    bundleCount: number;
    quantity: number;
    weightKg: number;
    lotFrom: number;
    lotTo: number;
  }>;
  totals: {
    totalBundles: number;
    totalQuantity: number;
    totalWeightKg: number;
    totalLengthM: number;
  };
  generatedAt: string;
};
