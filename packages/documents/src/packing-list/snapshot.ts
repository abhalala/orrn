/** Immutable packing list snapshot shape stored in D1 and used for client exports. */
export type PLSnapshot = {
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
    die: { series: string; sectionCode: string };
    groupId: string;
    quantity: number;
    weightG: number;
    lengthMm: number;
  }>;
  totals: {
    totalBundles: number;
    totalQuantity: number;
    totalWeightKg: number;
    totalLengthM: number;
  };
  generatedAt: string;
};
